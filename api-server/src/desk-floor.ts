/**
 * The owner's side of the calling floor.
 *
 *   GET  /api/desk/floor            who is on a call, free, away or not in — now
 *   POST /api/desk/floor/listen     ring the owner's browser into a live call
 *   GET  /api/desk/rules            the automatic rules for this business
 *   POST /api/desk/rules            change them
 *
 * and two jobs the scheduler runs:
 *   runStaleLeadRule   an assigned lead nobody has rung in N days moves on
 *   runTeamReports     the day, per telecaller, to the owner each evening
 *
 * Rules live in platform_config under "desk_rules:<tenant>", so they need no
 * migration.
 */
import type { Express, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOwner } from "./roles";
import { CONVERSATION_SECS, istDayStartMs } from "./attendance";
import { dealOut } from "./lead-assign";

const OPEN_STAGES = ["new", "contacted", "qualified"];
const DAY_MS = 86400_000;

/* ── pure shaping (tested) ──────────────────────────────────── */

export type Rules = { stale_days: number; stale_to: "pool" | "team"; team_report: boolean };
export const DEFAULT_RULES: Rules = { stale_days: 0, stale_to: "pool", team_report: true };

/** Whatever was stored or posted, as rules that are safe to act on. */
export function cleanRules(raw: any): Rules {
  const d = Math.floor(Number(raw?.stale_days));
  return {
    stale_days: Number.isFinite(d) && d >= 1 && d <= 60 ? d : 0,
    stale_to: raw?.stale_to === "team" ? "team" : "pool",
    team_report: raw?.team_report !== false,
  };
}

export type StaleLead = { id: string; assigned_to: string | null; last_contacted_at: string | null;
  updated_at: string | null; created_at: string; follow_up_at: string | null; follow_up_done_at: string | null };

/**
 * Leads that have sat with someone for `days` without a call. A lead with
 * a callback still to come is parked on purpose and is left alone. The
 * clock starts at whichever is latest: the last call, or the last time the
 * lead was touched (being assigned touches it), so a list handed over this
 * morning is not taken away this afternoon.
 */
export function staleLeads(rows: StaleLead[], days: number, now = Date.now()): StaleLead[] {
  if (days < 1) return [];
  const cut = now - days * DAY_MS;
  return rows.filter(l => {
    if (!l.assigned_to) return false;
    if (l.follow_up_at && !l.follow_up_done_at && Date.parse(l.follow_up_at) > now) return false;
    const last = Math.max(Date.parse(l.last_contacted_at || "") || 0, Date.parse(l.updated_at || "") || 0, Date.parse(l.created_at) || 0);
    return last < cut;
  });
}

export type Presence = "on_call" | "free" | "away" | "out";
/** One word for where a person is, in the order that matters to an owner. */
export function presence(p: { on_call: boolean; checked_in: boolean; phone_online: boolean }): Presence {
  if (p.on_call) return "on_call";
  if (!p.checked_in) return "out";
  return p.phone_online ? "free" : "away";
}

export type DayRow = { name: string; calls: number; conversations: number; booked: number; interested: number;
  target_calls: number; no_outcome: number };
/** The evening report, as lines. Empty when nobody made a call. */
export function teamReportLines(rows: DayRow[]): string[] {
  return rows.filter(r => r.calls > 0 || r.target_calls > 0).sort((a, b) => b.calls - a.calls).map(r => {
    const bits = [`${r.calls} call${r.calls === 1 ? "" : "s"}`, `${r.conversations} conversation${r.conversations === 1 ? "" : "s"}`];
    if (r.booked) bits.push(`${r.booked} booked`);
    if (r.interested) bits.push(`${r.interested} interested`);
    if (r.no_outcome) bits.push(`${r.no_outcome} with no outcome saved`);
    const target = r.target_calls ? (r.calls >= r.target_calls ? " — target met" : ` — ${r.target_calls - r.calls} short of ${r.target_calls}`) : "";
    return `${r.name}: ${bits.join(", ")}${target}`;
  });
}

/* ── shared reads ───────────────────────────────────────────── */

const rulesKey = (tenantId: string) => `desk_rules:${tenantId}`;

export async function readRules(sb: SupabaseClient, tenantId: string): Promise<Rules> {
  const { data } = await sb.from("platform_config").select("value").eq("key", rulesKey(tenantId)).maybeSingle();
  try { return data?.value ? cleanRules(JSON.parse(data.value)) : DEFAULT_RULES; } catch { return DEFAULT_RULES; }
}

async function team(sb: SupabaseClient, tenantId: string) {
  const { data } = await sb.from("tenant_users").select("user_id, role, display_name").eq("tenant_id", tenantId);
  return (data || []) as { user_id: string; role: string; display_name: string | null }[];
}

async function dayRows(sb: SupabaseClient, tenantId: string, now = Date.now()): Promise<(DayRow & { user_id: string })[]> {
  const startIso = new Date(istDayStartMs(now)).toISOString();
  const [members, calls, targets] = await Promise.all([
    team(sb, tenantId),
    sb.from("click_to_call_log").select("agent_user_id, duration_seconds, disposition")
      .eq("tenant_id", tenantId).gte("created_at", startIso).limit(5000),
    sb.from("seat_targets").select("user_id, daily_calls").eq("tenant_id", tenantId),
  ]);
  return members.map(m => {
    const mine = (calls.data || []).filter((c: any) => c.agent_user_id === m.user_id);
    return {
      user_id: m.user_id, name: m.display_name || "Team member",
      calls: mine.length,
      conversations: mine.filter((c: any) => (Number(c.duration_seconds) || 0) >= CONVERSATION_SECS).length,
      booked: mine.filter((c: any) => c.disposition === "booked").length,
      interested: mine.filter((c: any) => c.disposition === "interested").length,
      no_outcome: mine.filter((c: any) => !c.disposition).length,
      target_calls: Number((targets.data || []).find((t: any) => t.user_id === m.user_id)?.daily_calls) || 0,
    };
  });
}

/* ── jobs ───────────────────────────────────────────────────── */

type Push = (userIds: string[], msg: { title: string; body: string; data?: Record<string, string> }) => Promise<number>;

/** Move on every lead that has sat uncalled past its business's limit. */
export async function runStaleLeadRule(sb: SupabaseClient, push?: Push, now = Date.now()): Promise<number> {
  const { data: cfg } = await sb.from("platform_config").select("key, value").like("key", "desk_rules:%");
  let moved = 0;
  for (const c of cfg || []) {
    const tenantId = String(c.key).slice("desk_rules:".length);
    let rules: Rules;
    try { rules = cleanRules(JSON.parse(c.value)); } catch { continue; }
    if (!rules.stale_days) continue;
    const cutIso = new Date(now - rules.stale_days * DAY_MS).toISOString();
    const { data: rows, error } = await sb.from("leads")
      .select("id, assigned_to, last_contacted_at, updated_at, created_at, follow_up_at, follow_up_done_at")
      .eq("tenant_id", tenantId).in("stage", OPEN_STAGES).not("assigned_to", "is", null)
      .lt("updated_at", cutIso).order("updated_at", { ascending: true }).limit(500);
    if (error) { console.error("[stale leads]", error.message); continue; }
    const stale = staleLeads((rows || []) as StaleLead[], rules.stale_days, now);
    if (!stale.length) continue;

    const members = await team(sb, tenantId);
    // Shared between the others: each lead goes to someone who is not the
    // person who let it sit. With one person on the team there is no one
    // else, so it goes back to the pool.
    const plan = new Map<string | null, string[]>();
    for (const [from, list] of groupBy(stale, l => l.assigned_to!)) {
      const others = rules.stale_to === "team" ? members.map(m => m.user_id).filter(u => u !== from) : [];
      if (!others.length) { plan.set(null, [...(plan.get(null) || []), ...list.map(l => l.id)]); continue; }
      for (const [u, ids] of dealOut(list.map(l => l.id), others)) plan.set(u, [...(plan.get(u) || []), ...ids]);
    }
    let here = 0;
    for (const [user, ids] of plan) {
      for (let i = 0; i < ids.length; i += 200) {
        const { error: upErr, count } = await sb.from("leads").update({ assigned_to: user }, { count: "exact" })
          .eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
        if (upErr) console.error("[stale leads] move:", upErr.message); else here += count || 0;
      }
    }
    moved += here;
    if (here && push) {
      const owners = members.filter(m => ["owner", "super_admin"].includes(m.role)).map(m => m.user_id);
      await push(owners, { title: "Leads moved on", data: { type: "leads" },
        body: `${here} lead${here === 1 ? "" : "s"} had no call in ${rules.stale_days} day${rules.stale_days === 1 ? "" : "s"} and ${rules.stale_to === "team" ? "went to other telecallers" : "went back to unassigned"}.` }).catch(() => 0);
    }
  }
  return moved;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) (m.get(key(it)) || m.set(key(it), []).get(key(it))!).push(it);
  return m;
}

/**
 * Each evening, the day per telecaller, to the owner: by email and as a
 * phone alert. Once per business per IST day, marked in wa_dispatch_log as
 * the morning briefing is. Silent when the desk made no calls.
 */
export async function runTeamReports(sb: SupabaseClient, deps: {
  email: (to: string, subject: string, html: string) => Promise<boolean>;
  ownerEmail: (ownerId: string | null) => Promise<string | null>;
  push?: Push;
}, now = Date.now()): Promise<number> {
  const istMin = Math.floor(((now + 5.5 * 3600_000) % DAY_MS) / 60000);
  if (istMin < 19 * 60 || istMin >= 20 * 60) return 0;
  const startIso = new Date(istDayStartMs(now)).toISOString();
  const { data: active } = await sb.from("click_to_call_log").select("tenant_id").gte("created_at", startIso).limit(5000);
  const tenants = [...new Set((active || []).map((r: any) => r.tenant_id).filter(Boolean))];
  let sent = 0;
  for (const tenantId of tenants) {
    if (!(await readRules(sb, tenantId)).team_report) continue;
    const { data: done } = await sb.from("wa_dispatch_log").select("id").eq("tenant_id", tenantId)
      .eq("message_type", "team_report_email").gte("sent_at", startIso).limit(1);
    if (done?.length) continue;
    const rows = await dayRows(sb, tenantId, now);
    const lines = teamReportLines(rows);
    if (!lines.length) continue;
    const { data: t } = await sb.from("tenants").select("name, owner_id").eq("id", tenantId).maybeSingle();
    const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const total = rows.reduce((n, r) => n + r.calls, 0), booked = rows.reduce((n, r) => n + r.booked, 0);
    const headline = `${total} call${total === 1 ? "" : "s"} today, ${booked} booked`;
    const to = await deps.ownerEmail(t?.owner_id || null);
    const ok = to ? await deps.email(to, `${(t?.name || "Your team").trim()} — today's calling report`,
      `<p><strong>${esc(headline)}.</strong></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` +
      `<p><a href="https://heynikki.in/floor">Open the team floor</a></p>`) : false;
    if (deps.push) {
      const owners = (await team(sb, tenantId)).filter(m => ["owner", "super_admin"].includes(m.role)).map(m => m.user_id);
      await deps.push(owners, { title: "Today's calling report", body: `${headline}. ${lines[0]}`, data: { type: "team_report" } }).catch(() => 0);
    }
    await sb.from("wa_dispatch_log").insert({ tenant_id: tenantId, message_type: "team_report_email",
      to_number: to || "push", message_body: `${headline}\n${lines.join("\n")}`, status: ok ? "sent" : "failed" })
      .then(r => r.error && console.error("[team report] marker:", r.error.message));
    sent += 1;
  }
  return sent;
}

/* ── routes ─────────────────────────────────────────────────── */

type Deps = {
  sb: SupabaseClient;
  verifyJWT: RequestHandler;
  getTenantId: (userId: string) => Promise<string | null>;
  audit: (action: string, o: any) => Promise<any>;
  /** uuids of channels FreeSWITCH has up right now. */
  liveUuids: () => Promise<Set<string>>;
  seatOnline: (userId: string) => boolean;
  /** Ring this person's browser into the call. Throws a short reason. */
  listenIn: (userId: string, uuid: string) => Promise<void>;
};

export function mountDeskFloorRoutes(app: Express, deps: Deps) {
  const { sb, verifyJWT, getTenantId, audit } = deps;
  async function owner(req: any, res: any, what: string) {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return null; }
    if (!(await requireOwner(sb, req.user.id, tenantId, res, `Only the owner can ${what}.`))) return null;
    return tenantId;
  }

  app.get("/api/desk/floor", verifyJWT, async (req: any, res) => {
    const tenantId = await owner(req, res, "see the team floor"); if (!tenantId) return;
    try {
      const now = Date.now();
      const [rows, att, recent, live] = await Promise.all([
        dayRows(sb, tenantId, now),
        sb.from("seat_attendance").select("user_id, check_in_at").eq("tenant_id", tenantId).is("check_out_at", null),
        sb.from("click_to_call_log").select("id, agent_user_id, callee_number, lead_id, freeswitch_uuid, created_at, customer_answered_at")
          .eq("tenant_id", tenantId).gte("created_at", new Date(now - 3 * 3600_000).toISOString())
          .not("freeswitch_uuid", "is", null).order("created_at", { ascending: false }).limit(200),
        deps.liveUuids(),
      ]);
      const onCall = new Map<string, any>();
      for (const c of (recent.data || []) as any[]) {
        if (c.agent_user_id && live.has(c.freeswitch_uuid) && !onCall.has(c.agent_user_id)) onCall.set(c.agent_user_id, c);
      }
      const leadIds = [...new Set([...onCall.values()].map(c => c.lead_id).filter(Boolean))];
      const { data: leads } = leadIds.length ? await sb.from("leads").select("id, name").in("id", leadIds) : { data: [] as any[] };
      const leadName = new Map<string, string>((leads || []).map((l: any) => [l.id, l.name]));
      const inAt = new Map<string, string>(((att.data || []) as any[]).map(a => [a.user_id, a.check_in_at]));
      const people = rows.map(r => {
        const c = onCall.get(r.user_id);
        const state = presence({ on_call: !!c, checked_in: inAt.has(r.user_id), phone_online: deps.seatOnline(r.user_id) });
        return { ...r, is_you: r.user_id === req.user.id, state, checked_in_at: inAt.get(r.user_id) || null,
          call: c ? { id: c.id, number: String(c.callee_number || "").replace(/\D/g, "").slice(-10), name: leadName.get(c.lead_id) || null,
            since: c.customer_answered_at || c.created_at, talking: !!c.customer_answered_at } : null };
      });
      res.json({ people, rules: await readRules(sb, tenantId), can_listen: deps.seatOnline(req.user.id) });
    } catch (e: any) {
      console.error("[floor]", e.message);
      res.status(500).json({ error: "Could not load the floor." });
    }
  });

  app.post("/api/desk/floor/listen", verifyJWT, async (req: any, res) => {
    const tenantId = await owner(req, res, "listen to a call"); if (!tenantId) return;
    const { data: c } = await sb.from("click_to_call_log").select("id, freeswitch_uuid, agent_user_id")
      .eq("id", String(req.body?.call_id || "")).eq("tenant_id", tenantId).maybeSingle();
    if (!c?.freeswitch_uuid) return res.status(404).json({ error: "That call is not on the line." });
    try {
      await deps.listenIn(req.user.id, c.freeswitch_uuid);
      await audit("desk.listen_in", { tenantId, actorId: req.user.id, req, metadata: { call_id: c.id, agent: c.agent_user_id } });
      res.json({ ok: true });
    } catch (e: any) {
      const why = String(e?.message || "");
      res.status(409).json({ error: why === "browser_offline" ? "Turn on \"This computer\" on the Desk first, so the call has somewhere to ring."
        : why === "call_ended" ? "That call has just ended."
        : "Your browser phone did not answer. Answer the ring to start listening." });
    }
  });

  app.get("/api/desk/rules", verifyJWT, async (req: any, res) => {
    const tenantId = await owner(req, res, "see the rules"); if (!tenantId) return;
    res.json({ rules: await readRules(sb, tenantId) });
  });

  app.post("/api/desk/rules", verifyJWT, async (req: any, res) => {
    const tenantId = await owner(req, res, "change the rules"); if (!tenantId) return;
    const rules = cleanRules(req.body || {});
    const { error } = await sb.from("platform_config").upsert({ key: rulesKey(tenantId), value: JSON.stringify(rules),
      label: "Desk rules", updated_by: req.user.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) { console.error("[rules]", error.message); return res.status(500).json({ error: "Could not save the rules." }); }
    await audit("desk.rules_set", { tenantId, actorId: req.user.id, req, metadata: rules });
    res.json({ ok: true, rules });
  });
}
