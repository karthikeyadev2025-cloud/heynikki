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
  /** The Cloud API number this business sends from. */
  resolveWaSender: (tenantId: string) => Promise<{ phoneId: string }>;
  /** One approved template to one number; answers the HTTP status to give. */
  sendApprovedTemplate: (tenantId: string, to: string, name: string, variables: any) => Promise<{ status: number; body: any }>;
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
export const toOwner = (type: string | null) =>
  /^(daily_summary|morning_briefing|team_report|onboarding_|owner_)/.test(String(type || ""));

/**
 * Whose chat is it? A customer whose lead belongs to a telecaller is that
 * telecaller's to answer; one nobody owns is anyone's. The owner sees all.
 */
export function mayOpen(viewer: { userId: string; owner: boolean }, assignedTo: string | null | undefined): boolean {
  return viewer.owner || !assignedTo || assignedTo === viewer.userId;
}

/** What WhatsApp accepts, and how big, by kind (Cloud API limits). */
export function mediaKind(mime: string, bytes: number): { kind: "image" | "document" | "audio" | "video" } | { error: string } {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  const mb = bytes / 1048576;
  if (["image/jpeg", "image/png"].includes(m)) return mb <= 5 ? { kind: "image" } : { error: "Photos can be up to 5 MB." };
  if (["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/amr"].includes(m)) return mb <= 16 ? { kind: "audio" } : { error: "Audio can be up to 16 MB." };
  if (["video/mp4", "video/3gpp"].includes(m)) return mb <= 16 ? { kind: "video" } : { error: "Videos can be up to 16 MB." };
  if (["application/pdf", "text/plain", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
       "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
       "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(m)) {
    return mb <= 8 ? { kind: "document" } : { error: "Files can be up to 8 MB here." };
  }
  return { error: "WhatsApp does not accept that kind of file. Send a JPG or PNG photo, a PDF, or an Office document." };
}

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

  async function viewer(req: any, res: any) {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return null; }
    const { data: m } = await sb.from("tenant_users").select("role")
      .eq("tenant_id", tenantId).eq("user_id", req.user.id).maybeSingle();
    return { tenantId, userId: req.user.id as string, owner: ["owner", "super_admin"].includes(m?.role) };
  }

  async function namesFor(tenantId: string, numbers: string[]) {
    const out = new Map<string, { id: string; name: string | null; assigned_to: string | null }>();
    for (let i = 0; i < numbers.length; i += 100) {
      const { data } = await sb.from("leads").select("id, name, phone, assigned_to").eq("tenant_id", tenantId)
        .in("phone", numbers.slice(i, i + 100).flatMap(forms));
      for (const l of data || []) out.set(last10(l.phone), { id: l.id, name: l.name, assigned_to: l.assigned_to });
    }
    return out;
  }

  app.get("/api/whatsapp/chats", verifyJWT, async (req: any, res) => {
    const who = await viewer(req, res); if (!who) return;
    const { tenantId } = who;
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
    const every = buildChats(inb.data as InRow[], out.data as OutRow[]).slice(0, 300);
    const names = await namesFor(tenantId, every.map(c => c.number));
    const chats = every.filter(c => mayOpen(who, names.get(c.number)?.assigned_to));
    for (const c of chats) {
      const l = names.get(c.number);
      if (l) { c.name = l.name; c.lead_id = c.lead_id || l.id; }
    }
    res.json({ chats, unread: chats.reduce((n, c) => n + c.unread, 0), owner: who.owner });
  });

  app.get("/api/whatsapp/chat", verifyJWT, async (req: any, res) => {
    const who = await viewer(req, res); if (!who) return;
    const { tenantId } = who;
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
    if (!mayOpen(who, names.get(number)?.assigned_to)) {
      return res.status(403).json({ error: "This customer is being handled by another member of your team." });
    }
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
    const who = await viewer(req, res); if (!who) return;
    const { data, error } = await sb.from("wa_inbound")
      .select("id, from_number, body, msg_type, received_at, lead_id")
      .eq("tenant_id", who.tenantId).is("read_at", null)
      .order("received_at", { ascending: false }).limit(300);
    if (error) return res.status(500).json({ error: "Could not check WhatsApp." });
    const leadIds = [...new Set((data || []).map((m: any) => m.lead_id).filter(Boolean))];
    const { data: leads } = leadIds.length
      ? await sb.from("leads").select("id, name, assigned_to").in("id", leadIds)
      : { data: [] as any[] };
    const lead = new Map<string, any>((leads || []).map((l: any) => [l.id, l]));
    const mine = (data || []).filter((m: any) => mayOpen(who, lead.get(m.lead_id)?.assigned_to));
    const m = mine[0];
    res.json({ unread: mine.length,
      latest: m ? { id: m.id, number: last10(m.from_number), name: lead.get(m.lead_id)?.name || null,
        body: m.body || `[${m.msg_type || "message"}]`, at: m.received_at } : null });
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

  // ── Send a photo, a PDF, a price list ──────────────────────────────
  // Two steps on Meta's side: hand over the bytes for a media id, then
  // send a message that points at it. Free-form, so only inside the
  // 24-hour window — outside it Meta accepts the send and drops it.
  app.post("/api/whatsapp/send-media", verifyJWT, async (req: any, res) => {
    const who = await viewer(req, res); if (!who) return;
    const { tenantId } = who;
    const to = last10(req.body?.to_number);
    if (!/^[6-9]\d{9}$/.test(to)) return res.status(400).json({ error: "Enter a valid 10-digit mobile number" });
    const mime = String(req.body?.mime || "").toLowerCase().split(";")[0].trim();
    const name = String(req.body?.name || "file").replace(/[^\w. ()-]/g, "_").slice(0, 120) || "file";
    const caption = String(req.body?.caption || "").trim().slice(0, 1000);
    let bytes: Buffer;
    try { bytes = Buffer.from(String(req.body?.data || ""), "base64"); } catch { bytes = Buffer.alloc(0); }
    if (!bytes.length) return res.status(400).json({ error: "The file is empty." });
    const k = mediaKind(mime, bytes.length);
    if ("error" in k) return res.status(400).json({ error: k.error });

    const names = await namesFor(tenantId, [to]);
    if (!mayOpen(who, names.get(to)?.assigned_to)) return res.status(403).json({ error: "This customer is being handled by another member of your team." });
    const [{ data: optOut }, { data: recent }] = await Promise.all([
      sb.from("outbound_opt_outs").select("phone").eq("tenant_id", tenantId).in("phone", forms(to)).limit(1).maybeSingle(),
      sb.from("wa_inbound").select("received_at").eq("tenant_id", tenantId).like("from_number", `%${to}`)
        .order("received_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (optOut) return res.status(409).json({ error: "This number asked not to be contacted." });
    if (!recent?.received_at || Date.now() - Date.parse(recent.received_at) >= DAY_MS) {
      return res.status(409).json({ error: "WhatsApp only allows files within 24 hours of the customer's last message." });
    }
    const token = process.env.META_WA_TOKEN;
    const { phoneId } = await deps.resolveWaSender(tenantId);
    if (!token || !phoneId) return res.status(503).json({ error: "WhatsApp is not connected." });
    const ver = process.env.META_WA_API_VERSION || "v21.0";
    try {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", mime);
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
      const up: any = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/media`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(60_000),
      }).then(r => r.json());
      if (!up?.id) return res.status(502).json({ error: up?.error?.message || "WhatsApp did not accept the file." });
      const media: any = { id: up.id };
      if (caption && k.kind !== "audio") media.caption = caption;
      if (k.kind === "document") media.filename = name;
      const sent: any = await fetch(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: `91${to}`, type: k.kind, [k.kind]: media }),
        signal: AbortSignal.timeout(20_000),
      }).then(r => r.json());
      const id = sent?.messages?.[0]?.id;
      if (!id) return res.status(502).json({ error: sent?.error?.message || "WhatsApp did not send the file." });
      const what = k.kind === "image" ? "Photo" : k.kind === "document" ? name : k.kind === "audio" ? "Audio" : "Video";
      await sb.from("wa_dispatch_log").insert({ tenant_id: tenantId, to_number: to, message_type: "manual_reply",
        message_body: `[${what}]${caption ? " " + caption : ""}`, status: "sent", provider_msg_id: id })
        .then(r => r.error && console.error("[wa media] log:", r.error.message));
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[wa media]", e?.message);
      res.status(502).json({ error: "Could not reach WhatsApp. Try again." });
    }
  });

  // ── One approved message to a whole list ───────────────────────────
  // The owner picks who (a tag, a stage, a person's list) and which
  // approved message. /audience says how many that is before anything is
  // sent; /bulk sends to a page of them, and the browser walks the pages so
  // a tab that is closed stops the run instead of leaving it going unseen.
  const BULK_MAX = 1000, BULK_PAGE = 20;

  async function audience(tenantId: string, f: any): Promise<{ id: string; phone: string }[]> {
    let q = sb.from("leads").select("id, phone").eq("tenant_id", tenantId);
    const tag = String(f?.tag || "").trim(), stage = String(f?.stage || "").trim(), person = String(f?.assigned_to || "").trim();
    if (tag) q = q.contains("tags", [tag]);
    if (stage) q = q.eq("stage", stage);
    if (person === "none") q = q.is("assigned_to", null);
    else if (person) q = q.eq("assigned_to", person);
    const { data, error } = await q.order("id").limit(BULK_MAX + 1);
    if (error) throw new Error(error.message);
    const seen = new Set<string>();
    return (data || []).map((l: any) => ({ id: l.id, phone: last10(l.phone) }))
      .filter(l => /^[6-9]\d{9}$/.test(l.phone) && !seen.has(l.phone) && !!seen.add(l.phone));
  }
  async function optedOut(tenantId: string): Promise<Set<string>> {
    const { data } = await sb.from("outbound_opt_outs").select("phone").eq("tenant_id", tenantId).limit(10000);
    return new Set((data || []).map((o: any) => last10(o.phone)));
  }
  async function ownerOnly(req: any, res: any) {
    const who = await viewer(req, res); if (!who) return null;
    if (!who.owner) { res.status(403).json({ error: "Only the owner can message a whole list.", code: "owner_only" }); return null; }
    return who;
  }

  app.post("/api/whatsapp/bulk/audience", verifyJWT, async (req: any, res) => {
    const who = await ownerOnly(req, res); if (!who) return;
    const f = req.body || {};
    if (!f.tag && !f.stage && !f.assigned_to) return res.status(400).json({ error: "Choose a list, a stage or a person first." });
    try {
      const [all, out] = await Promise.all([audience(who.tenantId, f), optedOut(who.tenantId)]);
      const ok = all.filter(l => !out.has(l.phone));
      res.json({ count: Math.min(ok.length, BULK_MAX), opted_out: all.length - ok.length, over_limit: ok.length > BULK_MAX, limit: BULK_MAX, page: BULK_PAGE });
    } catch (e: any) { console.error("[wa bulk]", e.message); res.status(500).json({ error: "Could not count that list." }); }
  });

  // { filter, template_name, variables, offset } → sends to the next page.
  app.post("/api/whatsapp/bulk/send", verifyJWT, async (req: any, res) => {
    const who = await ownerOnly(req, res); if (!who) return;
    const f = req.body?.filter || {};
    const name = String(req.body?.template_name || "").trim();
    const offset = Math.max(0, parseInt(req.body?.offset) || 0);
    if (!f.tag && !f.stage && !f.assigned_to) return res.status(400).json({ error: "Choose a list, a stage or a person first." });
    if (!name) return res.status(400).json({ error: "Pick a ready-made message." });
    try {
      const [all, out] = await Promise.all([audience(who.tenantId, f), optedOut(who.tenantId)]);
      const ok = all.filter(l => !out.has(l.phone)).slice(0, BULK_MAX);
      const page = ok.slice(offset, offset + BULK_PAGE);
      let sent = 0, failed = 0, firstError = "";
      for (const l of page) {
        const r = await deps.sendApprovedTemplate(who.tenantId, l.phone, name, req.body?.variables);
        if (r.status === 200) sent += 1;
        else {
          failed += 1; firstError = firstError || r.body?.error || "";
          // Wrong template or wrong values fail for everyone: stop at once
          // rather than failing a thousand times.
          if ([400, 404].includes(r.status)) return res.status(r.status).json(r.body);
        }
        await new Promise(done => setTimeout(done, 120));
      }
      const next = offset + page.length;
      res.json({ sent, failed, error: firstError || null, next, total: ok.length, done: next >= ok.length });
    } catch (e: any) { console.error("[wa bulk]", e.message); res.status(500).json({ error: "The send stopped. What was sent is in the chat list." }); }
  });
}
