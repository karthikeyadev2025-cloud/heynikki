/**
 * What the owner's assistant can DO, as opposed to answer.
 *
 * The dashboard assistant has been a read-only oracle: it was handed a blob
 * of today's numbers and asked to talk about them. Every actual action —
 * ring that lead back, mark the order ready, cancel the 4 o'clock — meant
 * closing the panel and going to find the right page.
 *
 * Here it gets tools. Two kinds, and the difference matters:
 *
 *   READ tools run immediately. Looking something up is free and reversible.
 *
 *   WRITE tools do NOT run. They return a proposal, the panel renders it as
 *   a confirm button, and nothing happens until a person presses it. These
 *   actions ring a real customer's phone, send them a WhatsApp, or cancel
 *   their booking — and the instruction arrives through a speech recogniser
 *   working on Telugu in a noisy office. "Cancel Ravi's appointment" and
 *   "Ravi's appointment?" are one bad transcription apart.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { tenantRole, OWNER_ROLES } from "./roles";
import { minutesGate, planDeskMinutes } from "./usage";
import { CONVERSATION_SECS } from "./attendance";

export type Card =
  | { type: "summary"; title: string; stats: { label: string; value: string | number; tone?: string }[] }
  | { type: "list"; title: string; rows: { title: string; subtitle?: string; meta?: string; tone?: string; href?: string }[] };

export type OwnerTurn = {
  answer: string;
  cards?: Card[];
  confirm?: { id: string; label: string; description: string; danger?: boolean };
};

type Pending = {
  tenantId: string;
  tool: string;
  args: any;
  label: string;
  description: string;
  danger: boolean;
  at: number;
};

const PENDING_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, Pending>();

function reap() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, p] of pending) if (p.at < cutoff) pending.delete(id);
}

const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000);
const todayIST = () => ist(new Date()).toISOString().slice(0, 10);
// An IST calendar day as a half-open UTC range. created_at is timestamptz;
// comparing it to "2026-09-16T00:00:00" with no offset meant midnight UTC,
// so "today" ran 05:30 IST to 05:29 the next morning — the evening's calls
// were counted, the small hours' were filed under the wrong day.
const istDayRange = (day: string) => {
  const start = `${day}T00:00:00+05:30`;
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start, end: `${next}T00:00:00+05:30` };
};
const last10 = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);

export function makeOwnerAssistant(deps: {
  sb: SupabaseClient;
  geminiKey: string;
  resolveGeminiModel: () => string;
  sendWhatsApp: (to: string, message: string, tenantId: string, voiceProfileId: string | null | undefined,
                 messageType: string, callId?: string, apptId?: string, businessName?: string | null,
                 templateParams?: string[], preferredParams?: string[]) => Promise<boolean>;
}) {
  const { sb } = deps;

  // ── The tools ────────────────────────────────────────────────
  const DECLARATIONS = [
    {
      name: "list_orders",
      description: "Orders taken on the phone. Use for 'what orders are waiting', 'is ORD-7K3Q ready'. Default is everything not yet delivered or cancelled.",
      parameters: { type: "object", properties: {
        status: { type: "string", enum: ["new", "confirmed", "preparing", "ready", "delivered", "cancelled"] },
        reference: { type: "string", description: "A specific order number like ORD-7K3Q." },
      } },
    },
    {
      name: "list_appointments",
      description: "Bookings in the diary. 'day' is YYYY-MM-DD; omit for today. Use for 'who is coming tomorrow', 'how many bookings today'.",
      parameters: { type: "object", properties: { day: { type: "string" } } },
    },
    {
      name: "list_leads",
      description: "People worth ringing back — callers Nikki scored as interested who have not been contacted. Use for 'who should I call back'.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "find_customer",
      description: "Everything this business knows about one person: their calls, bookings and orders. Takes a phone number or a name.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "day_calls",
      description: "How the phone went: total calls, answered, missed, bookings made, minutes. 'day' is YYYY-MM-DD; omit for today. Use for 'how many calls today', 'how was yesterday'.",
      parameters: { type: "object", properties: { day: { type: "string" } } },
    },
    {
      name: "missed_calls",
      description: "Calls nobody got to — rung out, or ended before a conversation. Use for 'did I miss anything', 'any missed calls today'.",
      parameters: { type: "object", properties: { day: { type: "string" } } },
    },
    {
      name: "whatsapp_inbox",
      description: "WhatsApp messages customers have sent the business. Use for 'any WhatsApp messages', 'did anyone reply on WhatsApp', 'what did Ravi send'. Default is the unread ones.",
      parameters: { type: "object", properties: {
        include_read: { type: "boolean", description: "True to list recent messages whether or not they were read." },
        phone: { type: "string", description: "Only messages from this mobile number." },
      } },
    },
    {
      name: "minutes_left",
      description: "The plan this business is on and how many calling minutes are used and left this month — Nikki's minutes and the team's telecaller minutes. Use for 'how many minutes are left', 'which plan am I on'.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "team_calls",
      description: "What the telecallers did on the Desk: calls dialled, real conversations, bookings, interested customers and callbacks, per person. 'days' is 1 (today), 7 or 30. Use for 'how is the team doing', 'how many calls did Sita make today'.",
      parameters: { type: "object", properties: { days: { type: "integer", enum: [1, 7, 30] } } },
    },
    {
      name: "follow_ups_due",
      description: "Customers who are owed a call back — follow-ups booked from calls that are due today or overdue. Use for 'who do we have to call back', 'any follow-ups pending'.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "list_campaigns",
      description: "Outbound calling campaigns and how far each has got: status, numbers called, numbers left. Use for 'how is the campaign going', 'is anything running'.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "calls_learned",
      description: "The latest daily digest of what the team's calls taught: how the day went, what customers objected to and asked, what worked, tips for tomorrow. Use for 'what did customers say', 'why are people saying no', 'any tips for the team'.",
      parameters: { type: "object", properties: {} },
    },
    // ── Write. These only ever PROPOSE. ──
    {
      name: "call_customer_back",
      description: "Ask Nikki to ring a customer back and say something. PROPOSES the call; the owner confirms before any phone rings.",
      parameters: { type: "object", properties: {
        phone: { type: "string", description: "Their mobile number." },
        message: { type: "string", description: "What Nikki should tell them, in their language, one or two sentences." },
        name: { type: "string" },
      }, required: ["phone", "message"] },
    },
    {
      name: "set_order_status",
      description: "Move an order along. PROPOSES the change; the owner confirms.",
      parameters: { type: "object", properties: {
        reference: { type: "string", description: "The order number, e.g. ORD-7K3Q." },
        status: { type: "string", enum: ["confirmed", "preparing", "ready", "delivered", "cancelled"] },
      }, required: ["reference", "status"] },
    },
    {
      name: "cancel_appointment",
      description: "Cancel a booking. PROPOSES it; the owner confirms. Never call this for a booking you have not confirmed exists.",
      parameters: { type: "object", properties: {
        booking_ref: { type: "string", description: "The booking number, or the customer's phone number." },
      }, required: ["booking_ref"] },
    },
  ];

  const WRITE_TOOLS = new Set(["call_customer_back", "set_order_status", "cancel_appointment"]);

  // ── Read implementations ─────────────────────────────────────
  async function listOrders(tenantId: string, args: any) {
    let q = sb.from("orders")
      .select("id, reference, customer_name, customer_phone, items, total, status, fulfilment, created_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20);
    if (args.reference) q = q.eq("reference", String(args.reference).toUpperCase());
    else if (args.status) q = q.eq("status", args.status);
    else q = q.not("status", "in", "(delivered,cancelled)");
    const { data } = await q;
    const rows = (data || []).map(o => ({
      title: `${o.reference} · ${(Array.isArray(o.items) ? o.items : []).map((i: any) => i.name).join(", ").slice(0, 60) || "—"}`,
      subtitle: `${o.customer_name || o.customer_phone || "—"} · ${o.fulfilment}`,
      meta: (o.total != null ? `₹${Number(o.total).toLocaleString("en-IN")} · ` : "") + o.status,
      tone: o.status === "ready" ? "good" : o.status === "new" ? "warn" : undefined,
      href: "/orders",
    }));
    return {
      result: { count: rows.length, orders: (data || []).map(o => ({
        reference: o.reference, status: o.status, total: o.total,
        customer: o.customer_name || o.customer_phone,
        items: (Array.isArray(o.items) ? o.items : []).map((i: any) => `${i.name} x${i.qty || 1}`),
      })) },
      card: rows.length ? { type: "list" as const, title: args.status ? `Orders — ${args.status}` : "Orders waiting", rows } : null,
    };
  }

  async function listAppointments(tenantId: string, args: any) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(args.day || "")) ? args.day : todayIST();
    const { data } = await sb.from("appointments")
      .select("id, booking_ref, caller_name, caller_number, service, slot_time, status")
      .eq("tenant_id", tenantId).eq("slot_date", day)
      .order("slot_time", { ascending: true }).limit(30);
    const rows = (data || []).map(a => ({
      title: `${a.slot_time || "—"} · ${a.caller_name || a.caller_number || "—"}`,
      subtitle: a.service || undefined,
      meta: `${a.booking_ref ? a.booking_ref + " · " : ""}${a.status}`,
      tone: a.status === "cancelled" ? "bad" : a.status === "confirmed" ? "good" : "warn",
      href: "/appointments",
    }));
    return {
      result: { day, count: rows.length, appointments: (data || []).map(a => ({
        booking_ref: a.booking_ref, time: a.slot_time, who: a.caller_name || a.caller_number,
        service: a.service, status: a.status })) },
      card: rows.length ? { type: "list" as const, title: `Bookings — ${day}`, rows } : null,
    };
  }

  async function listLeads(tenantId: string) {
    const { data } = await sb.from("leads")
      .select("id, name, phone, score, stage, intent, notes, updated_at")
      .eq("tenant_id", tenantId).gte("score", 50)
      .not("stage", "in", "(won,lost)")
      .order("score", { ascending: false }).limit(10);
    const rows = (data || []).map(l => ({
      title: l.name || l.phone,
      subtitle: (l.intent || "").replace(/_/g, " ") || undefined,
      meta: `score ${l.score}`,
      tone: (l.score >= 70 ? "good" : "warn") as string,
      href: "/leads",
    }));
    return {
      result: { count: rows.length, leads: (data || []).map(l => ({
        name: l.name, phone: l.phone, score: l.score, intent: l.intent })) },
      card: rows.length ? { type: "list" as const, title: "Worth ringing back", rows } : null,
    };
  }

  async function findCustomer(tenantId: string, args: any) {
    const raw = String(args.query || "").trim();
    const digits = last10(raw);
    const byPhone = digits.length === 10;
    const [calls, appts, orders] = await Promise.all([
      byPhone
        ? sb.from("calls").select("id, created_at, intent, status, duration_seconds")
            .eq("tenant_id", tenantId).like("caller_number", `%${digits}`)
            .order("created_at", { ascending: false }).limit(5)
        : Promise.resolve({ data: [] as any[] }),
      byPhone
        ? sb.from("appointments").select("booking_ref, slot_date, slot_time, service, status, caller_name")
            .eq("tenant_id", tenantId).like("caller_number", `%${digits}`)
            .order("slot_date", { ascending: false }).limit(5)
        : sb.from("appointments").select("booking_ref, slot_date, slot_time, service, status, caller_name, caller_number")
            .eq("tenant_id", tenantId).ilike("caller_name", `%${raw}%`)
            .order("slot_date", { ascending: false }).limit(5),
      byPhone
        ? sb.from("orders").select("reference, created_at, total, status, items")
            .eq("tenant_id", tenantId).like("customer_phone", `%${digits}`)
            .order("created_at", { ascending: false }).limit(5)
        : sb.from("orders").select("reference, created_at, total, status, items, customer_phone")
            .eq("tenant_id", tenantId).ilike("customer_name", `%${raw}%`)
            .order("created_at", { ascending: false }).limit(5),
    ]);
    const name = (appts.data || [])[0]?.caller_name;
    const phone = byPhone ? digits : last10((appts.data as any[] || [])[0]?.caller_number || (orders.data as any[] || [])[0]?.customer_phone);
    const rows = [
      ...(calls.data || []).map((c: any) => ({
        title: `Call · ${(c.intent || "enquiry").replace(/_/g, " ")}`,
        subtitle: new Date(c.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        meta: `${c.duration_seconds || 0}s · ${c.status}`, href: "/calls",
      })),
      ...(appts.data || []).map((a: any) => ({
        title: `Booking · ${a.service || "appointment"}`,
        subtitle: `${a.slot_date || "—"} ${a.slot_time || ""}`.trim(),
        meta: `${a.booking_ref ? a.booking_ref + " · " : ""}${a.status}`, href: "/appointments",
      })),
      ...(orders.data || []).map((o: any) => ({
        title: `Order · ${o.reference}`,
        subtitle: (Array.isArray(o.items) ? o.items : []).map((i: any) => i.name).join(", ").slice(0, 60),
        meta: `${o.total != null ? "₹" + Number(o.total).toLocaleString("en-IN") + " · " : ""}${o.status}`,
        href: "/orders",
      })),
    ];
    return {
      result: {
        found: rows.length > 0, name: name || null, phone: phone || null,
        calls: (calls.data || []).length, appointments: (appts.data || []).length,
        orders: (orders.data || []).length,
        detail: rows.slice(0, 8).map(r => `${r.title} — ${r.subtitle || ""} (${r.meta || ""})`),
      },
      card: rows.length
        ? { type: "list" as const, title: name ? `${name}${phone ? " · " + phone : ""}` : (phone || raw), rows: rows.slice(0, 10) }
        : null,
    };
  }

  async function dayCalls(tenantId: string, args: any) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(args.day || "")) ? args.day : todayIST();
    const r = istDayRange(day);
    const [{ data: calls }, { data: appts }, { data: orders }] = await Promise.all([
      sb.from("calls").select("status, duration_seconds, appointment_created, intent")
        .eq("tenant_id", tenantId)
        .gte("created_at", r.start).lt("created_at", r.end),
      sb.from("appointments").select("id").eq("tenant_id", tenantId).eq("slot_date", day),
      sb.from("orders").select("total").eq("tenant_id", tenantId)
        .gte("created_at", r.start).lt("created_at", r.end)
        .not("status", "eq", "cancelled"),
    ]);
    const rows = calls || [];
    const missed = rows.filter(c => c.status === "missed").length;
    const answered = rows.length - missed;
    const seconds = rows.reduce((s, c) => s + (c.duration_seconds || 0), 0);
    const booked = rows.filter(c => c.appointment_created).length;
    const revenue = (orders || []).reduce((s, o: any) => s + (Number(o.total) || 0), 0);
    const result = {
      day, total_calls: rows.length, answered, missed,
      minutes: Math.ceil(seconds / 60), bookings_made: booked,
      appointments_in_diary: (appts || []).length,
      orders: (orders || []).length, order_value_rupees: revenue,
    };
    return {
      result,
      card: {
        type: "summary" as const,
        title: day === todayIST() ? "Today" : day,
        stats: [
          { label: "Calls", value: rows.length },
          { label: "Answered", value: answered, tone: "good" },
          { label: "Missed", value: missed, tone: missed ? "bad" : undefined },
          { label: "Minutes", value: Math.ceil(seconds / 60) },
          { label: "Bookings", value: (appts || []).length },
          ...(orders && orders.length
            ? [{ label: "Orders", value: `${orders.length} · ₹${revenue.toLocaleString("en-IN")}` }]
            : []),
        ],
      },
    };
  }

  async function missedCalls(tenantId: string, args: any) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(args.day || "")) ? args.day : todayIST();
    const r = istDayRange(day);
    const { data } = await sb.from("calls")
      .select("id, caller_number, created_at, status, duration_seconds")
      .eq("tenant_id", tenantId).eq("status", "missed")
      .gte("created_at", r.start).lt("created_at", r.end)
      .order("created_at", { ascending: false }).limit(20);
    const rows = (data || []).map(c => ({
      title: c.caller_number || "unknown",
      subtitle: new Date(c.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
      meta: "missed", tone: "bad" as string, href: "/calls",
    }));
    return {
      result: { day, count: rows.length, numbers: (data || []).map(c => c.caller_number) },
      card: rows.length ? { type: "list" as const, title: `Missed calls — ${day}`, rows } : null,
    };
  }

  async function whatsappInbox(tenantId: string, args: any) {
    const digits = last10(args.phone);
    let q = sb.from("wa_inbound")
      .select("id, from_number, body, msg_type, received_at, read_at")
      .eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(20);
    if (args.include_read !== true) q = q.is("read_at", null);
    if (digits.length === 10) q = q.like("from_number", `%${digits}`);
    const [{ data, error }, { count: unread }] = await Promise.all([
      q,
      sb.from("wa_inbound").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).is("read_at", null),
    ]);
    if (error) throw new Error(error.message);
    // A photo or voice note with no caption has no words to show or say.
    const text = (m: any) => String(m.body || "").trim() || `[${m.msg_type || "message"}]`;
    const when = (t: string) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    const rows = (data || []).map(m => ({
      title: last10(m.from_number) || "unknown",
      subtitle: text(m).slice(0, 80),
      meta: when(m.received_at),
      tone: m.read_at ? undefined : "warn",
      href: "/whatsapp",
    }));
    return {
      result: { unread_total: unread || 0, shown: rows.length, messages: (data || []).map(m => ({
        from: last10(m.from_number), text: text(m).slice(0, 200), unread: !m.read_at, at: when(m.received_at) })) },
      card: rows.length ? { type: "list" as const, title: args.include_read === true ? "WhatsApp messages" : "Unread on WhatsApp", rows } : null,
    };
  }

  async function minutesLeft(tenantId: string) {
    const { data: t } = await sb.from("tenants").select("plan").eq("id", tenantId).maybeSingle();
    const plan = String(t?.plan || "").toLowerCase() || "trial";
    const ai = await minutesGate(sb, tenantId, "ai");
    if (!ai.paid) {
      return {
        result: { plan: "free trial", free_minutes_left: ai.credits },
        card: { type: "summary" as const, title: "Free trial",
                stats: [{ label: "Minutes left", value: ai.credits, tone: ai.credits > 0 ? "good" : "bad" }] },
      };
    }
    // The gate lets the call through when it cannot read the meter, and
    // reports 0 of 0 — which must not be read out as "no minutes".
    if (!ai.limitMinutes) return { result: { plan, error: "the minutes meter could not be read just now" }, card: null };
    // Before 070 there is one pool; the team's calls come out of Nikki's minutes.
    const separateDesk = (await planDeskMinutes(sb, plan).catch(() => null)) !== null;
    const desk = separateDesk ? await minutesGate(sb, tenantId, "desk") : null;
    const left = (g: { usedMinutes: number; limitMinutes: number }) => Math.max(0, g.limitMinutes - g.usedMinutes);
    return {
      result: {
        plan,
        nikki_minutes_used: ai.usedMinutes, nikki_minutes_included: ai.limitMinutes, nikki_minutes_left: left(ai),
        ...(desk && desk.limitMinutes ? {
          team_minutes_used: desk.usedMinutes, team_minutes_included: desk.limitMinutes, team_minutes_left: left(desk),
        } : separateDesk ? {} : { team_minutes: "the team's calls share Nikki's minutes" }),
        top_up_minutes: ai.credits,
      },
      card: {
        type: "summary" as const, title: `Minutes this month — ${plan}`,
        stats: [
          { label: "Nikki", value: `${ai.usedMinutes} / ${ai.limitMinutes}`, tone: left(ai) ? undefined : "bad" },
          ...(desk && desk.limitMinutes
            ? [{ label: "Team", value: `${desk.usedMinutes} / ${desk.limitMinutes}`, tone: left(desk) ? undefined : "bad" }]
            : []),
          ...(ai.credits > 0 ? [{ label: "Top-up", value: ai.credits }] : []),
        ],
      },
    };
  }

  async function teamCalls(tenantId: string, args: any) {
    const days = [1, 7, 30].includes(Number(args.days)) ? Number(args.days) : 1;
    const since = new Date(Date.parse(istDayRange(todayIST()).start) - (days - 1) * 86_400_000).toISOString();
    const [{ data: rows, error }, { data: members }] = await Promise.all([
      sb.from("click_to_call_log").select("agent_user_id, duration_seconds, disposition")
        .eq("tenant_id", tenantId).gte("created_at", since).limit(5000),
      sb.from("tenant_users").select("user_id, display_name, phone").eq("tenant_id", tenantId),
    ]);
    if (error) throw new Error(error.message);
    const blank = () => ({ calls: 0, conversations: 0, talk_minutes: 0, booked: 0, interested: 0, callbacks: 0 });
    const by = new Map<string, ReturnType<typeof blank>>();
    const all = blank();
    for (const r of rows || []) {
      const k = r.agent_user_id || "unknown";
      const s = by.get(k) || blank();
      const secs = r.duration_seconds || 0;
      for (const x of [s, all]) {
        x.calls += 1;
        // The Desk's own line for a real conversation, so this matches its page.
        if (secs >= CONVERSATION_SECS) { x.conversations += 1; x.talk_minutes += secs / 60; }
        if (r.disposition === "booked") x.booked += 1;
        if (r.disposition === "interested") x.interested += 1;
        if (r.disposition === "callback") x.callbacks += 1;
      }
      by.set(k, s);
    }
    const nameOf = new Map<string, string>((members || []).map((m: any): [string, string] =>
      [m.user_id, m.display_name || (m.phone ? `…${String(m.phone).slice(-4)}` : "Seat")]));
    const people = [...by].map(([id, s]) => ({ name: nameOf.get(id) || "Seat", ...s, talk_minutes: Math.round(s.talk_minutes) }))
      .sort((a, b) => (b.booked - a.booked) || (b.conversations - a.conversations) || (b.calls - a.calls));
    const period = days === 1 ? "today" : `last ${days} days`;
    return {
      result: { period, total: { ...all, talk_minutes: Math.round(all.talk_minutes) }, people },
      card: people.length ? {
        type: "list" as const, title: `Team calls — ${period}`,
        rows: people.slice(0, 10).map(p => ({
          title: p.name,
          subtitle: `${p.calls} calls · ${p.conversations} conversations · ${p.talk_minutes} min`,
          meta: `${p.booked} booked · ${p.interested} interested`,
          tone: p.booked ? "good" : undefined, href: "/desk",
        })),
      } : null,
    };
  }

  async function followUpsDue(tenantId: string) {
    const now = Date.now();
    const { data, error } = await sb.from("leads")
      .select("id, name, phone, stage, follow_up_at, follow_up_note")
      .eq("tenant_id", tenantId)
      .not("follow_up_at", "is", null).is("follow_up_done_at", null)
      .lt("follow_up_at", istDayRange(todayIST()).end)
      .order("follow_up_at", { ascending: true }).limit(20);
    if (error) throw new Error(error.message);
    const when = (t: string) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    const late = (t: string) => new Date(t).getTime() < now;
    const rows = (data || []).map(l => ({
      title: l.name || last10(l.phone) || "—",
      subtitle: l.follow_up_note ? String(l.follow_up_note).slice(0, 80) : undefined,
      meta: when(l.follow_up_at), tone: late(l.follow_up_at) ? "bad" : "warn", href: "/desk",
    }));
    return {
      result: { count: rows.length, overdue: (data || []).filter(l => late(l.follow_up_at)).length,
        follow_ups: (data || []).map(l => ({ name: l.name, phone: last10(l.phone), due: when(l.follow_up_at),
          overdue: late(l.follow_up_at), note: l.follow_up_note ? String(l.follow_up_note).slice(0, 160) : null })) },
      card: rows.length ? { type: "list" as const, title: "Call-backs due", rows } : null,
    };
  }

  async function listCampaigns(tenantId: string) {
    const { data: camps, error } = await sb.from("outbound_campaigns")
      .select("id, name, status, created_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5);
    if (error) throw new Error(error.message);
    // Counted, not fetched: a campaign's list is thousands of rows and a
    // select returns the first thousand.
    const count = async (id: string, waitingOnly: boolean) => {
      let q = sb.from("outbound_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", id);
      if (waitingOnly) q = q.in("status", ["pending", "queued", "in_progress"]);
      return (await q).count || 0;
    };
    const list = await Promise.all((camps || []).map(async c => {
      const [total, left] = await Promise.all([count(c.id, false), count(c.id, true)]);
      return { name: c.name, status: c.status, numbers: total, called: total - left, left };
    }));
    return {
      result: { count: list.length, campaigns: list },
      card: list.length ? {
        type: "list" as const, title: "Campaigns",
        rows: list.map(c => ({
          title: c.name || "Campaign", subtitle: `${c.called} of ${c.numbers} called`,
          meta: c.status, tone: c.status === "running" ? "good" : c.status === "paused" ? "warn" : undefined,
          href: "/campaigns",
        })),
      } : null,
    };
  }

  async function callsLearned(tenantId: string) {
    const { data, error } = await sb.from("desk_insights").select("day, calls, digest, suggestions")
      .eq("tenant_id", tenantId).order("day", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return { result: { available: false, note: "No daily digest has been written for this business yet." }, card: null };
    const d: any = data.digest || {};
    const top = (v: unknown, n: number) => (Array.isArray(v) ? v : []).slice(0, n).map(x => String(x).slice(0, 200));
    const waiting = (Array.isArray(data.suggestions) ? data.suggestions : []).filter((x: any) => x?.status === "pending").length;
    const tips = top(d.tips, 4);
    return {
      result: { day: data.day, calls: data.calls, headline: String(d.headline || ""),
        objections: top(d.objections, 3), questions: top(d.questions, 3),
        what_worked: top(d.what_worked, 2), tips: tips.slice(0, 3),
        suggested_answers_waiting_for_owner: waiting },
      card: tips.length ? { type: "list" as const, title: `What the calls taught — ${data.day}`,
        rows: tips.map(t => ({ title: t, href: "/desk" })) } : null,
    };
  }

  // ── Write proposals ──────────────────────────────────────────
  function propose(tenantId: string, tool: string, args: any,
                   label: string, description: string, danger = false) {
    reap();
    const id = crypto.randomUUID();
    pending.set(id, { tenantId, tool, args, label, description, danger, at: Date.now() });
    return { id, label, description, danger };
  }

  /** Runs only after a person has pressed the button. */
  async function execute(p: Pending): Promise<OwnerTurn> {
    const { tenantId, tool, args } = p;
    if (tool === "call_customer_back") {
      const phone = last10(args.phone);
      if (phone.length !== 10) return { answer: "That number does not look like a mobile — nothing was dialled." };
      const { data: did } = await sb.from("dids").select("number")
        .eq("tenant_id", tenantId).eq("status", "assigned").limit(1).maybeSingle();
      if (!did) return { answer: "This business has no phone number to dial out from, so I could not place the call." };
      const { error } = await sb.from("outbound_recipients").insert({
        tenant_id: tenantId, campaign_id: null, is_instant: true,
        phone: `+91${phone}`, first_name: args.name || null, status: "pending",
        // The owner asked for this call, about their own customer, in their
        // own dashboard. That is the consent record.
        consent_declared: true, consent_at: new Date().toISOString(),
        metadata: { source: "owner_assistant", message: String(args.message || "").slice(0, 500), purpose: "follow_up" },
      });
      if (error) return { answer: `I could not queue the call: ${error.message}` };
      return { answer: `Done — Nikki will ring ${phone} shortly and say that. Calls go out between 9 in the morning and half past 8 at night.` };
    }

    if (tool === "set_order_status") {
      const ref = String(args.reference || "").toUpperCase();
      const { data, error } = await sb.from("orders").update({ status: args.status })
        .eq("tenant_id", tenantId).eq("reference", ref).select("reference, status, customer_name").maybeSingle();
      if (error) return { answer: `I could not update ${ref}: ${error.message}` };
      if (!data) return { answer: `I could not find an order called ${ref}.` };
      return { answer: `${data.reference} is now ${data.status}.` };
    }

    if (tool === "cancel_appointment") {
      const key = String(args.booking_ref || "").trim();
      const digits = last10(key);
      // Find the ONE booking first, then cancel it by id. This was
      // update().like().eq().select().limit(1): the limit applies to the rows
      // RETURNED, not the rows UPDATED, so "cancel by phone" cancelled every
      // confirmed booking that number had — past and future — and reported
      // one. By phone it is the next upcoming confirmed slot.
      let find = sb.from("appointments")
        .select("id, booking_ref, slot_date, slot_time, caller_name").eq("tenant_id", tenantId);
      find = digits.length === 10
        ? find.like("caller_number", `%${digits}`).eq("status", "confirmed")
            .gte("slot_date", todayIST())
            .order("slot_date", { ascending: true }).order("slot_time", { ascending: true })
        : find.eq("booking_ref", key.toUpperCase()).neq("status", "cancelled");
      const { data: target, error: findErr } = await find.limit(1).maybeSingle();
      if (findErr) return { answer: `I could not cancel it: ${findErr.message}` };
      if (!target) return { answer: `I could not find a confirmed booking for ${key}.` };
      const { data, error } = await sb.from("appointments").update({ status: "cancelled" })
        .eq("id", target.id).eq("tenant_id", tenantId).neq("status", "cancelled")
        .select("booking_ref, slot_date, slot_time, caller_name");
      if (error) return { answer: `I could not cancel it: ${error.message}` };
      if (!data?.length) return { answer: `That booking was already cancelled.` };
      const a = data[0];
      // Say WHOSE booking. "Cancelled 001 on 2026-09-20 at 11:00" is a
      // reference number read aloud to someone who has never seen it; the
      // owner knows the customer by name.
      const who = a.caller_name ? `${a.caller_name}'s booking` : (a.booking_ref ? `booking ${a.booking_ref}` : "the booking");
      return { answer: `Cancelled ${who}${a.slot_date ? ` on ${a.slot_date}` : ""}${a.slot_time ? ` at ${a.slot_time}` : ""}.` };
    }

    return { answer: "That action is no longer available." };
  }

  // ── The turn ─────────────────────────────────────────────────
  const SYSTEM = `You are Nikki, talking to the OWNER of this business inside their own dashboard.

You are not on a call. This person runs the shop and wants a straight answer
about their own numbers, or wants something done.

- Use the tools. Do not answer from the summary alone when a tool would give
  the real rows: "who is coming tomorrow" means calling list_appointments,
  not reading yesterday's count aloud, and "how many calls today" means
  day_calls, not missed_calls — a question about calls is not a question
  about the ones that failed.
- Answer in two sentences at most, spoken plainly, in the language they used.
  The dashboard shows the detail beside you as cards — do not read a list out
  loud, say what matters about it.
- Numbers as digits. Never invent one. If a tool returns nothing, say so.
- The three action tools (ringing a customer, changing an order, cancelling a
  booking) do NOT happen when you call them. They ask the owner to confirm.
  So say what you are about to do, not that you have done it.
- If they TELL you a fact about the business rather than asking something —
  "we shut next Monday", "delivery is free within 5km" — reply with
  "REMEMBER: <the fact in one clean sentence>" on its own first line, then
  your spoken confirmation on the next.`;

  // The same lookups, heard instead of seen. The phone app's listener has no
  // screen for a card and no button to confirm with, so it gets the read
  // tools only and is told to say the rows that matter.
  const SPOKEN = `You are Nikki, the voice assistant on this business owner's phone. They woke you
by saying "Hey Nikki" and will HEAR your answer; there is no screen.

- Questions about the business: use the tools, do not answer from the summary
  alone when a tool would give the real rows. "How many calls today" means
  day_calls, not missed_calls.
- At most three short sentences, spoken plainly, in the language they used —
  Telugu when you cannot tell. No lists, no markdown. Nobody can see the rows,
  so say the two or three that matter most by name, time or amount.
- Numbers as digits. Never invent one. If a tool returns nothing, say so.
- From the phone you can look things up but not change anything. Ringing a
  customer back, moving an order or cancelling a booking is done in the
  dashboard — say that if they ask for one.
- If it is not about the business at all — general knowledge, quick math, a
  chat, the date or time — answer it helpfully instead of saying the data
  lacks it. Calling a contact, alarms and timers are handled by the phone.`;

  async function runOwnerTurn(tenantId: string, question: string, contextJson: string,
                              opts: { spoken?: boolean } = {}): Promise<OwnerTurn> {
    const declarations = opts.spoken ? DECLARATIONS.filter(t => !WRITE_TOOLS.has(t.name)) : DECLARATIONS;
    const system = !opts.spoken ? SYSTEM
      : `${SPOKEN}\n\nNOW: ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date())} in India.`;
    const model = deps.resolveGeminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const contents: any[] = [{ role: "user", parts: [{ text: question }] }];
    const cards: Card[] = [];
    let confirm: OwnerTurn["confirm"];

    for (let hop = 0; hop < 3; hop++) {
      const resp = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": deps.geminiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: `${system}\n\nTODAY (${todayIST()}) SO FAR:\n${contextJson}` }] },
          contents,
          tools: [{ function_declarations: declarations }],
          tool_config: { function_calling_config: { mode: "auto" } },
          generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
        }),
      });
      if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
      const cand = ((await resp.json()) as any).candidates?.[0];
      const parts: any[] = cand?.content?.parts || [];
      const calls = parts.filter(p => p.functionCall).map(p => p.functionCall);

      if (!calls.length) {
        const text = parts.map(p => p.text || "").join("").trim();
        return { answer: text, cards: cards.length ? cards : undefined, confirm };
      }

      contents.push({ role: "model", parts });
      const results: any[] = [];
      for (const call of calls) {
        const name = call.name as string;
        const args = call.args || {};
        let out: any;
        try {
          if (WRITE_TOOLS.has(name) && opts.spoken) {
            // Not offered by voice, and not honoured if asked for anyway.
            out = { error: "that can only be done from the dashboard" };
          } else if (WRITE_TOOLS.has(name)) {
            // Proposed, not performed. The model is told this, but the
            // guarantee lives here rather than in the prompt.
            if (name === "call_customer_back") {
              const phone = last10(args.phone);
              confirm = propose(tenantId, name, args,
                `Ring ${args.name ? args.name + " on " : ""}${phone || "that number"}`,
                `Nikki will call and say: "${String(args.message || "").slice(0, 200)}"`);
            } else if (name === "set_order_status") {
              confirm = propose(tenantId, name, args,
                `Mark ${String(args.reference || "").toUpperCase()} ${args.status}`,
                `The order's status changes to ${args.status}.`,
                args.status === "cancelled");
            } else {
              confirm = propose(tenantId, name, args,
                `Cancel booking ${String(args.booking_ref || "")}`,
                "The appointment is marked cancelled. The customer is not told automatically.",
                true);
            }
            out = { proposed: true, awaiting_owner_confirmation: true,
                    note: "Tell the owner what you are about to do and that they need to confirm it." };
          } else {
            const r = name === "day_calls"         ? await dayCalls(tenantId, args)
                    : name === "list_orders"       ? await listOrders(tenantId, args)
                    : name === "list_appointments" ? await listAppointments(tenantId, args)
                    : name === "list_leads"        ? await listLeads(tenantId)
                    : name === "find_customer"     ? await findCustomer(tenantId, args)
                    : name === "missed_calls"      ? await missedCalls(tenantId, args)
                    : name === "whatsapp_inbox"    ? await whatsappInbox(tenantId, args)
                    : name === "minutes_left"      ? await minutesLeft(tenantId)
                    : name === "team_calls"        ? await teamCalls(tenantId, args)
                    : name === "follow_ups_due"    ? await followUpsDue(tenantId)
                    : name === "list_campaigns"    ? await listCampaigns(tenantId)
                    : name === "calls_learned"     ? await callsLearned(tenantId)
                    : null;
            if (!r) { out = { error: `no such tool: ${name}` }; }
            else { out = r.result; if (r.card) cards.push(r.card); }
          }
        } catch (e: any) {
          console.error(`[owner-tools] ${name} failed:`, e?.message || e);
          out = { error: "that lookup failed" };
        }
        console.log(`[owner-tools] ${name}(${JSON.stringify(args).slice(0, 120)}) -> ${JSON.stringify(out).slice(0, 160)}`);
        results.push({ functionResponse: { name, response: out } });
      }
      contents.push({ role: "user", parts: results });
    }
    return { answer: "I could not work that one out — try asking it a different way.",
             cards: cards.length ? cards : undefined, confirm };
  }

  // Placing a call spends the business's minutes and speaks for it to a
  // customer — owner-only under 039. Changing an order or cancelling a
  // booking is the team's everyday work and stays open to members.
  const OWNER_ONLY_TOOLS = new Set(["call_customer_back"]);

  function mountRoutes(app: Express, verifyJWT: any, getTenantId: (userId: string) => Promise<string | null>) {
    app.post("/api/tenant/assistant/confirm", verifyJWT, async (req: any, res) => {
      const tenantId = await getTenantId(req.user.id);
      if (!tenantId) return res.status(403).json({ ok: false, answer: "No business on this account." });
      reap();
      const p = pending.get(String(req.body?.id || ""));
      // Expiry is deliberate: a confirm button sitting on a screen for an
      // hour is not consent to ring somebody now.
      if (!p) return res.json({ ok: false, answer: "That action expired — ask me again and I'll set it up fresh." });
      if (p.tenantId !== tenantId) return res.status(403).json({ ok: false, answer: "That action belongs to another account." });
      if (OWNER_ONLY_TOOLS.has(p.tool)) {
        const role = await tenantRole(sb, req.user.id, tenantId);
        if (!role || !OWNER_ROLES.includes(role)) {
          // Left pending: the owner can still confirm it within the window.
          const answer = "Only the account owner can confirm a call to a customer.";
          return res.status(403).json({ ok: false, answer, error: answer, code: "owner_only" });
        }
      }
      pending.delete(String(req.body.id));   // one press, one action
      try {
        const out = await execute(p);
        console.log(`[owner-tools] CONFIRMED ${p.tool} by ${req.user.id.slice(0, 8)}`);
        res.json({ ok: true, ...out });
      } catch (e: any) {
        console.error("[owner-tools] execute failed:", e?.message || e);
        res.json({ ok: false, answer: "That did not go through — nothing was changed." });
      }
    });
  }

  return { runOwnerTurn, mountRoutes };
}
