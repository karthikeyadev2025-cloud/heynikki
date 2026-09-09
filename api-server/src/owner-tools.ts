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
        subtitle: new Date(c.created_at).toLocaleString("en-IN"),
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
    const [{ data: calls }, { data: appts }, { data: orders }] = await Promise.all([
      sb.from("calls").select("status, duration_seconds, appointment_created, intent")
        .eq("tenant_id", tenantId)
        .gte("created_at", `${day}T00:00:00`).lte("created_at", `${day}T23:59:59`),
      sb.from("appointments").select("id").eq("tenant_id", tenantId).eq("slot_date", day),
      sb.from("orders").select("total").eq("tenant_id", tenantId)
        .gte("created_at", `${day}T00:00:00`).lte("created_at", `${day}T23:59:59`)
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
    const { data } = await sb.from("calls")
      .select("id, caller_number, created_at, status, duration_seconds")
      .eq("tenant_id", tenantId).eq("status", "missed")
      .gte("created_at", `${day}T00:00:00`).lte("created_at", `${day}T23:59:59`)
      .order("created_at", { ascending: false }).limit(20);
    const rows = (data || []).map(c => ({
      title: c.caller_number || "unknown",
      subtitle: new Date(c.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      meta: "missed", tone: "bad" as string, href: "/calls",
    }));
    return {
      result: { day, count: rows.length, numbers: (data || []).map(c => c.caller_number) },
      card: rows.length ? { type: "list" as const, title: `Missed calls — ${day}`, rows } : null,
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
      let q = sb.from("appointments").update({ status: "cancelled" }).eq("tenant_id", tenantId);
      q = digits.length === 10 ? q.like("caller_number", `%${digits}`).eq("status", "confirmed")
                               : q.eq("booking_ref", key.toUpperCase());
      const { data, error } = await q.select("booking_ref, slot_date, slot_time, caller_name").limit(1);
      if (error) return { answer: `I could not cancel it: ${error.message}` };
      if (!data?.length) return { answer: `I could not find a confirmed booking for ${key}.` };
      const a = data[0];
      return { answer: `Cancelled ${a.booking_ref || "the booking"}${a.slot_date ? ` on ${a.slot_date}` : ""}${a.slot_time ? ` at ${a.slot_time}` : ""}.` };
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

  async function runOwnerTurn(tenantId: string, question: string, contextJson: string): Promise<OwnerTurn> {
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
          system_instruction: { parts: [{ text: `${SYSTEM}\n\nTODAY (${todayIST()}) SO FAR:\n${contextJson}` }] },
          contents,
          tools: [{ function_declarations: DECLARATIONS }],
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
          if (WRITE_TOOLS.has(name)) {
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
