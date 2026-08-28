/**
 * Campaign recipient import, and the browser-reachable campaign controls.
 *
 * WHY THIS EXISTS SEPARATELY FROM outbound.ts
 * outbound.ts mounts /api/campaigns/:id/start, /pause and /recipients behind
 * verifyInternal — the shared INTERNAL_SECRET. That secret must never reach a
 * browser, so the dashboard could create a campaign and upload numbers (those
 * two paths are shadowed by verifyJWT copies registered earlier in index.ts)
 * and then had no way to START it. A customer could build a campaign and
 * never run it. Everything here is verifyJWT and scoped to the caller's own
 * tenant.
 *
 * FILE FORMATS
 * The canonical ingest is a rows array. CSV is parsed here — properly, see
 * parseCsv — because "split on commas" breaks on the first Indian address
 * containing one, silently shifting every later column. .xlsx is converted to
 * rows in the browser and posted to the same endpoint: the file never
 * touches the server, the user sees a preview before committing, and no
 * spreadsheet parser has to be trusted server-side.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, string>;

/**
 * RFC 4180 CSV. Handles quoted fields, embedded commas and newlines, and ""
 * as an escaped quote. Excel's "Save as CSV" produces exactly this.
 *
 * Hand-rolled rather than adding a dependency: the format is small and fully
 * specified, and the alternative (SheetJS) is deprecated on npm and now
 * published from the maintainer's own CDN, which is not a supply chain worth
 * taking on for one endpoint.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM — Excel writes one, and it would otherwise become part
  // of the first header name, so "phone" arrives as "﻿phone".
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"')  { inQuotes = true; continue; }
    if (c === ",")  { row.push(field); field = ""; continue; }
    if (c === "\r") continue;                           // CRLF from Excel
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));   // drop blank lines
}

/** Header aliases people actually use in their own sheets. */
const PHONE_KEYS = ["phone", "mobile", "number", "phone number", "mobile number",
                    "contact", "contact number", "phone_no", "mob", "cell", "whatsapp"];
const NAME_KEYS  = ["name", "first name", "first_name", "customer name",
                    "full name", "fullname", "contact name", "client name"];

const norm = (h: string) => h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

export function detectColumns(header: string[]): { phone: number; name: number } {
  const h = header.map(norm);
  const find = (keys: string[]) => {
    for (const k of keys) { const i = h.indexOf(k); if (i !== -1) return i; }
    // Fall back to a substring match so "Customer Mobile No." still resolves.
    for (let i = 0; i < h.length; i++) if (keys.some(k => h[i].includes(k))) return i;
    return -1;
  };
  return { phone: find(PHONE_KEYS), name: find(NAME_KEYS) };
}

/**
 * India E.164. Returns null for anything that is not a dialable 10-digit
 * mobile, which is the only thing this trunk can call.
 */
export function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let ten: string;
  if (digits.length === 10)                                   ten = digits;
  else if (digits.length === 11 && digits.startsWith("0"))     ten = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91"))    ten = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith("091"))   ten = digits.slice(3);
  else return null;
  // Indian mobile numbers start 6-9. Landlines and junk rows fail here rather
  // than burning a dial attempt and a retry cycle each.
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return `+91${ten}`;
}

export function mountCampaignImport(
  app: Express,
  sb: SupabaseClient,
  verifyJWT: (req: Request, res: Response, next: NextFunction) => void,
  getTenantId: (userId: string) => Promise<string | null>,
  audit: (action: string, meta: any) => Promise<void>,
) {
  /** Campaign must exist AND belong to the caller's tenant. */
  async function ownCampaign(req: any, res: Response): Promise<any | null> {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return null; }
    const { data: c } = await sb.from("outbound_campaigns")
      .select("*").eq("id", req.params.id).eq("tenant_id", tenantId).maybeSingle();
    if (!c) { res.status(404).json({ error: "Campaign not found" }); return null; }
    return c;
  }

  // ── Import recipients ───────────────────────────────────────
  // Accepts EITHER { csv: "<text>" } or { rows: [{phone,name}, ...] }.
  // consent_declared is required and recorded against the campaign: this
  // deployment has no DND scrub feed, so the declaration is what allows the
  // dispatcher to dial at all.
  app.post("/api/campaigns/:id/import", verifyJWT, async (req: any, res) => {
    try {
      const c = await ownCampaign(req, res);
      if (!c) return;

      const { csv, rows: rawRows, consent_declared } = req.body || {};
      if (!consent_declared) {
        return res.status(400).json({
          error: "consent_declared required — confirm every number on this list " +
                 "gave permission to be called",
        });
      }

      // Build a uniform list of {phone, name} from whichever shape arrived.
      let items: Row[] = [];
      if (typeof csv === "string" && csv.trim()) {
        const table = parseCsv(csv);
        if (table.length < 2) return res.status(400).json({ error: "CSV needs a header row and at least one data row" });
        const header = table[0];
        const col = detectColumns(header);
        if (col.phone === -1) {
          return res.status(400).json({
            error: "No phone column found",
            hint: `Rename a column to "phone". Saw: ${header.join(", ")}`,
          });
        }
        items = table.slice(1).map(r => ({
          phone: r[col.phone] ?? "",
          name:  col.name !== -1 ? (r[col.name] ?? "") : "",
        }));
      } else if (Array.isArray(rawRows)) {
        items = rawRows.map((r: any) => ({ phone: String(r.phone ?? ""), name: String(r.name ?? "") }));
      } else {
        return res.status(400).json({ error: "Provide csv text or a rows array" });
      }

      if (items.length === 0)     return res.status(400).json({ error: "No rows found" });
      if (items.length > 10000)   return res.status(400).json({ error: "Max 10,000 recipients per import" });

      // Validate, normalise, and de-duplicate WITHIN the file. Row numbers are
      // +2 (header is row 1, arrays are 0-based) so the number reported is the
      // one the user sees in Excel.
      const invalid: { row: number; value: string }[] = [];
      const dupes:   { row: number; value: string }[] = [];
      const seen = new Map<string, number>();
      const clean: { phone: string; name: string }[] = [];

      items.forEach((it, idx) => {
        const rowNo = idx + 2;
        const phone = normalizePhone(it.phone);
        if (!phone)          { invalid.push({ row: rowNo, value: it.phone }); return; }
        if (seen.has(phone)) { dupes.push({ row: rowNo, value: phone });      return; }
        seen.set(phone, rowNo);
        clean.push({ phone, name: (it.name || "").trim().slice(0, 120) });
      });

      if (clean.length === 0) {
        return res.status(400).json({
          error: "No valid phone numbers", invalid_count: invalid.length,
          invalid: invalid.slice(0, 20),
        });
      }

      const phones = clean.map(c2 => c2.phone);

      // Never dial someone who opted out, no matter what the sheet says.
      const optedOut = new Set<string>();
      for (let i = 0; i < phones.length; i += 500) {
        const { data } = await sb.from("outbound_opt_outs")
          .select("phone").eq("tenant_id", c.tenant_id).in("phone", phones.slice(i, i + 500));
        (data || []).forEach((o: any) => optedOut.add(o.phone));
      }

      // Already on this campaign from an earlier upload. Re-importing the same
      // sheet is a normal thing to do after fixing a few rows, and it must not
      // dial the untouched rows a second time.
      const already = new Set<string>();
      for (let i = 0; i < phones.length; i += 500) {
        const { data } = await sb.from("outbound_recipients")
          .select("phone").eq("campaign_id", c.id).in("phone", phones.slice(i, i + 500));
        (data || []).forEach((o: any) => already.add(o.phone));
      }

      const toInsert = clean.filter(x => !optedOut.has(x.phone) && !already.has(x.phone));

      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500).map(x => ({
          campaign_id: c.id,
          tenant_id:   c.tenant_id,
          phone:       x.phone,
          first_name:  x.name || null,
          status:      "pending",       // dispatcher scrubs before queueing
        }));
        const { error } = await sb.from("outbound_recipients").insert(chunk);
        if (error) {
          console.error("[import] insert failed:", error.message);
          return res.status(500).json({ error: "Insert failed", detail: error.message, inserted });
        }
        inserted += chunk.length;
      }

      // Record WHO accepted responsibility for this list, and when. Without a
      // DND feed this declaration is the only thing standing between the
      // tenant and a complaint, so it is stored, not just checked.
      if (!c.consent_declared) {
        await sb.from("outbound_campaigns").update({
          consent_declared: true,
          consent_by:       req.user.id,
          consent_at:       new Date().toISOString(),
        }).eq("id", c.id);
      }

      await audit("campaign_import", {
        tenantId: c.tenant_id, actorId: req.user.id,
        metadata: { campaign_id: c.id, inserted, invalid: invalid.length,
                    duplicates: dupes.length, opted_out: optedOut.size,
                    already_present: already.size },
      });

      res.json({
        ok: true,
        inserted,
        skipped: {
          invalid:         invalid.length,
          duplicates:      dupes.length,
          opted_out:       optedOut.size,
          already_present: already.size,
        },
        // Capped: a 10,000-row sheet of rubbish should not return a 10,000
        // item error array to a browser.
        invalid_rows:   invalid.slice(0, 50),
        duplicate_rows: dupes.slice(0, 50),
      });
    } catch (err: any) {
      console.error("[campaign import]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Build a campaign from the CRM instead of a spreadsheet ──
  // The people most worth calling are already in leads, with a stage, a
  // score and tags on them. Exporting them to a sheet and importing the
  // sheet back is a round trip that loses the link to the lead.
  //
  // Preview first: the same filter runs with head:true to return a count and
  // a sample, so nobody discovers they queued four thousand people by
  // watching the dialler start.
  app.post("/api/campaigns/:id/segment", verifyJWT, async (req: any, res) => {
    try {
      const c = await ownCampaign(req, res);
      if (!c) return;

      const { stages, min_score, max_score, tags, not_contacted_days,
              preview, consent_declared } = req.body || {};

      let q = sb.from("leads").select("id, phone, name, stage, score, tags", { count: "exact" })
        .eq("tenant_id", c.tenant_id);

      if (Array.isArray(stages) && stages.length) q = q.in("stage", stages.map(String));
      if (Number.isFinite(min_score)) q = q.gte("score", Number(min_score));
      if (Number.isFinite(max_score)) q = q.lte("score", Number(max_score));
      // contains, not overlaps: "tagged both hot AND hyderabad", which is
      // what someone picking two tags means.
      if (Array.isArray(tags) && tags.length) q = q.contains("tags", tags.map(String));
      if (Number.isFinite(not_contacted_days)) {
        const cutoff = new Date(Date.now() - Number(not_contacted_days) * 86400_000).toISOString();
        q = q.lt("last_contacted_at", cutoff);
      }

      const { data: leads, count, error } = await q.limit(10000);
      if (error) return res.status(400).json({ error: error.message });

      const phones = (leads || [])
        .map((l: any) => normalizePhone(l.phone))
        .filter(Boolean) as string[];

      // Opt-outs and anyone already on this campaign are excluded before the
      // count is shown, so the preview number is the number that will dial.
      const excluded = new Set<string>();
      for (const [table, col] of [["outbound_opt_outs", "phone"], ["outbound_recipients", "phone"]] as const) {
        for (let i = 0; i < phones.length; i += 500) {
          const slice = phones.slice(i, i + 500);
          const qq = table === "outbound_opt_outs"
            ? sb.from(table).select(col).eq("tenant_id", c.tenant_id).in(col, slice)
            : sb.from(table).select(col).eq("campaign_id", c.id).in(col, slice);
          const { data } = await qq;
          (data || []).forEach((r: any) => excluded.add(r.phone));
        }
      }

      const chosen = (leads || []).filter((l: any) => {
        const p = normalizePhone(l.phone);
        return p && !excluded.has(p);
      });

      if (preview) {
        return res.json({
          ok: true, matched: count ?? chosen.length, will_add: chosen.length,
          excluded: excluded.size,
          sample: chosen.slice(0, 10).map((l: any) => ({ name: l.name, phone: l.phone, stage: l.stage, score: l.score })),
        });
      }

      if (!consent_declared) {
        return res.status(400).json({
          error: "consent_declared required — confirm these contacts agreed to be called",
        });
      }
      if (!chosen.length) return res.status(400).json({ error: "No leads match that segment" });

      let inserted = 0;
      for (let i = 0; i < chosen.length; i += 500) {
        const chunk = chosen.slice(i, i + 500).map((l: any) => ({
          campaign_id: c.id,
          tenant_id:   c.tenant_id,
          phone:       normalizePhone(l.phone),
          first_name:  l.name || null,
          status:      "pending",
        }));
        const { error: insErr } = await sb.from("outbound_recipients").insert(chunk);
        if (insErr) return res.status(500).json({ error: insErr.message, inserted });
        inserted += chunk.length;
      }

      if (!c.consent_declared) {
        await sb.from("outbound_campaigns").update({
          consent_declared: true, consent_by: req.user.id,
          consent_at: new Date().toISOString(),
        }).eq("id", c.id);
      }

      await audit("campaign_segment", {
        tenantId: c.tenant_id, actorId: req.user.id,
        metadata: { campaign_id: c.id, inserted, excluded: excluded.size,
                    filters: { stages, min_score, max_score, tags, not_contacted_days } },
      });
      res.json({ ok: true, inserted, excluded: excluded.size });
    } catch (err: any) {
      console.error("[campaign segment]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Start / pause, reachable from the dashboard ─────────────
  app.post("/api/campaigns/:id/start", verifyJWT, async (req: any, res) => {
    const c = await ownCampaign(req, res);
    if (!c) return;
    if (c.status === "running") return res.status(400).json({ error: "Already running" });
    if (!c.consent_declared) {
      return res.status(400).json({
        error: "This campaign has no consent declaration — import a list first",
      });
    }
    const { count } = await sb.from("outbound_recipients")
      .select("id", { count: "exact", head: true }).eq("campaign_id", c.id);
    if (!count) return res.status(400).json({ error: "No recipients imported yet" });

    await sb.from("outbound_campaigns")
      .update({ status: "running", started_at: new Date().toISOString() }).eq("id", c.id);
    await audit("campaign_start", { tenantId: c.tenant_id, actorId: req.user.id,
                                    metadata: { campaign_id: c.id, recipients: count } });
    res.json({ ok: true, status: "running", recipients: count });
  });

  app.post("/api/campaigns/:id/pause", verifyJWT, async (req: any, res) => {
    const c = await ownCampaign(req, res);
    if (!c) return;
    await sb.from("outbound_campaigns").update({ status: "paused" }).eq("id", c.id);
    await audit("campaign_pause", { tenantId: c.tenant_id, actorId: req.user.id,
                                    metadata: { campaign_id: c.id } });
    res.json({ ok: true, status: "paused" });
  });

  // ── Progress, for the dashboard ─────────────────────────────
  app.get("/api/campaigns/:id/progress", verifyJWT, async (req: any, res) => {
    const c = await ownCampaign(req, res);
    if (!c) return;
    const { data } = await sb.from("outbound_recipients")
      .select("status").eq("campaign_id", c.id);
    const counts: Record<string, number> = {};
    (data || []).forEach((r: any) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    res.json({ ok: true, status: c.status, total: (data || []).length, by_status: counts });
  });
}
