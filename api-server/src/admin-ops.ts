/**
 * Super Admin: the three things an operator needed on 22 Sep and could not see.
 *
 *  1. COMMAND CENTER — what is broken right now, and is there room on the line.
 *     The watchdog already decides what is broken (watchdog.ts) and emails it;
 *     the console never showed it, so the Jio trunk sat down for 23 hours with
 *     a dashboard that looked fine. Capacity is the same channel ledger every
 *     outbound call is admitted through (esl.ts, trunkAdmit), so what this
 *     shows is what a telecaller's next click will actually be told.
 *
 *  2. TELECALLERS — calls, connects, talk time and outcomes per human seat,
 *     from click_to_call_log. The tenant's own Desk page lists a seat's recent
 *     calls; nothing compared seats against each other.
 *
 *  3. USAGE vs LIMITS — seats and minutes per tenant against the plan. Seats
 *     count people plus unaccepted invites, and minutes come from minutesGate,
 *     the same checks the invite route and every dial path enforce. A number
 *     here that disagreed with the gate would be worse than no number.
 *
 * Mounted from index.ts like admin-extras.ts. Read-only: nothing here writes.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fsl, pendingClickToCallLegs, trunkLimits } from "./esl";
import { minutesGate } from "./usage";

export type AdminOpsDeps = {
  sb: SupabaseClient;
  verifySuperAdmin: (req: Request, res: Response, next: NextFunction) => any;
};

/* ── Watchdog condition titles ─────────────────────────────────
 * The watchdog persists episodes by id only. These are its titles, so the
 * console says what the email said. An id not listed here still shows, as
 * its id, rather than being dropped. */
const ALERT_TITLES: Record<string, string> = {
  trunk_fault:          "Outbound trunk is rejecting calls",
  trunk_gateway_down:   "Jio trunk is down: calls cannot connect",
  pipeline_health:      "Voice pipeline is not answering",
  api_health:           "API server is not answering",
  stuck_calls:          "Calls stuck 'active'",
  dead_line:            "No inbound call answered during business hours",
  whatsapp_failing:     "WhatsApp sends are failing",
  plan_minutes_blocked: "A tenant is blocked at its plan minutes",
  sarvam_credits:       "Sarvam credits exhausted: Nikki has no voice",
  tts_fallback:         "Speaking through a fallback TTS vendor",
};

function alertTitle(id: string): string {
  if (ALERT_TITLES[id]) return ALERT_TITLES[id];
  if (id.startsWith("lease_foreign:")) return "Scheduler lease is held by another host";
  if (id.startsWith("vendor_")) return `${id.slice(7)} is failing on live calls`;
  return id;
}

/** Calls with a CRITICAL title stop the product; the rest degrade it. */
const CRITICAL = new Set(["trunk_gateway_down", "trunk_fault", "pipeline_health", "api_health", "sarvam_credits"]);

/**
 * What counts as a conversation. click_to_call_log has no "customer
 * answered" signal: a row is written once the SEAT answers, and
 * duration_seconds is the seat's leg. A call to a mistyped number on 22 Sep
 * logged 11 s while the customer leg failed outright, so duration > 0 read
 * as a 100% connect rate. 15 s is the usual call-centre threshold for "they
 * actually spoke", and the console labels it as a threshold, not a fact.
 */
const CONVERSATION_SECS = 15;

const IST_MS = 5.5 * 3600_000;
const istDay = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);

export function mountAdminOps(app: Express, { sb, verifySuperAdmin }: AdminOpsDeps): void {

  /* ── 1. Command center ─────────────────────────────────────── */
  app.get("/api/admin/ops/command-center", verifySuperAdmin, async (_req: Request, res: Response) => {
    try {
      const [{ data: row, error }, gateway, inUse] = await Promise.all([
        sb.from("platform_config").select("value, updated_at").eq("key", "watchdog_state").maybeSingle(),
        fsl.gatewayHealth("jio_primary"),
        fsl.channelsInUse(),
      ]);

      // An unreadable watchdog state is "unknown", not "all clear": the
      // console must not show green because a read failed.
      let alerts: any[] | null = null;
      if (!error) {
        let state: Record<string, any> = {};
        try { state = JSON.parse(row?.value || "{}"); } catch { state = {}; }
        alerts = Object.entries(state).map(([id, ep]: [string, any]) => ({
          id,
          title:    alertTitle(id),
          critical: CRITICAL.has(id),
          since:    ep?.since || null,
          runs:     Number(ep?.runs) || 0,
          emailed:  !!ep?.emailed_at,
          detail:   String(ep?.detail || ""),
        })).sort((a, b) => Number(b.critical) - Number(a.critical)
                          || String(a.since).localeCompare(String(b.since)));
      }

      const { channels, ceiling } = trunkLimits();
      const reserved = pendingClickToCallLegs();
      res.json({
        alerts,
        watchdog_read_at: row?.updated_at || null,
        trunk: {
          status:           gateway.status,          // up / down / not_configured / unknown
          ping_state:       gateway.pingState,
          failed_calls_out: gateway.failedCallsOut,
          channels,                                   // what Jio sold
          ceiling,                                    // where outbound stops
          inbound_reserved: channels - ceiling,       // always kept for callers
          in_use:           inUse,
          reserved,                                   // admitted, not yet visible
          outbound_free:    Math.max(0, ceiling - inUse - reserved),
          telecallers_fit:  Math.floor(Math.max(0, ceiling - inUse - reserved) / 2),
        },
        checked_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[admin-ops] command-center:", e?.message || e);
      res.status(500).json({ error: "Could not read platform state" });
    }
  });

  /* ── 2. Telecaller performance ─────────────────────────────── */
  app.get("/api/admin/ops/telecallers", verifySuperAdmin, async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(String(req.query.days || "7"), 10) || 7, 1), 90);
      const tenantId = String(req.query.tenant_id || "").replace(/[^0-9a-f-]/gi, "");
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      let q = sb.from("click_to_call_log")
        .select("agent_user_id, tenant_id, disposition, duration_seconds, created_at")
        .gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data: logs, error } = await q;
      if (error) return res.status(500).json({ error: error.message });

      const rows = logs || [];
      const agentIds  = [...new Set(rows.map((r: any) => r.agent_user_id).filter(Boolean))];
      const tenantIds = [...new Set(rows.map((r: any) => r.tenant_id).filter(Boolean))];
      const [{ data: people }, { data: tenants }] = await Promise.all([
        agentIds.length
          ? sb.from("tenant_users").select("user_id, tenant_id, display_name, phone, role").in("user_id", agentIds)
          : Promise.resolve({ data: [] as any[] }),
        tenantIds.length
          ? sb.from("tenants").select("id, name").in("id", tenantIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const personOf = new Map((people || []).map((p: any) => [`${p.user_id}:${p.tenant_id}`, p]));
      const tenantName = new Map((tenants || []).map((t: any) => [t.id, t.name]));

      type Agg = { calls: number; conversations: number; talk: number; logged: number; outcomes: Record<string, number>; last: string };
      const by = new Map<string, Agg & { agent_user_id: string; tenant_id: string }>();
      const daily = new Map<string, { calls: number; conversations: number }>();
      for (const r of rows as any[]) {
        const key = `${r.agent_user_id}:${r.tenant_id}`;
        const a = by.get(key) || { agent_user_id: r.agent_user_id, tenant_id: r.tenant_id,
                                   calls: 0, conversations: 0, talk: 0, logged: 0, outcomes: {}, last: r.created_at };
        const secs = Number(r.duration_seconds) || 0;
        const spoke = secs >= CONVERSATION_SECS;
        a.calls++;
        a.talk += secs;
        if (spoke) a.conversations++;
        // An outcome the seat logged is the only ground truth about the call;
        // how often they log one is itself worth managing.
        if (r.disposition) {
          a.logged++;
          a.outcomes[r.disposition] = (a.outcomes[r.disposition] || 0) + 1;
        }
        if (r.created_at > a.last) a.last = r.created_at;
        by.set(key, a);

        const d = istDay(r.created_at);
        const day = daily.get(d) || { calls: 0, conversations: 0 };
        day.calls++; if (spoke) day.conversations++;
        daily.set(d, day);
      }

      const seats = [...by.values()].map(a => {
        const p: any = personOf.get(`${a.agent_user_id}:${a.tenant_id}`);
        return {
          agent_user_id:   a.agent_user_id,
          name:            p?.display_name || null,
          phone_last4:     p?.phone ? String(p.phone).replace(/\D/g, "").slice(-4) : null,
          role:            p?.role || null,
          tenant_id:       a.tenant_id,
          tenant:          tenantName.get(a.tenant_id) || null,
          calls:             a.calls,
          conversations:     a.conversations,
          conversation_rate: a.calls ? a.conversations / a.calls : 0,
          talk_seconds:      a.talk,
          avg_call_seconds:  a.calls ? Math.round(a.talk / a.calls) : 0,
          outcomes_logged:   a.logged,
          outcomes:          a.outcomes,
          last_call_at:    a.last,
        };
      }).sort((x, y) => y.calls - x.calls);

      // Every day in the window, including empty ones, so the chart does not
      // draw a quiet Sunday as if it never happened.
      const series = Array.from({ length: days }, (_, i) => {
        const d = istDay(new Date(Date.now() - (days - 1 - i) * 86400_000).toISOString());
        return { day: d, ...(daily.get(d) || { calls: 0, conversations: 0 }) };
      });

      const total = seats.reduce((s, x) => ({
        calls: s.calls + x.calls, conversations: s.conversations + x.conversations,
        talk_seconds: s.talk_seconds + x.talk_seconds, outcomes_logged: s.outcomes_logged + x.outcomes_logged,
      }), { calls: 0, conversations: 0, talk_seconds: 0, outcomes_logged: 0 });

      res.json({ days, seats, series, total, conversation_secs: CONVERSATION_SECS,
                 truncated: rows.length >= 5000 });
    } catch (e: any) {
      console.error("[admin-ops] telecallers:", e?.message || e);
      res.status(500).json({ error: "Could not read telecaller activity" });
    }
  });

  /* ── 3. Usage against plan limits ──────────────────────────── */
  app.get("/api/admin/ops/usage", verifySuperAdmin, async (_req: Request, res: Response) => {
    try {
      const [{ data: tenants, error }, { data: plans }] = await Promise.all([
        sb.from("tenants").select("id, name, plan, status, credit_minutes").order("created_at", { ascending: true }),
        sb.from("plans").select("id, display_name, max_seats"),
      ]);
      if (error) return res.status(500).json({ error: error.message });
      const planOf = new Map((plans || []).map((p: any) => [p.id, p]));

      // Sequential per tenant, small batches: three reads each, and the gate
      // is the source of truth, so it is called rather than re-derived.
      const out: any[] = [];
      const list = tenants || [];
      for (let i = 0; i < list.length; i += 8) {
        out.push(...await Promise.all(list.slice(i, i + 8).map(async (t: any) => {
          const [gate, members, invites] = await Promise.all([
            minutesGate(sb, t.id),
            sb.from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", t.id),
            sb.from("tenant_invites").select("id", { count: "exact", head: true })
              .eq("tenant_id", t.id).is("accepted_at", null),
          ]);
          const plan = planOf.get(String(t.plan || "trial")) || null;
          const seatLimit = Number(plan?.max_seats) || 1;
          const seatsUsed = (members.count || 0) + (invites.count || 0);
          const minutesPct = gate.limitMinutes > 0 ? gate.usedMinutes / gate.limitMinutes : null;
          const seatsPct = seatsUsed / seatLimit;
          const worst = Math.max(seatsPct, minutesPct ?? 0);
          return {
            tenant_id:      t.id,
            name:           t.name,
            plan:           t.plan,
            plan_name:      plan?.display_name || t.plan,
            status:         t.status,
            seats_used:     seatsUsed,
            seats_pending:  invites.count || 0,
            seat_limit:     seatLimit,
            minutes_used:   gate.usedMinutes,
            minute_limit:   gate.limitMinutes,      // 0 = not on a paid plan
            credits:        gate.credits,
            can_call:       gate.ok,
            blocked_reason: gate.ok ? null : gate.reason,
            level:          !gate.ok || worst >= 1 ? "over" : worst >= 0.8 ? "near" : "ok",
          };
        })));
      }
      const rank = { over: 0, near: 1, ok: 2 } as Record<string, number>;
      out.sort((a, b) => rank[a.level] - rank[b.level] || a.name.localeCompare(b.name));
      res.json({ tenants: out });
    } catch (e: any) {
      console.error("[admin-ops] usage:", e?.message || e);
      res.status(500).json({ error: "Could not read usage" });
    }
  });
}
