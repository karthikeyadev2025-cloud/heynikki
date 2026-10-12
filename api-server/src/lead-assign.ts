/**
 * A list of numbers in, shared out to the team.
 *
 * The Leads page could import a CSV and that was all: the rows landed
 * unowned, in the browser, checked for duplicates against only the first
 * 1,000 leads, and the only way to give one to a telecaller was to open it.
 * A business that buys a list of 2,000 numbers needs them split across
 * five people before anyone can start.
 *
 *   POST /api/leads/import     numbers (a name and note are optional) → leads,
 *                              optionally dealt out to chosen telecallers
 *   POST /api/leads/assign     hand chosen leads — or one person's whole
 *                              open list — to others, or back to the pool
 *   GET  /api/leads/team-load  what each telecaller is holding right now
 *
 * All three are the owner's. A telecaller works what they are given, from
 * the Desk queue, which already serves "mine, then the pool".
 */
import type { Express, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "./roles";
import { istDayStartMs } from "./attendance";

type Deps = {
  sb: SupabaseClient;
  verifyJWT: RequestHandler;
  getTenantId: (userId: string) => Promise<string | null>;
};

const OPEN_STAGES = ["new", "contacted", "qualified"];
const MAX_IMPORT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── pure shaping (tested) ──────────────────────────────────── */

export type RawRow = { phone?: unknown; name?: unknown; note?: unknown };
export type CleanRow = { phone: string; name: string | null; note: string | null };

/**
 * Indian mobiles only, as ten digits. Excel hands numbers over in every
 * shape — 9876543210, +91 98765 43210, 09876543210, 919876543210, and
 * 9.87654321E9 when the column was left as a number.
 */
export function cleanPhone(v: unknown): string | null {
  let s = String(v ?? "").trim();
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = Number(s).toFixed(0);
  let d = s.replace(/\.0+$/, "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** Valid rows once each, with a count of what was dropped and why. */
export function cleanRows(rows: RawRow[]): { rows: CleanRow[]; invalid: number; repeated: number } {
  const seen = new Set<string>();
  const out: CleanRow[] = [];
  let invalid = 0, repeated = 0;
  const text = (v: unknown, max: number) => {
    const s = String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
    return s || null;
  };
  for (const r of rows) {
    const phone = cleanPhone(r?.phone);
    if (!phone) { invalid += 1; continue; }
    if (seen.has(phone)) { repeated += 1; continue; }
    seen.add(phone);
    out.push({ phone, name: text(r.name, 80), note: text(r.note, 300) });
  }
  return { rows: out, invalid, repeated };
}

/**
 * Deal items out one at a time, starting with whoever holds least, so two
 * uploads in a row do not both favour the first name on the list.
 */
export function dealOut<T>(items: T[], users: string[], holding: Record<string, number> = {}): Map<string, T[]> {
  const out = new Map<string, T[]>(users.map(u => [u, []]));
  if (!users.length) return out;
  const load = new Map(users.map(u => [u, holding[u] || 0]));
  for (const it of items) {
    let pick = users[0];
    for (const u of users) if (load.get(u)! < load.get(pick)!) pick = u;
    out.get(pick)!.push(it);
    load.set(pick, load.get(pick)! + 1);
  }
  return out;
}

/* ── routes ─────────────────────────────────────────────────── */

export function mountLeadAssignRoutes(app: Express, deps: Deps) {
  const { sb, verifyJWT, getTenantId } = deps;

  async function owner(req: any, res: any, what: string) {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return null; }
    if (!(await requireOwner(sb, req.user.id, tenantId, res, `Only the owner can ${what}.`))) return null;
    return tenantId;
  }

  async function team(tenantId: string) {
    const { data } = await sb.from("tenant_users").select("user_id, role, display_name").eq("tenant_id", tenantId);
    return (data || []) as { user_id: string; role: string; display_name: string | null }[];
  }

  /** Every row of a query, past PostgREST's 1,000-row page. */
  async function all<T>(build: (from: number, to: number) => any, max = 20000): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; from < max; from += 1000) {
      const { data, error } = await build(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  /** Open leads each person holds, for dealing fairly. */
  async function holding(tenantId: string): Promise<Record<string, number>> {
    const rows = await all<{ assigned_to: string }>((a, b) => sb.from("leads").select("assigned_to")
      .eq("tenant_id", tenantId).in("stage", OPEN_STAGES).not("assigned_to", "is", null).order("id").range(a, b));
    const h: Record<string, number> = {};
    for (const r of rows) h[r.assigned_to] = (h[r.assigned_to] || 0) + 1;
    return h;
  }

  function pickMembers(raw: unknown, members: { user_id: string }[]): string[] | null {
    const ids = Array.isArray(raw) ? [...new Set(raw.map(String))] : [];
    const known = new Set(members.map(m => m.user_id));
    return ids.every(i => known.has(i)) ? ids : null;
  }

  async function setOwner(tenantId: string, plan: Map<string | null, string[]>) {
    let moved = 0;
    for (const [user, ids] of plan) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error, count } = await sb.from("leads").update({ assigned_to: user }, { count: "exact" })
          .eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
        if (error) throw new Error(error.message);
        moved += count || 0;
      }
    }
    return moved;
  }

  // ── Import ─────────────────────────────────────────────────────────
  app.post("/api/leads/import", verifyJWT, async (req: any, res) => {
    const tenantId = await owner(req, res, "import a list"); if (!tenantId) return;
    const raw = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!raw.length) return res.status(400).json({ error: "The file has no rows." });
    if (raw.length > MAX_IMPORT) return res.status(400).json({ error: `Upload up to ${MAX_IMPORT.toLocaleString("en-IN")} numbers at a time.` });
    const members = await team(tenantId);
    const to = pickMembers(req.body?.assign_to, members);
    if (!to) return res.status(400).json({ error: "One of the chosen people is not on your team." });
    const listName = String(req.body?.list_name || "").replace(/[^\w .&()-]/g, "").trim().slice(0, 40);

    const { rows, invalid, repeated } = cleanRows(raw);
    if (!rows.length) return res.status(400).json({ error: "No valid 10-digit Indian mobile numbers found in the file." });
    try {
      // Skip people this business already has, and anyone who asked not to
      // be contacted — a fresh list must not put them back in a call queue.
      const [have, optOuts] = await Promise.all([
        all<{ phone: string }>((a, b) => sb.from("leads").select("phone").eq("tenant_id", tenantId).order("id").range(a, b), 200000),
        all<{ phone: string }>((a, b) => sb.from("outbound_opt_outs").select("phone").eq("tenant_id", tenantId).order("phone").range(a, b)),
      ]);
      const ten = (p: string) => String(p || "").replace(/\D/g, "").slice(-10);
      const haveSet = new Set(have.map(l => ten(l.phone)));
      const outSet = new Set(optOuts.map(o => ten(o.phone)));
      const existing = rows.filter(r => haveSet.has(r.phone)).length;
      const optedOut = rows.filter(r => !haveSet.has(r.phone) && outSet.has(r.phone)).length;
      const fresh = rows.filter(r => !haveSet.has(r.phone) && !outSet.has(r.phone));

      const deal = dealOut(fresh, to, to.length ? await holding(tenantId) : {});
      const ownerOf = new Map<string, string>();
      for (const [u, list] of deal) for (const r of list) ownerOf.set(r.phone, u);
      const insert = fresh.map(r => ({
        tenant_id: tenantId, phone: r.phone, name: r.name, interest: r.note, stage: "new", source: "import",
        assigned_to: ownerOf.get(r.phone) || null, tags: listName ? [listName] : [],
        // The column defaults to now() and 1, which would mark a number
        // nobody has rung as already contacted.
        last_contacted_at: null, call_count: 0,
      }));
      let added = 0;
      for (let i = 0; i < insert.length; i += 500) {
        const { error } = await sb.from("leads").insert(insert.slice(i, i + 500));
        if (error) {
          console.error("[lead import]", error.message);
          return res.status(500).json({ error: added
            ? `${added} numbers were added, then the import stopped. Upload the file again — the ones already in are skipped.`
            : "Could not save the list." });
        }
        added += Math.min(500, insert.length - i);
      }
      const nameOf = new Map(members.map(m => [m.user_id, m.display_name || "Team member"]));
      res.json({
        added, existing, opted_out: optedOut, invalid, repeated, list_name: listName || null,
        shared: Array.from(deal, ([u, list]) => ({ user_id: u, name: nameOf.get(u), count: list.length })),
      });
    } catch (e: any) {
      console.error("[lead import]", e.message);
      res.status(500).json({ error: "Could not save the list." });
    }
  });

  // ── Assign ─────────────────────────────────────────────────────────
  // Either `ids` (ticked on the Leads page) or `from` — a person's user id,
  // or "pool" for unowned leads — to move a whole open list, e.g. when a
  // telecaller is on leave. `to: []` returns them to the pool.
  app.post("/api/leads/assign", verifyJWT, async (req: any, res) => {
    const tenantId = await owner(req, res, "assign leads"); if (!tenantId) return;
    const members = await team(tenantId);
    const to = pickMembers(req.body?.to, members);
    if (!to) return res.status(400).json({ error: "One of the chosen people is not on your team." });
    try {
      let ids: string[] = [];
      if (Array.isArray(req.body?.ids)) {
        ids = [...new Set<string>(req.body.ids.map(String))].filter(i => UUID.test(i)).slice(0, 5000);
      } else {
        const from = String(req.body?.from || "");
        if (from !== "pool" && !members.some(m => m.user_id === from)) return res.status(400).json({ error: "Choose whose leads to move." });
        const limit = Math.max(1, Math.min(5000, parseInt(req.body?.limit) || 5000));
        const rows = await all<{ id: string }>((a, b) => {
          let q = sb.from("leads").select("id").eq("tenant_id", tenantId).in("stage", OPEN_STAGES);
          q = from === "pool" ? q.is("assigned_to", null) : q.eq("assigned_to", from);
          if (req.body?.untouched_only) q = q.is("last_contacted_at", null);
          return q.order("created_at", { ascending: true }).order("id").range(a, b);
        }, limit);
        ids = rows.slice(0, limit).map(r => r.id);
      }
      if (!ids.length) return res.status(400).json({ error: "There are no leads to move." });
      const plan = new Map<string | null, string[]>(to.length ? dealOut(ids, to, await holding(tenantId)) : [[null, ids]]);
      const moved = await setOwner(tenantId, plan);
      const nameOf = new Map(members.map(m => [m.user_id, m.display_name || "Team member"]));
      res.json({ moved, shared: Array.from(plan, ([u, list]) => ({ user_id: u, name: u ? nameOf.get(u) : "Unassigned", count: list.length })) });
    } catch (e: any) {
      console.error("[lead assign]", e.message);
      res.status(500).json({ error: "Could not assign those leads." });
    }
  });

  // ── What each person is holding ────────────────────────────────────
  app.get("/api/leads/team-load", verifyJWT, async (req: any, res) => {
    const tenantId = await owner(req, res, "see the team's lists"); if (!tenantId) return;
    try {
      const nowIso = new Date().toISOString();
      const [members, open, calls] = await Promise.all([
        team(tenantId),
        all<any>((a, b) => sb.from("leads").select("assigned_to, last_contacted_at, follow_up_at, follow_up_done_at")
          .eq("tenant_id", tenantId).in("stage", OPEN_STAGES).order("id").range(a, b), 50000),
        all<any>((a, b) => sb.from("click_to_call_log").select("agent_user_id, disposition")
          .eq("tenant_id", tenantId).gte("created_at", new Date(istDayStartMs(Date.now())).toISOString()).order("id").range(a, b)),
      ]);
      const blank = () => ({ open: 0, untouched: 0, callbacks_due: 0, calls_today: 0, no_outcome: 0 });
      const by = new Map<string, ReturnType<typeof blank>>();
      const row = (k: string) => by.get(k) || by.set(k, blank()).get(k)!;
      for (const l of open) {
        const r = row(l.assigned_to || "pool");
        r.open += 1;
        if (!l.last_contacted_at) r.untouched += 1;
        if (l.follow_up_at && !l.follow_up_done_at && l.follow_up_at <= nowIso) r.callbacks_due += 1;
      }
      for (const c of calls) {
        if (!c.agent_user_id) continue;
        const r = row(c.agent_user_id);
        r.calls_today += 1;
        if (!c.disposition) r.no_outcome += 1;
      }
      res.json({
        members: members.map(m => ({ user_id: m.user_id, name: m.display_name || "", role: m.role,
          is_you: m.user_id === req.user.id, ...row(m.user_id) })),
        pool: row("pool"),
      });
    } catch (e: any) {
      console.error("[team load]", e.message);
      res.status(500).json({ error: "Could not load the team's lists." });
    }
  });
}
