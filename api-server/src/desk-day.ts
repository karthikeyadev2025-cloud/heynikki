/**
 * The day, laid out — for the business and for each telecaller.
 *
 *   GET /api/desk/day-board   every customer who needs something TODAY
 *   GET /api/desk/me          one telecaller's own numbers, trend and next steps
 *
 * WHY
 * The Desk answers "who do I ring next" one lead at a time. Nobody could see
 * the whole day: which callbacks were promised and are now late, who is
 * coming in, which missed calls nobody has returned, who rang in new this
 * morning. An owner found out about a forgotten callback from the customer.
 * And a telecaller could see today's count but not whether this week is
 * better than last, what their reviews said, or which hour their calls
 * actually connect.
 *
 * The board is five lists of the same card, in the order the work should be
 * done: late promises first. The owner sees the business; a telecaller sees
 * what is theirs plus what nobody owns yet.
 *
 * Every figure is derived from rows that already exist (leads, calls,
 * click_to_call_log, appointments, seat_targets). The shaping is in pure
 * functions below, so the arithmetic is tested without a database.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONVERSATION_SECS, IST_MS, istDate, istDayStartMs } from "./attendance";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Deps = {
  sb: SupabaseClient;
  verifyJWT: Mw;
  getTenantId: (userId: string) => Promise<string | null>;
};

const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

/* ── pure shaping (tested) ──────────────────────────────────── */

/** The last `n` IST dates, oldest first, ending today. */
export function dayKeys(n: number, now = Date.now()): string[] {
  const start = istDayStartMs(now);
  return Array.from({ length: n }, (_, i) => istDate(start - (n - 1 - i) * 86400_000));
}

export type LogRow = { created_at: string; duration_seconds?: number | null; disposition?: string | null };
export type DayStat = { date: string; calls: number; connected: number; talk_seconds: number; booked: number; interested: number };

/** One row per day, including days with no calls — a gap is information. */
export function seriesByDay(rows: LogRow[], days: string[]): DayStat[] {
  const by = new Map<string, DayStat>(days.map(d => [d, { date: d, calls: 0, connected: 0, talk_seconds: 0, booked: 0, interested: 0 }]));
  for (const r of rows) {
    const s = by.get(istDate(Date.parse(r.created_at)));
    if (!s) continue;
    s.calls += 1;
    const secs = r.duration_seconds || 0;
    if (secs >= CONVERSATION_SECS) { s.connected += 1; s.talk_seconds += secs; }
    if (r.disposition === "booked") s.booked += 1;
    if (r.disposition === "interested") s.interested += 1;
  }
  return days.map(d => by.get(d)!);
}

/**
 * Days in a row, ending today or yesterday, on which the calls target was
 * met. Today not being finished must not break a streak, so an unmet today
 * is skipped rather than counted as a miss.
 */
export function streak(series: DayStat[], dailyCalls: number): number {
  if (dailyCalls <= 0) return 0;
  let n = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].calls >= dailyCalls) n += 1;
    else if (i === series.length - 1) continue;
    else break;
  }
  return n;
}

/**
 * The hour of the day (IST, 0-23) this person's calls most often turn into
 * a conversation. Needs a few calls in an hour before it will say anything:
 * one lucky call at 7 am is not a pattern.
 */
export function bestHour(rows: LogRow[], minCalls = 5): { hour: number; rate: number; calls: number } | null {
  const h = new Map<number, { calls: number; connected: number }>();
  for (const r of rows) {
    const hour = new Date(Date.parse(r.created_at) + IST_MS).getUTCHours();
    const s = h.get(hour) || { calls: 0, connected: 0 };
    s.calls += 1;
    if ((r.duration_seconds || 0) >= CONVERSATION_SECS) s.connected += 1;
    h.set(hour, s);
  }
  let best: { hour: number; rate: number; calls: number } | null = null;
  for (const [hour, s] of h) {
    if (s.calls < minCalls) continue;
    const rate = s.connected / s.calls;
    if (!best || rate > best.rate || (rate === best.rate && s.calls > best.calls)) best = { hour, rate, calls: s.calls };
  }
  return best;
}

export type Missed = { id: string; caller_number: string; created_at: string };
/**
 * Missed calls nobody has dealt with: no Desk call to that number, and no
 * answered call from it, AFTER the miss. One card per number — someone who
 * rang four times is one person to ring back, with the count.
 */
export function unreturnedMissed(
  missed: Missed[],
  deskCalls: { callee_number: string; created_at: string }[],
  answered: { caller_number: string; created_at: string }[],
): { id: string; phone: string; at: string; times: number }[] {
  const latestAfter = new Map<string, number>();
  const note = (num: unknown, at: string) => {
    const p = last10(num); const t = Date.parse(at);
    if (p.length === 10 && t > (latestAfter.get(p) || 0)) latestAfter.set(p, t);
  };
  deskCalls.forEach(c => note(c.callee_number, c.created_at));
  answered.forEach(c => note(c.caller_number, c.created_at));

  const by = new Map<string, { id: string; phone: string; at: string; times: number }>();
  for (const m of [...missed].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const p = last10(m.caller_number);
    if (p.length !== 10) continue;
    if ((latestAfter.get(p) || 0) > Date.parse(m.created_at)) { by.delete(p); continue; }
    const cur = by.get(p);
    by.set(p, { id: m.id, phone: p, at: m.created_at, times: (cur?.times || 0) + 1 });
  }
  return [...by.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Change against the week before, as whole percent; null when there is no base. */
export function pctChange(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/* ── routes ─────────────────────────────────────────────────── */

export function mountDeskDayRoutes(app: Express, deps: Deps) {
  const { sb, verifyJWT, getTenantId } = deps;

  async function me(req: any, res: Response) {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return null; }
    const { data: m } = await sb.from("tenant_users").select("id, role, display_name")
      .eq("tenant_id", tenantId).eq("user_id", req.user.id).maybeSingle();
    if (!m) { res.status(403).json({ error: "No seat" }); return null; }
    return { tenantId, userId: req.user.id as string, owner: ["owner", "super_admin"].includes(m.role), name: m.display_name || "" };
  }

  // ── The day board ──────────────────────────────────────────────────
  app.get("/api/desk/day-board", verifyJWT, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const { tenantId, userId } = who;
    // The owner may look at the whole business or, like a telecaller, at
    // what is theirs; a telecaller only ever sees theirs and the unowned.
    const team = who.owner && req.query.scope !== "mine";
    const now = Date.now();
    const startMs = istDayStartMs(now), endMs = startMs + 86400_000;
    const startIso = new Date(startMs).toISOString(), endIso = new Date(endMs).toISOString();
    const today = istDate(now);
    const mineOrPool = `assigned_to.eq.${userId},assigned_to.is.null`;

    let cbQ = sb.from("leads").select("id, name, phone, stage, interest, follow_up_at, follow_up_note, assigned_to")
      .eq("tenant_id", tenantId).not("follow_up_at", "is", null).is("follow_up_done_at", null)
      .lt("follow_up_at", endIso).not("stage", "in", '("won","lost")')
      .order("follow_up_at", { ascending: true }).limit(100);
    let newQ = sb.from("leads").select("id, name, phone, interest, source, score, created_at, assigned_to")
      .eq("tenant_id", tenantId).eq("stage", "new").is("last_contacted_at", null)
      .gte("created_at", startIso).order("score", { ascending: false, nullsFirst: false }).limit(60);
    let doneQ = sb.from("click_to_call_log").select("id, callee_number, lead_id, disposition, agent_user_id, created_at, notes")
      .eq("tenant_id", tenantId).gte("created_at", startIso).in("disposition", ["booked", "interested"])
      .order("created_at", { ascending: false }).limit(60);
    if (!team) {
      cbQ = cbQ.or(mineOrPool); newQ = newQ.or(mineOrPool); doneQ = doneQ.eq("agent_user_id", userId);
    }

    const [cb, nl, done, appts, missed, deskToday, answered, members] = await Promise.all([
      cbQ, newQ, doneQ,
      sb.from("appointments").select("id, caller_name, caller_number, service, slot_time, status, booking_ref, notes")
        .eq("tenant_id", tenantId).eq("slot_date", today).in("status", ["confirmed", "completed", "no_show"])
        .order("slot_time", { ascending: true, nullsFirst: false }).limit(100),
      sb.from("calls").select("id, caller_number, created_at").eq("tenant_id", tenantId)
        .eq("direction", "inbound").eq("status", "missed").gte("created_at", startIso).limit(200),
      sb.from("click_to_call_log").select("callee_number, created_at")
        .eq("tenant_id", tenantId).gte("created_at", startIso).limit(1000),
      sb.from("calls").select("caller_number, created_at").eq("tenant_id", tenantId)
        .eq("direction", "inbound").in("status", ["completed", "transferred"]).gte("created_at", startIso).limit(1000),
      sb.from("tenant_users").select("user_id, display_name").eq("tenant_id", tenantId),
    ]);
    const failed = [cb, nl, done, appts, missed].find((r: any) => r.error);
    if (failed) {
      console.error("[day-board]", (failed as any).error.message);
      return res.status(500).json({ error: "Could not load today's board." });
    }

    const nameOf = new Map<string, string>(((members as any).data || []).map((m: any) => [m.user_id, m.display_name || ""]));
    const who_ = (uid: string | null) => !uid ? null : uid === userId ? "You" : (nameOf.get(uid) || "A teammate");

    const pending = unreturnedMissed((missed as any).data || [], (deskToday as any).data || [], (answered as any).data || []);
    // Names for numbers that are only numbers so far (missed calls, done).
    const phones = [...new Set([...pending.map(p => p.phone), ...((done as any).data || []).map((d: any) => last10(d.callee_number))])].filter(p => p.length === 10);
    const { data: known } = phones.length
      ? await sb.from("leads").select("id, name, phone").eq("tenant_id", tenantId).in("phone", phones)
      : { data: [] as any[] };
    const lead = new Map<string, { id: string; name: string | null }>((known || []).map((l: any) => [last10(l.phone), { id: l.id, name: l.name }]));

    const callbacks = ((cb as any).data || []).map((l: any) => ({
      id: l.id, lead_id: l.id, phone: last10(l.phone), name: l.name || null,
      at: l.follow_up_at, overdue: Date.parse(l.follow_up_at) < now,
      note: l.follow_up_note || l.interest || null, by: who_(l.assigned_to),
    }));
    const columns = {
      callbacks,
      appointments: ((appts as any).data || []).map((a: any) => ({
        id: a.id, phone: last10(a.caller_number), name: a.caller_name || null, time: a.slot_time || null,
        note: [a.service, a.notes].filter(Boolean).join(" · ") || null, status: a.status, ref: a.booking_ref || null,
      })),
      missed: pending.map(p => ({
        id: p.id, phone: p.phone, name: lead.get(p.phone)?.name || null, lead_id: lead.get(p.phone)?.id || null,
        at: p.at, times: p.times,
      })),
      new_leads: ((nl as any).data || []).map((l: any) => ({
        id: l.id, lead_id: l.id, phone: last10(l.phone), name: l.name || null, at: l.created_at,
        note: l.interest || (l.source ? `From ${String(l.source).replace(/_/g, " ")}` : null), by: who_(l.assigned_to),
      })),
      done: ((done as any).data || []).map((d: any) => {
        const p = last10(d.callee_number);
        return { id: d.id, phone: p, name: lead.get(p)?.name || null, lead_id: d.lead_id || lead.get(p)?.id || null,
                 at: d.created_at, outcome: d.disposition, note: d.notes || null, by: who_(d.agent_user_id) };
      }),
    };
    res.json({
      date: today, scope: team ? "team" : "mine", can_see_team: who.owner, now: new Date(now).toISOString(),
      columns,
      counts: {
        overdue: callbacks.filter((c: any) => c.overdue).length,
        callbacks: callbacks.length, appointments: columns.appointments.length,
        missed: columns.missed.length, new_leads: columns.new_leads.length, done: columns.done.length,
      },
    });
  });

  // ── One telecaller's own dashboard ─────────────────────────────────
  app.get("/api/desk/me", verifyJWT, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const { tenantId, userId } = who;
    const now = Date.now();
    const days = dayKeys(14, now);
    const sinceIso = new Date(istDayStartMs(now) - 13 * 86400_000).toISOString();
    const endOfToday = new Date(istDayStartMs(now) + 86400_000).toISOString();

    const [logs, tgt, due, open, reviews, teamWeek] = await Promise.all([
      sb.from("click_to_call_log").select("created_at, duration_seconds, disposition")
        .eq("tenant_id", tenantId).eq("agent_user_id", userId).gte("created_at", sinceIso)
        .order("created_at", { ascending: true }).limit(5000),
      sb.from("seat_targets").select("daily_calls, daily_conversations")
        .eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
      sb.from("leads").select("follow_up_at").eq("tenant_id", tenantId).eq("assigned_to", userId)
        .not("follow_up_at", "is", null).is("follow_up_done_at", null).lt("follow_up_at", endOfToday)
        .not("stage", "in", '("won","lost")').limit(500),
      sb.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
        .eq("assigned_to", userId).in("stage", ["new", "contacted", "qualified"]),
      sb.from("click_to_call_log").select("qa_score, qa_note, qa_at, callee_number")
        .eq("tenant_id", tenantId).eq("agent_user_id", userId).not("qa_score", "is", null)
        .order("qa_at", { ascending: false }).limit(20),
      // Where this person stands this week. Only a position leaves the
      // server for a telecaller — never a colleague's numbers.
      sb.from("click_to_call_log").select("agent_user_id, duration_seconds, disposition")
        .eq("tenant_id", tenantId).gte("created_at", new Date(istDayStartMs(now) - 6 * 86400_000).toISOString()).limit(5000),
    ]);
    if ((logs as any).error) return res.status(500).json({ error: "Could not load your dashboard." });

    const rows: LogRow[] = (logs as any).data || [];
    const series = seriesByDay(rows, days);
    const sum = (xs: DayStat[]) => xs.reduce((a, d) => ({
      calls: a.calls + d.calls, connected: a.connected + d.connected, talk_seconds: a.talk_seconds + d.talk_seconds,
      booked: a.booked + d.booked, interested: a.interested + d.interested,
    }), { calls: 0, connected: 0, talk_seconds: 0, booked: 0, interested: 0 });
    const thisWeek = sum(series.slice(7)), lastWeek = sum(series.slice(0, 7));
    const today = series[series.length - 1];

    const outcomes: Record<string, number> = { booked: 0, interested: 0, callback: 0, not_interested: 0, no_answer: 0, unsaved: 0 };
    for (const r of rows.filter(r => Date.parse(r.created_at) >= istDayStartMs(now) - 6 * 86400_000)) {
      const k = r.disposition && r.disposition in outcomes ? r.disposition : "unsaved";
      outcomes[k] += 1;
    }

    const targets = (tgt as any).error ? { daily_calls: 0, daily_conversations: 0 }
      : { daily_calls: (tgt as any).data?.daily_calls || 0, daily_conversations: (tgt as any).data?.daily_conversations || 0 };

    const dueRows: any[] = (due as any).data || [];
    const scored: any[] = (reviews as any).error ? [] : (reviews as any).data || [];

    // Rank by bookings, then conversations, then calls — the order the team
    // table on the Desk uses.
    const tally = new Map<string, { b: number; c: number; n: number }>();
    for (const r of ((teamWeek as any).data || []) as any[]) {
      const t = tally.get(r.agent_user_id) || { b: 0, c: 0, n: 0 };
      t.n += 1;
      if ((r.duration_seconds || 0) >= CONVERSATION_SECS) t.c += 1;
      if (r.disposition === "booked") t.b += 1;
      tally.set(r.agent_user_id, t);
    }
    const order = [...tally.entries()].sort((a, b) => (b[1].b - a[1].b) || (b[1].c - a[1].c) || (b[1].n - a[1].n)).map(e => e[0]);
    const pos = order.indexOf(userId);

    res.json({
      name: who.name, conversation_secs: CONVERSATION_SECS,
      today, targets, series,
      this_week: thisWeek, last_week: lastWeek,
      change: {
        calls: pctChange(thisWeek.calls, lastWeek.calls),
        connected: pctChange(thisWeek.connected, lastWeek.connected),
        booked: pctChange(thisWeek.booked, lastWeek.booked),
      },
      connect_rate: thisWeek.calls ? Math.round((thisWeek.connected / thisWeek.calls) * 100) : null,
      outcomes,
      streak_days: streak(series, targets.daily_calls),
      best_hour: bestHour(rows),
      followups: {
        overdue: dueRows.filter(l => Date.parse(l.follow_up_at) < now).length,
        later_today: dueRows.filter(l => Date.parse(l.follow_up_at) >= now).length,
      },
      open_leads: (open as any).count || 0,
      quality: {
        average: scored.length ? Math.round((scored.reduce((a, r) => a + r.qa_score, 0) / scored.length) * 10) / 10 : null,
        reviews: scored.length,
        recent: scored.filter(r => r.qa_note).slice(0, 3).map(r => ({ score: r.qa_score, note: r.qa_note, at: r.qa_at })),
      },
      rank: pos >= 0 && order.length > 1 ? { position: pos + 1, of: order.length } : null,
    });
  });
}
