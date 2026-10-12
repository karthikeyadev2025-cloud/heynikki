/**
 * WhatsApp, as conversations.
 *
 * The WhatsApp page listed replies under one another with a composer below
 * each, built in the browser from the last 60 inbound rows and the last 50
 * sends. A business with a busy day lost the top of every conversation, a
 * customer's photo was the word "[image]", and nobody was told a message
 * had arrived unless they happened to open the page.
 *
 *   GET  /api/whatsapp/chats        one row per customer, newest first
 *   GET  /api/whatsapp/chat         one conversation, both directions, in order
 *   GET  /api/whatsapp/unread       how many are unread and the newest of them
 *   GET  /api/whatsapp/media/:id    the file behind a photo, voice note or PDF
 *
 * Sending stays where it was (/api/whatsapp/send-as-tenant inside Meta's
 * 24-hour window, /api/whatsapp/send-template outside it).
 */
import type { Express, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

type Deps = {
  sb: SupabaseClient;
  verifyJWT: RequestHandler;
  getTenantId: (userId: string) => Promise<string | null>;
};

const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
const DAY_MS = 24 * 3600 * 1000;

export type InRow = { id: string; from_number: string; body: string | null; msg_type: string | null;
  received_at: string; read_at: string | null; lead_id?: string | null };
export type OutRow = { id?: string; to_number: string; message_type: string | null; message_body: string | null;
  status: string | null; sent_at: string };

export type Chat = {
  number: string; lead_id: string | null; name: string | null;
  last: string; last_at: string; last_dir: "in" | "out"; last_status: string | null;
  unread: number; window_open: boolean; window_closes_at: string | null;
  /** They wrote last and nobody has answered. */
  waiting: boolean;
};

/* ── pure shaping (tested) ──────────────────────────────────── */

/**
 * Messages the platform sends the business owner (the daily summary, the
 * onboarding notes) are logged against the business too. They are not a
 * conversation with a customer and do not belong in its inbox.
 */
export const toOwner = (type: string | null) => /^(daily_summary|onboarding_|owner_)/.test(String(type || ""));

/**
 * One row per customer from both logs. Rows may arrive in any order. A
 * number in either log is a conversation: an automatic confirmation is
 * still something this business said to that person.
 */
export function buildChats(inbound: InRow[], outbound: OutRow[], now = Date.now()): Chat[] {
  const chats = new Map<string, Chat & { last_in: string | null }>();
  const blank = (number: string) => ({ number, lead_id: null, name: null, last: "", last_at: "",
    last_dir: "in" as const, last_status: null, unread: 0, window_open: false, window_closes_at: null,
    waiting: false, last_in: null });
  for (const m of inbound) {
    const n = last10(m.from_number); if (n.length !== 10) continue;
    const c = chats.get(n) || chats.set(n, blank(n)).get(n)!;
    if (!m.read_at) c.unread += 1;
    if (!c.lead_id && m.lead_id) c.lead_id = m.lead_id;
    if (!c.last_in || m.received_at > c.last_in) c.last_in = m.received_at;
    if (m.received_at > c.last_at) {
      Object.assign(c, { last: m.body || `[${m.msg_type || "message"}]`, last_at: m.received_at, last_dir: "in", last_status: null });
    }
  }
  for (const o of outbound) {
    const n = last10(o.to_number); if (n.length !== 10 || toOwner(o.message_type)) continue;
    const c = chats.get(n) || chats.set(n, blank(n)).get(n)!;
    if (o.sent_at > c.last_at) {
      Object.assign(c, { last: o.message_body || "", last_at: o.sent_at, last_dir: "out", last_status: o.status || "sent" });
    }
  }
  return Array.from(chats.values()).map(({ last_in, ...c }) => {
    const closes = last_in ? Date.parse(last_in) + DAY_MS : 0;
    return { ...c, waiting: c.last_dir === "in",
      window_open: closes > now, window_closes_at: last_in ? new Date(closes).toISOString() : null };
  }).sort((a, b) => b.last_at.localeCompare(a.last_at));
}

/** What an automatic message was, in the business's words. */
export function outLabel(type: string | null): string | null {
  switch (type) {
    case "manual_reply": case "manual_template": case "custom": case null: return null;
    case "confirmation": return "Booking confirmation";
    case "missed_call": return "Missed-call message";
    case "reminder": return "Reminder";
    case "callback": return "Callback message";
    case "survey": return "Feedback request";
    default: return String(type).replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  }
}

/* ── routes ─────────────────────────────────────────────────── */

export function mountWaChatRoutes(app: Express, deps: Deps) {
  const { sb, verifyJWT, getTenantId } = deps;
  const forms = (n: string) => [n, `91${n}`, `+91${n}`];

  async function namesFor(tenantId: string, numbers: string[]) {
    const out = new Map<string, { id: string; name: string | null }>();
    for (let i = 0; i < numbers.length; i += 100) {
      const { data } = await sb.from("leads").select("id, name, phone").eq("tenant_id", tenantId)
        .in("phone", numbers.slice(i, i + 100).flatMap(forms));
      for (const l of data || []) out.set(last10(l.phone), { id: l.id, name: l.name });
    }
    return out;
  }

  app.get("/api/whatsapp/chats", verifyJWT, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    const [inb, out] = await Promise.all([
      sb.from("wa_inbound").select("id, from_number, body, msg_type, received_at, read_at, lead_id")
        .eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(1000),
      sb.from("wa_dispatch_log").select("to_number, message_type, message_body, status, sent_at")
        .eq("tenant_id", tenantId).order("sent_at", { ascending: false }).limit(1000),
    ]);
    if (inb.error || out.error) {
      console.error("[wa chats]", (inb.error || out.error)!.message);
      return res.status(500).json({ error: "Could not load WhatsApp chats." });
    }
    const chats = buildChats(inb.data as InRow[], out.data as OutRow[]).slice(0, 300);
    const names = await namesFor(tenantId, chats.map(c => c.number));
    for (const c of chats) {
      const l = names.get(c.number);
      if (l) { c.name = l.name; c.lead_id = c.lead_id || l.id; }
    }
    res.json({ chats, unread: chats.reduce((n, c) => n + c.unread, 0) });
  });

  app.get("/api/whatsapp/chat", verifyJWT, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    const number = last10(req.query.number);
    if (!/^[6-9]\d{9}$/.test(number)) return res.status(400).json({ error: "number required" });
    const inbound = (cols: string) => sb.from("wa_inbound").select(cols).eq("tenant_id", tenantId)
      .like("from_number", `%${number}`).order("received_at", { ascending: false }).limit(300);
    const [inbRes, out, names, optOut] = await Promise.all([
      // Before migration 072 there are no media columns; the chat still opens.
      inbound("id, body, msg_type, received_at, read_at, media_id, media_mime, media_name")
        .then((r: any) => r.error ? inbound("id, body, msg_type, received_at, read_at") : r),
      sb.from("wa_dispatch_log").select("id, message_type, message_body, status, sent_at")
        .eq("tenant_id", tenantId).in("to_number", forms(number)).order("sent_at", { ascending: false }).limit(300),
      namesFor(tenantId, [number]),
      sb.from("outbound_opt_outs").select("phone").eq("tenant_id", tenantId).in("phone", forms(number)).limit(1).maybeSingle(),
    ]);
    if ((inbRes as any).error || out.error) return res.status(500).json({ error: "Could not load this chat." });
    const inb = ((inbRes as any).data || []) as any[];
    const messages = [
      ...inb.map(m => ({ id: m.id, dir: "in", body: m.body || "", type: m.msg_type || "text", at: m.received_at,
        media: m.media_id ? { mime: m.media_mime || null, name: m.media_name || null } : null })),
      ...(out.data || []).filter((m: any) => !toOwner(m.message_type)).map((m: any) => ({ id: m.id, dir: "out", body: m.message_body || "", at: m.sent_at,
        status: m.status || "sent", label: outLabel(m.message_type) })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const lastIn = inb.length ? inb[0].received_at : null;
    // Opening a conversation is reading it.
    if (inb.some(m => !m.read_at)) {
      await sb.from("wa_inbound").update({ read_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).like("from_number", `%${number}`).is("read_at", null);
    }
    const lead = names.get(number) || null;
    res.json({
      number, name: lead?.name || null, lead_id: lead?.id || null, messages,
      opted_out: !!optOut.data,
      window_open: !!lastIn && Date.now() - Date.parse(lastIn) < DAY_MS,
      window_closes_at: lastIn ? new Date(Date.parse(lastIn) + DAY_MS).toISOString() : null,
    });
  });

  // Asked every half minute by every open tab, so it reads only what the
  // partial index on unread rows already holds.
  app.get("/api/whatsapp/unread", verifyJWT, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    const { data, error, count } = await sb.from("wa_inbound")
      .select("id, from_number, body, msg_type, received_at, lead_id", { count: "exact" })
      .eq("tenant_id", tenantId).is("read_at", null)
      .order("received_at", { ascending: false }).limit(1);
    if (error) return res.status(500).json({ error: "Could not check WhatsApp." });
    const m = data?.[0];
    let name: string | null = null;
    if (m?.lead_id) {
      const { data: l } = await sb.from("leads").select("name").eq("id", m.lead_id).maybeSingle();
      name = l?.name || null;
    }
    res.json({ unread: count || 0,
      latest: m ? { id: m.id, number: last10(m.from_number), name, body: m.body || `[${m.msg_type || "message"}]`, at: m.received_at } : null });
  });

  // Meta hands over a media id, not the file, and both steps of fetching it
  // need the platform token — so the browser asks here. Scoped to the
  // caller's own business: the row is looked up by id AND tenant.
  app.get("/api/whatsapp/media/:id", verifyJWT, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: "Bad id" });
    const { data: row, error } = await sb.from("wa_inbound").select("media_id, media_mime, media_name")
      .eq("id", req.params.id).eq("tenant_id", tenantId).maybeSingle();
    if (error) return res.status(503).json({ error: "Files are not switched on for this account yet." });
    if (!row?.media_id) return res.status(404).json({ error: "This message has no file." });
    const token = process.env.META_WA_TOKEN;
    if (!token) return res.status(503).json({ error: "WhatsApp is not connected." });
    try {
      const auth = { Authorization: `Bearer ${token}` };
      const ver = process.env.META_WA_API_VERSION || "v21.0";
      const meta: any = await fetch(`https://graph.facebook.com/${ver}/${encodeURIComponent(row.media_id)}`,
        { headers: auth, signal: AbortSignal.timeout(15_000) }).then(r => r.json());
      if (!meta?.url) return res.status(410).json({ error: "WhatsApp no longer has this file (it keeps them about 30 days)." });
      const file = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(30_000) });
      if (!file.ok) return res.status(502).json({ error: `WhatsApp returned ${file.status} for the file.` });
      res.setHeader("Content-Type", row.media_mime || meta.mime_type || "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=86400");
      if (row.media_name) res.setHeader("Content-Disposition", `inline; filename="${String(row.media_name).replace(/[^\w. -]/g, "_")}"`);
      res.send(Buffer.from(await file.arrayBuffer()));
    } catch (e: any) {
      res.status(502).json({ error: `Could not fetch the file (${e?.message || "network"}).` });
    }
  });
}
