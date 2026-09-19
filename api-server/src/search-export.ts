/**
 * Search and CSV export for the customer dashboard.
 *
 * WHY THIS IS A SERVER MODULE AND NOT MORE PAGE CODE
 *
 * /calls could filter by intent and then search — in the browser — the 100
 * rows it happened to have loaded. So "which caller asked about the
 * Kukatpally branch?" was unanswerable: the words are inside
 * calls.transcript, a jsonb array of {role, content, ts}, and the browser
 * never had it for more than a screenful of calls.
 *
 * It cannot be pushed into PostgREST either. `transcript::text=ilike.*x*`
 * is parsed as a filter on `transcript` with the cast thrown away, and the
 * request dies on `operator does not exist: jsonb ~~* unknown`. The search
 * therefore runs here, with the service key, against a tenant id proved
 * from the caller's own JWT — never one they sent.
 *
 * Exports are here for a different reason: PostgREST answers at most 1000
 * rows per request, and a download that quietly stops at the thousandth
 * call is worse than no download, because the business does not know it is
 * missing anything. Everything below pages until the table is exhausted and
 * writes the rows out as it goes.
 *
 * MOUNTING — this module registers its own routes and owns no state:
 *   import { mountSearchExport } from "./search-export";
 *   mountSearchExport(app, { sb, verifyJWT, apiLimiter, getTenantId, audit });
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What this module needs from index.ts. Every field is the same object
 * index.ts already passes to mountDeskRoutes — nothing new is constructed.
 *
 *  sb          Supabase client built with the SERVICE key. It bypasses RLS,
 *              which is why every query below carries an explicit
 *              .eq("tenant_id", …) with the id resolved from the JWT.
 *  verifyJWT   Express middleware; sets req.user from a Supabase access
 *              token in the Authorization header, 401s otherwise.
 *  apiLimiter  The shared 300-per-15-minutes rate limiter. Applied to the
 *              exports, which are the expensive routes.
 *  getTenantId Maps an auth user id to the tenant they belong to, or null.
 *  audit       DPDP audit writer. An export is a bulk read of personal
 *              data; it is recorded.
 */
export type SearchExportDeps = {
  sb:          SupabaseClient;
  verifyJWT:   (req: Request, res: Response, next: NextFunction) => void;
  apiLimiter:  any;
  getTenantId: (userId: string) => Promise<string | null>;
  audit:       (action: string, ctx: any) => Promise<void>;
};

// ── IST ───────────────────────────────────────────────────────
// Every customer is in India. A server clock in UTC must not decide which
// day a call was on: at 23:00 UTC it is already tomorrow in Hyderabad, and
// "today's calls" that silently meant "since 05:30 this morning" is the
// kind of wrong a shop owner notices and cannot explain.
// Same +05:30 arithmetic as istDay() in index.ts.
const IST_MS = 330 * 60_000;

/** Today in IST as YYYY-MM-DD. Used for export filenames. */
export function istToday(now = Date.now()): string {
  return new Date(now + IST_MS).toISOString().slice(0, 10);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** First instant of an IST day, as a timestamptz literal Postgres accepts. */
function istDayStart(day: string): string | null {
  return DAY_RE.test(day) ? `${day}T00:00:00+05:30` : null;
}
/** Last instant of an IST day. Inclusive, so `to=today` includes today. */
function istDayEnd(day: string): string | null {
  return DAY_RE.test(day) ? `${day}T23:59:59.999+05:30` : null;
}

/**
 * A timestamp as a person in India would read it: "19 Sep 2026 14:32".
 *
 * Written out by hand rather than with toLocaleString("en-IN", { timeZone })
 * because that depends on the container's ICU data. A Node build without
 * full ICU silently ignores the timeZone and writes UTC, which in a
 * spreadsheet is indistinguishable from a correct answer.
 */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function istStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return String(iso);
  const d = new Date(t + IST_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} `
       + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// ── CSV ───────────────────────────────────────────────────────

/**
 * One CSV cell, safe to open in Excel.
 *
 * Two separate hazards:
 *  - RFC 4180: a value containing a comma, quote or newline has to be
 *    quoted, and inner quotes doubled. A lead's note with a comma in it
 *    used to shift every later column of that row by one.
 *  - Formula injection: Excel and Sheets EXECUTE a cell that begins with
 *    = + - @ (or a leading tab/CR before one). A lead called
 *    `=HYPERLINK("http://evil","Click")` — a name an attacker can set by
 *    filling in a web capture form — runs when the owner opens the file.
 *    Prefixing an apostrophe makes the spreadsheet treat it as text; the
 *    apostrophe is not shown in the cell.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");

/**
 * Excel on Windows needs CRLF and a UTF-8 BOM. Without the BOM, Telugu
 * names and ₹ arrive as mojibake in the one place the customer will look
 * at them; without CRLF, a quoted multi-line cell breaks the row.
 */
const CRLF = "\r\n";
const BOM  = "﻿";

/**
 * res.write() that respects backpressure. An export of 40,000 leads written
 * in a tight loop buffers the whole file in the Node process because the
 * socket drains slower than the loop produces — one big download could take
 * the API server down for every other tenant.
 */
function write(res: Response, chunk: string): Promise<void> {
  return new Promise(resolve => {
    if (res.write(chunk)) resolve();
    else res.once("drain", () => resolve());
  });
}

// PostgREST's hard ceiling per request. Everything here pages by it.
const PAGE = 1000;

// Ceilings on one download. Well past any real customer — the largest
// tenant has a few thousand calls — and both are announced in the file when
// they are hit, never applied silently.
const MAX_EXPORT_ROWS = 100_000;
const MAX_SCAN_ROWS   = 300_000;

// ── Shared query shapes ───────────────────────────────────────

type CallFilters = {
  q:         string;
  intent:    string;
  status:    string;
  direction: string;
  from:      string | null;   // timestamptz literal, already IST-anchored
  to:        string | null;
};

function callFilters(query: any): CallFilters {
  const one = (v: any) => (typeof v === "string" ? v.trim() : "");
  return {
    q:         one(query.q).slice(0, 120),
    // "all" is what the tabs on /calls send for "no filter".
    intent:    one(query.intent)    === "all" ? "" : one(query.intent),
    status:    one(query.status)    === "all" ? "" : one(query.status),
    direction: one(query.direction) === "all" ? "" : one(query.direction),
    from:      istDayStart(one(query.from)),
    to:        istDayEnd(one(query.to)),
  };
}

/** The tenant-scoped, filtered calls query every calls route starts from. */
function callsQuery(sb: SupabaseClient, tenantId: string, f: CallFilters, columns: string) {
  let q = sb.from("calls").select(columns).eq("tenant_id", tenantId);
  if (f.intent)    q = q.eq("intent", f.intent);
  if (f.status)    q = q.eq("status", f.status);
  if (f.direction) q = q.eq("direction", f.direction);
  if (f.from)      q = q.gte("created_at", f.from);
  if (f.to)        q = q.lte("created_at", f.to);
  return q;
}

// ── Matching a call in Node ───────────────────────────────────

type Turn = { role?: string; content?: string; ts?: string };

const turns = (t: unknown): Turn[] => (Array.isArray(t) ? (t as Turn[]) : []);

/**
 * Does this call match the needle? Searches what people actually said plus
 * the caller's number — deliberately NOT the raw jsonb, where "content",
 * "user" and "assistant" appear in every single row.
 *
 * A needle of digits is compared against digits, so searching 9876543210
 * finds a call logged as +91 98765 43210.
 */
function callMatches(row: any, needle: string, digits: string): boolean {
  if (!needle) return true;
  if (digits.length >= 4) {
    const num = String(row.caller_number || "").replace(/\D/g, "");
    if (num.includes(digits)) return true;
  } else if (String(row.caller_number || "").toLowerCase().includes(needle)) {
    return true;
  }
  return turns(row.transcript).some(t => String(t?.content || "").toLowerCase().includes(needle));
}

/**
 * The line that matched, trimmed to something that fits in a result row.
 * Shown under a search hit so the business can see WHY a call came back
 * without opening it.
 */
function snippetFor(row: any, needle: string): string | null {
  if (!needle) return null;
  for (const t of turns(row.transcript)) {
    const c = String(t?.content || "");
    const at = c.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    const start = Math.max(0, at - 60);
    const end   = Math.min(c.length, at + needle.length + 100);
    return (start > 0 ? "…" : "") + c.slice(start, end).trim() + (end < c.length ? "…" : "");
  }
  return null;
}

const LIST_COLUMNS =
  "id,caller_number,direction,status,duration_seconds,intent,wa_sent,appointment_created,created_at";

/**
 * Is supabase/056's search_calls() function in the database yet?
 *
 * null = not asked. The migration may be applied long after this process
 * started, so a "no" is re-checked every few minutes rather than cached for
 * the life of the container — otherwise the fast path would only ever
 * switch on at the next deploy.
 */
let rpcReady: boolean | null = null;
let rpcCheckedAt = 0;
const RPC_RECHECK_MS = 5 * 60_000;

function rpcMissing(error: any): boolean {
  // PGRST202: PostgREST could not find a function with that name/signature.
  const msg = String(error?.message || "");
  return error?.code === "PGRST202"
    || /could not find the function/i.test(msg)
    || /schema cache/i.test(msg);
}

/**
 * Search a tenant's calls, newest first.
 *
 * Preferred path is search_calls() from supabase/056 — one indexed query.
 * Without that migration the same answer is assembled here by reading the
 * filtered calls rows and matching in Node. That costs one transcript's
 * worth of transfer per call scanned, so the scan is capped and the cap is
 * REPORTED: `capped: true` means the caller is looking at the most recent
 * `scanned` calls and must be told so, not shown a short list as if it were
 * the whole answer.
 */
async function searchCalls(
  sb: SupabaseClient, tenantId: string, f: CallFilters,
  limit: number, offset: number, maxScan: number,
): Promise<{ rows: any[]; hasMore: boolean; scanned: number; capped: boolean; indexed: boolean }> {

  const needle = f.q.toLowerCase();
  const digits = f.q.replace(/\D/g, "");

  if (needle && (rpcReady === null || (rpcReady === false && Date.now() - rpcCheckedAt > RPC_RECHECK_MS))) {
    rpcCheckedAt = Date.now();
    // Every argument by name, including the ones with defaults: PostgREST
    // resolves a function by the exact set of argument names it is given, so
    // a partial call can miss a function that is really there.
    const { error } = await sb.rpc("search_calls", {
      p_tenant: tenantId, p_q: "", p_intent: null, p_status: null,
      p_from: null, p_to: null, p_limit: 1, p_offset: 0,
    });
    rpcReady = !error || !rpcMissing(error);
    if (error && !rpcMissing(error)) console.error("[search] search_calls probe failed:", error.message);
  }

  if (needle && rpcReady) {
    // limit + 1, so "is there another page" costs nothing extra.
    const { data, error } = await sb.rpc("search_calls", {
      p_tenant: tenantId, p_q: f.q,
      p_intent: f.intent || null, p_status: f.status || null,
      p_from: f.from, p_to: f.to,
      p_limit: Math.min(limit + 1, 200), p_offset: offset,
    });
    if (!error) {
      const rows = (data as any[]) || [];
      // The function has no direction argument; /calls sends one rarely and
      // trimming the page here is cheaper than a second database round trip.
      const kept = f.direction ? rows.filter(r => r.direction === f.direction) : rows;
      return {
        rows: kept.slice(0, limit), hasMore: rows.length > limit,
        scanned: 0, capped: false, indexed: true,
      };
    }
    if (rpcMissing(error)) rpcReady = false;      // migration rolled back
    else throw new Error(error.message);
  }

  const wanted = offset + limit + 1;
  const matches: any[] = [];
  let scanned = 0, capped = false;

  for (let from = 0; from < maxScan; from += PAGE) {
    const { data, error } = await callsQuery(
      sb, tenantId, f, needle ? `${LIST_COLUMNS},transcript` : LIST_COLUMNS,
    )
      // created_at alone is not a stable sort — two calls in the same second
      // could swap between pages and be returned twice or not at all.
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(from, Math.min(from + PAGE, maxScan) - 1);
    if (error) throw new Error(error.message);

    const batch = (data as any[]) || [];
    scanned += batch.length;
    for (const r of batch) {
      if (!callMatches(r, needle, digits)) continue;
      const { transcript, ...rest } = r;
      matches.push({ ...rest, snippet: snippetFor(r, needle) });
    }
    if (batch.length < PAGE) break;
    if (matches.length >= wanted) break;
    if (from + PAGE >= maxScan) { capped = true; break; }
  }

  return {
    rows: matches.slice(offset, offset + limit),
    hasMore: matches.length > offset + limit,
    scanned, capped, indexed: false,
  };
}

// ── Lead filters ──────────────────────────────────────────────

/**
 * The lead filters, kept in step BY HAND with web/app/leads/page.tsx.
 *
 * The page reads leads straight from Supabase under RLS (that is the
 * documented pattern for that screen and predates this module), so the same
 * filter set exists in two places. It is duplicated rather than shared
 * because the two run in different builds with no common module boundary —
 * the same trade-off web/lib/csv.ts records. If a filter changes in one, it
 * has to change in the other, or the CSV a customer downloads will not be
 * the list they were looking at when they pressed the button.
 */
function leadsQuery(sb: SupabaseClient, tenantId: string, query: any, columns: string) {
  const one = (v: any) => (typeof v === "string" ? v.trim() : "");
  let q = sb.from("leads").select(columns).eq("tenant_id", tenantId);

  const stage = one(query.stage);
  if (stage && stage !== "all") q = q.eq("stage", stage);

  const tag = one(query.tag);
  if (tag) q = q.contains("tags", [tag]);

  const scoreMin = Number(query.score_min), scoreMax = Number(query.score_max);
  if (Number.isFinite(scoreMin)) q = q.gte("score", Math.max(0, scoreMin));
  if (Number.isFinite(scoreMax)) q = q.lte("score", Math.min(100, scoreMax));

  const from = istDayStart(one(query.contacted_from));
  const to   = istDayEnd(one(query.contacted_to));
  if (from) q = q.gte("last_contacted_at", from);
  if (to)   q = q.lte("last_contacted_at", to);

  // "Follow up today" — sent only by a dashboard that has already proved
  // supabase/056 is applied, because naming follow_up_at before then turns
  // the whole download into a 400.
  if (one(query.due) === "1") {
    q = q.not("follow_up_at", "is", null).is("follow_up_done_at", null)
         .lte("follow_up_at", `${istToday()}T23:59:59.999+05:30`);
  }

  // PostgREST's or= takes a comma-separated list inside parentheses, so a
  // needle containing , ( ) or \ would be read as more conditions and the
  // request would 400 — or worse, filter on something nobody asked for.
  const needle = one(query.q).slice(0, 120).replace(/[,()\\]/g, " ").trim();
  if (needle) {
    const pat = needle.replace(/[%_]/g, " ");
    q = q.or(`name.ilike.%${pat}%,phone.ilike.%${pat}%,interest.ilike.%${pat}%,notes.ilike.%${pat}%`);
  }
  return q;
}

// ── Routes ────────────────────────────────────────────────────

/**
 * The words the dashboard shows, in the file the customer opens.
 *
 * These columns were written straight out of the database, so a shop owner
 * opening their own export read "pricing_enquiry", "qualified" and
 * "inbound_call" — developer keys, in a spreadsheet they may forward to an
 * accountant. The dashboard has always had label maps; the exports never
 * used them. Anything unmapped falls back to the raw value with its
 * underscores opened up, so a new key is ugly rather than blank.
 */
const LABELS: Record<string, string> = {
  // Intents, both vocabularies. These strings must READ THE SAME as the
  // dashboard's web/lib/intent.ts — the same row said "Appointment" on screen
  // and "Booking" in the spreadsheet, which is the kind of difference that
  // makes an owner distrust both.
  appointment: "Booking", enquiry: "Enquiry", callback: "Callback",
  transfer: "Asked for a person", emergency: "Urgent", order: "Order",
  book_appointment: "Wants to book", reschedule: "Reschedule", cancel: "Cancel",
  pricing_enquiry: "Asked the price", service_enquiry: "Service question",
  location_hours: "Location / hours", complaint: "Complaint", follow_up: "Follow-up",
  other: "Something else", unknown: "Not captured",
  // lead stages
  new: "New", contacted: "Contacted", qualified: "Qualified", won: "Won", lost: "Lost",
  // lead sources
  inbound_call: "Inbound call", outbound_campaign: "Outbound campaign",
  web_form: "Website form", widget: "Website chat", manual: "Added by hand", import: "Imported",
  // call outcomes
  completed: "Completed", missed: "Missed", failed: "Failed", active: "In progress",
  transferred: "Transferred", confirmed: "Confirmed", pending: "Pending", cancelled: "Cancelled",
  no_show: "No show", inbound: "Incoming", outbound: "Outgoing",
};
const label = (v: unknown) => {
  const k = String(v ?? "").trim();
  if (!k) return "";
  return LABELS[k.toLowerCase()] || k.replace(/_/g, " ");
};

export function mountSearchExport(app: Express, d: SearchExportDeps) {
  const { sb, verifyJWT, apiLimiter, getTenantId, audit } = d;

  /** Resolve the caller's tenant, or answer and return null. */
  async function tenantOf(req: any, res: Response): Promise<string | null> {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No business is linked to this login yet." }); return null; }
    return tenantId;
  }

  /**
   * GET /api/search/calls
   *   q, intent, status, direction, from=YYYY-MM-DD, to=YYYY-MM-DD,
   *   limit (<=100), offset
   *
   * Reading is open to every member of the business — 039 keeps owner-only
   * for what changes the business, not for looking at its own calls.
   */
  app.get("/api/search/calls", verifyJWT, async (req: any, res) => {
    const tenantId = await tenantOf(req, res);
    if (!tenantId) return;

    const f      = callFilters(req.query);
    const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    try {
      // 5,000 is roughly a large tenant's entire call history; past that the
      // unindexed path stops and says so rather than taking half a minute.
      const out = await searchCalls(sb, tenantId, f, limit, offset, 5000);
      res.json({
        rows: out.rows, has_more: out.hasMore,
        scanned: out.scanned, capped: out.capped, indexed: out.indexed,
      });
    } catch (e: any) {
      console.error("[search] calls failed:", e?.message || e);
      res.status(500).json({ error: "Could not search your calls just now. Please try again." });
    }
  });

  /**
   * Stream one CSV. `header` is written first, then `nextPage` is called
   * over and over until it reports itself done; it keeps its own place in
   * the table, because a page of calls can emit fewer rows than it read and
   * an offset counted from what was written would skip the difference.
   *
   * An error before the first byte is a normal 500 the browser can show. An
   * error after it cannot be — the download has already started — so the
   * failure is written INTO the file as its last row. A short CSV that says
   * why it is short is recoverable; one that just stops is not.
   */
  async function streamCsv(
    res: Response, filename: string, header: string[],
    nextPage: () => Promise<{ rows: string[][]; done: boolean }>,
  ) {
    let started = false, total = 0, pages = 0;
    try {
      for (;;) {
        const { rows, done } = await nextPage();
        if (!started) {
          started = true;
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
          // A customer list must not sit in a proxy or browser cache.
          res.setHeader("Cache-Control", "no-store");
          await write(res, BOM + csvRow(header) + CRLF);
        }
        if (rows.length) await write(res, rows.map(csvRow).join(CRLF) + CRLF);
        total += rows.length;
        pages += 1;
        if (done) break;
        // Two ceilings, so a runaway loop cannot stream forever: rows
        // written, and rows read (a text filter can discard most of them).
        if (total >= MAX_EXPORT_ROWS || pages * PAGE >= MAX_SCAN_ROWS) {
          await write(res, csvRow([`Stopped after ${total} rows — narrow the date range and download again`]) + CRLF);
          break;
        }
      }
      res.end();
      return total;
    } catch (e: any) {
      console.error(`[export] ${filename} failed:`, e?.message || e);
      if (!started) {
        res.status(500).json({ error: "Could not build the download just now. Please try again." });
      } else {
        await write(res, csvRow([`Download incomplete after ${total} rows — please try again`]) + CRLF);
        res.end();
      }
      return total;
    }
  }

  /**
   * GET /api/export/calls.csv — the calls list, filters and all.
   *
   * Transcripts are read whatever the filters are (they are a column of the
   * export), so a text search here matches in Node rather than through
   * search_calls(): the expensive part has already been paid for.
   */
  app.get("/api/export/calls.csv", verifyJWT, apiLimiter, async (req: any, res) => {
    const tenantId = await tenantOf(req, res);
    if (!tenantId) return;

    const f      = callFilters(req.query);
    const needle = f.q.toLowerCase();
    const digits = f.q.replace(/\D/g, "");

    let read = 0;
    const n = await streamCsv(res, `heynikki-calls-${istToday()}.csv`,
      ["Date (IST)", "Caller", "Direction", "Status", "Duration (seconds)",
       "Reason", "WhatsApp sent", "Appointment booked", "Transcript"],
      async () => {
        const { data, error } = await callsQuery(sb, tenantId, f, `${LIST_COLUMNS},transcript`)
          // created_at alone is not a stable sort: two calls in the same
          // second could swap between pages, so one is exported twice and
          // the other not at all.
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .range(read, read + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data as any[]) || [];
        read += batch.length;
        const rows = batch
          .filter(r => callMatches(r, needle, digits))
          .map(r => [
            istStamp(r.created_at), r.caller_number || "", label(r.direction),
            label(r.status), r.duration_seconds ?? 0, label(r.intent) || "Unknown",
            r.wa_sent ? "yes" : "no", r.appointment_created ? "yes" : "no",
            flattenTranscript(r.transcript),
          ]);
        return { rows, done: batch.length < PAGE };
      });

    await audit("export.calls", { tenantId, actorId: req.user.id, req, metadata: { rows: n, filters: f } });
  });

  /** GET /api/export/leads.csv — the leads list, same filters as /leads. */
  app.get("/api/export/leads.csv", verifyJWT, apiLimiter, async (req: any, res) => {
    const tenantId = await tenantOf(req, res);
    if (!tenantId) return;

    // select("*") rather than a column list: supabase/056's follow-up
    // columns may or may not exist yet, and naming one that does not turns
    // the whole export into a 400.
    const header = ["Name", "Phone", "Stage", "Score", "Wants", "Reason", "Notes",
                    "Tags", "Source", "Calls", "Deal value (₹)",
                    "Last contacted (IST)", "Added (IST)", "Follow-up (IST)", "Follow-up note"];

    let read = 0;
    const n = await streamCsv(res, `heynikki-leads-${istToday()}.csv`, header,
      async () => {
        const { data, error } = await leadsQuery(sb, tenantId, req.query, "*")
          .order("last_contacted_at", { ascending: false }).order("id", { ascending: false })
          .range(read, read + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data as any[]) || [];
        read += batch.length;
        const rows = batch.map(l => [
          l.name || "", l.phone || "", label(l.stage), l.score ?? 0,
          l.interest || "", label(l.intent), l.notes || "",
          (Array.isArray(l.tags) ? l.tags : []).join(" | "),
          label(l.source), l.call_count ?? 0,
          l.deal_value_paise ? Math.round(l.deal_value_paise / 100) : "",
          istStamp(l.last_contacted_at), istStamp(l.created_at),
          istStamp(l.follow_up_at), l.follow_up_note || "",
        ]);
        return { rows, done: batch.length < PAGE };
      });

    await audit("export.leads", { tenantId, actorId: req.user.id, req, metadata: { rows: n } });
  });

  /**
   * GET /api/export/appointments.csv
   *   from / to filter on slot_date — the day of the booking, which is what
   *   a business means by "September's appointments", not the day the call
   *   that made it happened to come in. slot_date is already a plain IST
   *   date, so it compares as-is.
   */
  app.get("/api/export/appointments.csv", verifyJWT, apiLimiter, async (req: any, res) => {
    const tenantId = await tenantOf(req, res);
    if (!tenantId) return;

    const one    = (v: any) => (typeof v === "string" ? v.trim() : "");
    const status = one(req.query.status) === "all" ? "" : one(req.query.status);
    const from   = DAY_RE.test(one(req.query.from)) ? one(req.query.from) : "";
    const to     = DAY_RE.test(one(req.query.to))   ? one(req.query.to)   : "";
    const needle = one(req.query.q).toLowerCase().slice(0, 120);

    let read = 0;
    const n = await streamCsv(res, `heynikki-appointments-${istToday()}.csv`,
      ["Date", "Time", "Name", "Number", "Service", "Status",
       "Booking ref", "WhatsApp confirmed", "Notes", "Booked on (IST)"],
      async () => {
        let q = sb.from("appointments")
          .select("caller_name,caller_number,service,slot_date,slot_time,status,booking_ref,wa_confirmed,notes,created_at,id")
          .eq("tenant_id", tenantId);
        if (status) q = q.eq("status", status);
        if (from)   q = q.gte("slot_date", from);
        if (to)     q = q.lte("slot_date", to);
        const { data, error } = await q
          .order("slot_date", { ascending: false }).order("id", { ascending: false })
          .range(read, read + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data as any[]) || [];
        read += batch.length;
        const rows = batch
          .filter(a => !needle
            || String(a.caller_name || "").toLowerCase().includes(needle)
            || String(a.caller_number || "").includes(needle)
            || String(a.service || "").toLowerCase().includes(needle))
          .map(a => [
            // "20 Sep 2026", matching every other date in these files —
            // slot_date alone printed 2026-09-20 beside "19 Sep 2026 13:57".
            a.slot_date ? istStamp(`${a.slot_date}T00:00:00+05:30`).replace(/ \d{2}:\d{2}$/, "") : "",
            a.slot_time || "", a.caller_name || "", a.caller_number || "",
            a.service || "", label(a.status), a.booking_ref || "",
            a.wa_confirmed ? "yes" : "no", a.notes || "", istStamp(a.created_at),
          ]);
        return { rows, done: batch.length < PAGE };
      });

    await audit("export.appointments", { tenantId, actorId: req.user.id, req, metadata: { rows: n } });
  });
}

/**
 * A jsonb transcript as one spreadsheet cell.
 *
 * `String(transcript)` gave "[object Object], [object Object]" for every
 * call in the old browser-side export. Capped below Excel's 32,767-character
 * cell limit, and when it is cut the cell SAYS it was cut — a transcript
 * that just stops reads like the call did.
 */
function flattenTranscript(transcript: unknown): string {
  const text = turns(transcript)
    .map(t => `${t?.role === "assistant" ? "Nikki" : "Caller"}: ${String(t?.content || "")}`)
    .join(" | ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 30_000 ? text.slice(0, 30_000) + " …(transcript trimmed to fit one cell)" : text;
}
