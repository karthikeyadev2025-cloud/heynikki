/**
 * The telecaller's working day on the Desk, beyond dialling.
 *
 * The Desk could place a call and record an outcome, and everything in
 * between was the telecaller's memory: who to ring next, when they had
 * promised to ring back, what was said last time. This is that part.
 *
 *   GET  /api/desk/queue            callbacks due now, then the next lead to ring
 *   POST /api/desk/followup         schedule (or clear) a callback on a lead
 *   GET  /api/desk/customer         one number's history, for the call screen
 *   POST /api/desk/calls/:id/summary  summary + suggested outcome from the recording
 *   POST /api/desk/whatsapp         send the brochure template to a lead
 *   GET  /api/desk/stats            your numbers; the owner also gets the team
 *   POST /api/desk/calls/:id/review the owner's 1-5 review of a call
 *
 * And a reminder loop: a callback coming due pushes a notification to the
 * person it is assigned to, ten minutes ahead, once.
 *
 * Leads already carry assigned_to and the follow_up_* columns (056); 066
 * adds the summary and review columns on click_to_call_log. Every read of a
 * 066 column degrades to "not there yet" rather than failing the Desk.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiGenerate } from "./gemini";
import { phoneForms } from "./campaign-import";
import { CONVERSATION_SECS } from "./attendance";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Deps = {
  sb: SupabaseClient;
  verifyJWT: Mw;
  apiLimiter: Mw;
  getTenantId: (userId: string) => Promise<string | null>;
  audit: (action: string, o: any) => Promise<any>;
  sendWhatsApp: (...a: any[]) => Promise<any>;
  pushToUsers: (userIds: string[], msg: { title: string; body: string; data?: Record<string, any> }) => Promise<any>;
  pipelineUrl: string;
  internalSecret: string;
  applyDisposition: (o: { tenantId: string; ctcLogId: string; disposition: string; notes?: string | null;
    followUpAt?: string | null; actorId: string | null; auto?: boolean }) => Promise<{ ok: boolean; notFound?: boolean }>;
};

const OPEN_STAGES = ["new", "contacted", "qualified"];
const OUTCOMES = ["booked", "interested", "callback", "not_interested", "no_answer"];
const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
// Recordings are fetched whole and sent inline to the model. A 15-minute
// 8 kHz mono WAV is ~14 MB; past that the call is long enough that the
// telecaller writes their own notes.
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export function mountDeskProRoutes(app: Express, d: Deps) {
  const { sb, verifyJWT, apiLimiter, getTenantId, audit } = d;

  async function me(req: any, res: Response) {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return null; }
    const { data: m } = await sb.from("tenant_users").select("id, role, display_name")
      .eq("tenant_id", tenantId).eq("user_id", req.user.id).maybeSingle();
    if (!m) { res.status(403).json({ error: "No seat" }); return null; }
    return { tenantId, userId: req.user.id as string, owner: ["owner", "super_admin"].includes(m.role) };
  }

  const LEAD_COLS = "id, name, phone, stage, score, interest, notes, call_count, last_contacted_at, "
    + "assigned_to, follow_up_at, follow_up_note, follow_up_done_at, created_at";

  // ── Queue ──────────────────────────────────────────────────────────
  // Callbacks first — a promise to ring someone at four is the one thing a
  // telecaller must not miss — then the next lead nobody has rung lately.
  // Theirs before the shared pool; within each, the hottest first. A lead
  // with a callback still in the future waits for that callback instead.
  app.get("/api/desk/queue", verifyJWT, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const { tenantId, userId } = who;
    const skip = String(req.query.skip || "").split(",").filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
    const now = Date.now();
    const soon = new Date(now + 15 * 60_000).toISOString();
    const stale = new Date(now - 20 * 3600_000).toISOString();

    const mineOrPool = `assigned_to.eq.${userId},assigned_to.is.null`;
    const [{ data: due, error: dueErr }, { count: mineOpen }, { count: poolOpen }] = await Promise.all([
      sb.from("leads").select(LEAD_COLS).eq("tenant_id", tenantId)
        .not("follow_up_at", "is", null).is("follow_up_done_at", null).lte("follow_up_at", soon)
        .or(mineOrPool).order("follow_up_at", { ascending: true }).limit(20),
      sb.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
        .eq("assigned_to", userId).in("stage", OPEN_STAGES),
      sb.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)
        .is("assigned_to", null).in("stage", OPEN_STAGES),
    ]);
    if (dueErr) return res.status(500).json({ error: dueErr.message });

    // Numbers that asked not to be called never come up.
    const optedOut = async (phones: string[]) => {
      if (!phones.length) return new Set<string>();
      const forms = phones.flatMap(p => phoneForms(p));
      const { data } = await sb.from("outbound_opt_outs").select("phone")
        .eq("tenant_id", tenantId).in("phone", forms);
      return new Set((data || []).map((r: any) => last10(r.phone)));
    };

    const fresh = async (assigned: "mine" | "pool") => {
      let q = sb.from("leads").select(LEAD_COLS).eq("tenant_id", tenantId)
        .in("stage", OPEN_STAGES).not("phone", "is", null)
        // One or= holding an and(): not rung lately, and no callback pending.
        // (The timestamp is quoted — "." and ":" are PostgREST syntax.)
        .or(`and(or(last_contacted_at.is.null,last_contacted_at.lt."${stale}"),or(follow_up_at.is.null,follow_up_done_at.not.is.null))`)
        .order("score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: true }).limit(25);
      q = assigned === "mine" ? q.eq("assigned_to", userId) : q.is("assigned_to", null);
      if (skip.length) q = q.not("id", "in", `(${skip.join(",")})`);
      const { data } = await q;
      return data || [];
    };
    let candidates = await fresh("mine");
    if (!candidates.length) candidates = await fresh("pool");
    const blocked = await optedOut([...candidates, ...(due || [])].map((l: any) => l.phone));
    const next = candidates.find((l: any) => !blocked.has(last10(l.phone))) || null;

    res.json({
      due: (due || []).filter((l: any) => !blocked.has(last10(l.phone)) && !skip.includes(l.id)),
      next,
      mine_open: mineOpen || 0,
      pool_open: poolOpen || 0,
    });
  });

  // ── Scheduled callback ─────────────────────────────────────────────
  // { lead_id, at (ISO) | null, note } — null clears it. Re-arms the
  // reminder, and gives the lead to whoever booked the callback if nobody
  // owned it, so the reminder has somebody to go to.
  app.post("/api/desk/followup", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const leadId = String(req.body?.lead_id || "");
    const at = req.body?.at ? new Date(req.body.at) : null;
    if (at && (isNaN(at.getTime()) || at.getTime() < Date.now() - 5 * 60_000)) {
      return res.status(400).json({ error: "Pick a time that hasn't passed." });
    }
    const { data: lead } = await sb.from("leads").select("id, assigned_to")
      .eq("id", leadId).eq("tenant_id", who.tenantId).maybeSingle();
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const patch: Record<string, any> = at
      ? { follow_up_at: at.toISOString(), follow_up_note: String(req.body?.note || "").slice(0, 500) || null,
          follow_up_done_at: null, follow_up_notified_at: null }
      : { follow_up_done_at: new Date().toISOString() };
    if (at && !lead.assigned_to) patch.assigned_to = who.userId;
    const { error } = await sb.from("leads").update(patch).eq("id", leadId).eq("tenant_id", who.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, ...patch });
  });

  // ── Customer card ──────────────────────────────────────────────────
  // Everything about one number on one screen: the lead, every call either
  // way, what the desk said about it, and what they have booked or ordered.
  app.get("/api/desk/customer", verifyJWT, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const phone = last10(req.query.phone);
    if (phone.length !== 10) return res.status(400).json({ error: "phone required" });
    const forms = phoneForms(phone);
    const [lead, calls, desk, appts, orders, optOut] = await Promise.all([
      sb.from("leads").select(LEAD_COLS).eq("tenant_id", who.tenantId).in("phone", forms)
        .order("created_at", { ascending: true }).limit(1).maybeSingle(),
      sb.from("calls").select("id, direction, status, intent, duration_seconds, created_at, r2_object_key")
        .eq("tenant_id", who.tenantId).in("caller_number", forms)
        .order("created_at", { ascending: false }).limit(10),
      sb.from("click_to_call_log").select("id, agent_user_id, disposition, notes, duration_seconds, created_at, ai_summary")
        .eq("tenant_id", who.tenantId).in("callee_number", forms)
        .order("created_at", { ascending: false }).limit(8)
        .then((r: any) => r.error
          ? sb.from("click_to_call_log").select("id, agent_user_id, disposition, notes, duration_seconds, created_at")
              .eq("tenant_id", who.tenantId).in("callee_number", forms)
              .order("created_at", { ascending: false }).limit(8)
          : r),
      sb.from("appointments").select("service, slot_date, slot_time, status, booking_ref")
        .eq("tenant_id", who.tenantId).in("caller_number", forms)
        .order("created_at", { ascending: false }).limit(3),
      sb.from("orders").select("reference, status, created_at")
        .eq("tenant_id", who.tenantId).in("customer_phone", forms)
        .order("created_at", { ascending: false }).limit(3),
      sb.from("outbound_opt_outs").select("phone").eq("tenant_id", who.tenantId).in("phone", forms).limit(1).maybeSingle(),
    ]);
    res.json({
      phone,
      lead: lead.data || null,
      opted_out: !!optOut.data,
      calls: (calls.data || []).map((c: any) => ({ ...c, has_recording: !!c.r2_object_key, r2_object_key: undefined })),
      desk: desk.data || [],
      appointments: appts.data || [],
      orders: orders.data || [],
    });
  });

  // ── Summary from the recording ─────────────────────────────────────
  // The Desk asks as soon as the call ends; the recording lands a few
  // seconds after hangup, so "not ready" is an ordinary answer and the Desk
  // asks again. The result is a suggestion: the telecaller picks the outcome.
  type Summary = { status: number; body: any };
  async function summarize(tenantId: string, logId: string): Promise<Summary> {
    const { data: log, error: logErr } = await sb.from("click_to_call_log")
      .select("id, call_id, lead_id, callee_number, ai_summary, ai_disposition, ai_follow_up_at")
      .eq("id", logId).eq("tenant_id", tenantId).maybeSingle();
    if (logErr) return { status: 503, body: { error: "Call summaries need migration 066." } };
    if (!log) return { status: 404, body: { error: "Call not found" } };
    if (log.ai_summary) {
      return { status: 200, body: { summary: log.ai_summary, disposition: log.ai_disposition, follow_up_at: log.ai_follow_up_at, cached: true } };
    }
    const { data: call } = log.call_id
      ? await sb.from("calls").select("id, r2_object_key, duration_seconds").eq("id", log.call_id).maybeSingle()
      : { data: null as any };
    if (!call?.r2_object_key) return { status: 409, body: { error: "not_ready" } };
    if ((call.duration_seconds || 0) < CONVERSATION_SECS) {
      return { status: 200, body: { summary: "", disposition: "no_answer", follow_up_at: null, short: true } };
    }

    let audio: Buffer;
    try {
      const url = new URL(`${d.pipelineUrl}/api/v1/recording/fetch`);
      url.searchParams.set("key", call.r2_object_key);
      url.searchParams.set("tenant_id", tenantId);
      url.searchParams.set("call_id", call.id);
      const r = await fetch(url, { headers: { "X-Internal-Secret": d.internalSecret }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) return { status: 409, body: { error: "not_ready" } };
      audio = Buffer.from(await r.arrayBuffer());
    } catch { return { status: 409, body: { error: "not_ready" } }; }
    if (audio.length > MAX_AUDIO_BYTES) {
      return { status: 200, body: { summary: "", disposition: null, follow_up_at: null, too_long: true } };
    }

    const nowIst = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
    const g = await geminiGenerate({
      contents: [{ parts: [
        { text:
          "This is a recording of a business telecaller's phone call with a customer in India " +
          "(Telugu, Hindi or English, often mixed). Reply with JSON only:\n" +
          '{"summary": "<two short sentences in English: what the customer wants and what was agreed>",\n' +
          ' "disposition": "booked" | "interested" | "callback" | "not_interested" | "no_answer",\n' +
          ' "follow_up_at": "<ISO 8601 with +05:30 if a callback time was agreed, else null>"}\n' +
          `The time now is ${nowIst} IST. "no_answer" means nobody really spoke. ` +
          `A customer who asks for details to be sent is "interested". Never invent a callback time.` },
        { inline_data: { mime_type: "audio/wav", data: audio.toString("base64") } },
      ] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }, { timeoutMs: 45_000, attempts: 2 });
    if (!g.ok) return { status: 502, body: { error: `Couldn't summarise this call (${g.detail})` } };

    const summary = String(g.data?.summary || "").slice(0, 600);
    const disposition = OUTCOMES.includes(g.data?.disposition) ? g.data.disposition : null;
    const fu = g.data?.follow_up_at ? new Date(g.data.follow_up_at) : null;
    const follow_up_at = fu && !isNaN(fu.getTime()) && fu.getTime() > Date.now() ? fu.toISOString() : null;
    await sb.from("click_to_call_log").update({
      ai_summary: summary, ai_disposition: disposition, ai_follow_up_at: follow_up_at, ai_at: new Date().toISOString(),
    }).eq("id", log.id).eq("tenant_id", tenantId);
    return { status: 200, body: { summary, disposition, follow_up_at } };
  }

  // ── Summary from the recording ─────────────────────────────────────
  // The Desk asks as soon as the call ends; the recording lands a few
  // seconds after hangup, so "not ready" is an ordinary answer and the Desk
  // asks again. The result is a suggestion: the telecaller picks the outcome.
  app.post("/api/desk/calls/:id/summary", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const r = await summarize(who.tenantId, req.params.id);
    res.status(r.status).json(r.body);
  });

  // ── One-tap WhatsApp ───────────────────────────────────────────────
  // The approved brochure template, to a lead or a number. Sent from the
  // business's own WhatsApp number once it has one (resolveWaSender).
  app.post("/api/desk/whatsapp", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    let phone = last10(req.body?.phone);
    let name: string | null = null;
    if (req.body?.lead_id) {
      const { data: lead } = await sb.from("leads").select("phone, name")
        .eq("id", req.body.lead_id).eq("tenant_id", who.tenantId).maybeSingle();
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      phone = last10(lead.phone); name = lead.name;
    }
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter a 10-digit mobile number" });
    const { data: opt } = await sb.from("outbound_opt_outs").select("phone")
      .eq("tenant_id", who.tenantId).in("phone", phoneForms(phone)).limit(1).maybeSingle();
    if (opt) return res.status(409).json({ error: "This number asked not to be contacted." });
    const { data: vp } = await sb.from("voice_profiles").select("id, business_name")
      .eq("tenant_id", who.tenantId).eq("status", "active").limit(1).maybeSingle();
    const bn = vp?.business_name || "our team";
    const msg = `నమస్కారం${name ? " " + name : ""}! ${bn} గురించి మీ ఆసక్తికి ధన్యవాదాలు. ` +
      `మీరు అడిగిన details ఇక్కడ ఉన్నాయి. ఏవైనా సందేహాలుంటే ఇక్కడే reply చేయండి. 🙏`;
    const ok = await d.sendWhatsApp(phone, msg, who.tenantId, vp?.id, "brochure", undefined, undefined, bn);
    if (!ok) return res.status(502).json({ error: "WhatsApp didn't accept the message. Try again in a minute." });
    await audit("desk.whatsapp_sent", { tenantId: who.tenantId, actorId: who.userId, metadata: { phone, kind: "brochure" } });
    res.json({ ok: true });
  });

  // ── Stats ──────────────────────────────────────────────────────────
  // days = 1 (today, IST), 7 or 30. Connected = a real conversation
  // (CONVERSATION_SECS), the same line the daily targets use.
  app.get("/api/desk/stats", verifyJWT, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const days = [1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 1;
    const istMidnight = (() => {
      const ist = new Date(Date.now() + 5.5 * 3600_000);
      return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600_000;
    })();
    const since = new Date(istMidnight - (days - 1) * 86400_000).toISOString();
    let q = sb.from("click_to_call_log").select("agent_user_id, duration_seconds, disposition")
      .eq("tenant_id", who.tenantId).gte("created_at", since).limit(5000);
    if (!who.owner) q = q.eq("agent_user_id", who.userId);
    const { data: rows, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const blank = () => ({ calls: 0, connected: 0, talk_seconds: 0, booked: 0, interested: 0, callbacks: 0 });
    const by = new Map<string, ReturnType<typeof blank>>();
    for (const r of rows || []) {
      const k = r.agent_user_id || "unknown";
      const s = by.get(k) || blank();
      s.calls += 1;
      const secs = r.duration_seconds || 0;
      if (secs >= CONVERSATION_SECS) { s.connected += 1; s.talk_seconds += secs; }
      if (r.disposition === "booked") s.booked += 1;
      if (r.disposition === "interested") s.interested += 1;
      if (r.disposition === "callback") s.callbacks += 1;
      by.set(k, s);
    }
    const you = by.get(who.userId) || blank();
    let team: any[] | null = null;
    if (who.owner) {
      const { data: members } = await sb.from("tenant_users").select("user_id, display_name, phone")
        .eq("tenant_id", who.tenantId);
      team = (members || []).map((m: any) => ({
        user_id: m.user_id, name: m.display_name || (m.phone ? `…${String(m.phone).slice(-4)}` : "Seat"),
        is_you: m.user_id === who.userId, ...(by.get(m.user_id) || blank()),
      })).sort((a, b) => (b.booked - a.booked) || (b.connected - a.connected) || (b.calls - a.calls));
    }
    res.json({ days, you, team });
  });

  // ── Call review (owner) ────────────────────────────────────────────
  app.post("/api/desk/calls/:id/review", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    if (!who.owner) return res.status(403).json({ error: "Only the owner reviews calls." });
    const score = Math.round(Number(req.body?.score));
    if (!(score >= 1 && score <= 5)) return res.status(400).json({ error: "Score is 1 to 5." });
    const { data, error } = await sb.from("click_to_call_log").update({
      qa_score: score, qa_note: String(req.body?.note || "").slice(0, 500) || null,
      qa_by: who.userId, qa_at: new Date().toISOString(),
    }).eq("id", req.params.id).eq("tenant_id", who.tenantId).select("id");
    if (error) return res.status(503).json({ error: "Call reviews need migration 066." });
    if (!data?.length) return res.status(404).json({ error: "Call not found" });
    res.json({ ok: true });
  });

  // ── Outcomes nobody chose ──────────────────────────────────────────
  // A telecaller who goes straight to the next call leaves the last one
  // blank; on 24 Sep one seat saved none of 30, and two customers who asked
  // for details were never sent them. Once the telecaller has clearly moved
  // on — a newer call from the same seat, or ten minutes — the summary's
  // suggested outcome is saved for them (marked auto, 069), through the same
  // path a person's save takes. A customer who never came on the line is
  // "no answer" without asking the model.
  let autoRunning = false;
  async function autoOutcomes() {
    if (autoRunning) return;       // a slow summary must not let two sweeps overlap
    autoRunning = true;
    try { await autoOutcomesOnce(); } finally { autoRunning = false; }
  }
  async function autoOutcomesOnce() {
    const now = Date.now();
    const { data: rows, error } = await sb.from("click_to_call_log")
      .select("id, tenant_id, agent_user_id, created_at, duration_seconds, call_id, customer_fail_cause, ai_summary, ai_disposition, ai_follow_up_at")
      .is("disposition", null)
      .lt("created_at", new Date(now - 2 * 60_000).toISOString())
      .gt("created_at", new Date(now - 24 * 3600_000).toISOString())
      .order("created_at", { ascending: true }).limit(15);
    if (error || !rows?.length) return;
    for (const r of rows) {
      // Still live: the hangup hook has not closed its calls row yet.
      if (r.call_id) {
        const { data: c } = await sb.from("calls").select("status").eq("id", r.call_id).maybeSingle();
        if (c?.status === "active") continue;
      }
      const { count: newer } = await sb.from("click_to_call_log").select("id", { count: "exact", head: true })
        .eq("tenant_id", r.tenant_id).eq("agent_user_id", r.agent_user_id).gt("created_at", r.created_at);
      const movedOn = (newer || 0) > 0 || now - new Date(r.created_at).getTime() > 10 * 60_000;
      if (!movedOn) continue;

      let disposition: string | null = null, notes: string | null = null, followUpAt: string | null = null;
      if (r.customer_fail_cause || (r.duration_seconds || 0) < CONVERSATION_SECS) {
        disposition = "no_answer";
      } else {
        let s = r.ai_disposition ? { disposition: r.ai_disposition, summary: r.ai_summary, follow_up_at: r.ai_follow_up_at } : null;
        if (!s) {
          const out = await summarize(r.tenant_id, r.id);
          if (out.status === 409) continue;                 // recording not in yet — next sweep
          s = out.status === 200 ? out.body : null;
        }
        disposition = s?.disposition || null;
        notes = s?.summary || null;
        followUpAt = s?.follow_up_at || null;
      }
      if (!disposition) continue;
      // Re-read: the telecaller may have saved it while we were summarising.
      const { data: still } = await sb.from("click_to_call_log").select("disposition").eq("id", r.id).maybeSingle();
      if (still?.disposition) continue;
      await d.applyDisposition({ tenantId: r.tenant_id, ctcLogId: r.id, disposition, notes,
        followUpAt, actorId: r.agent_user_id, auto: true }).catch(e => console.error("[desk] auto outcome:", e?.message));
      console.log(`[desk] auto outcome ${r.id} → ${disposition}`);
    }
  }
  setInterval(() => { autoOutcomes().catch(e => console.error("[desk] auto outcomes:", e?.message || e)); }, 60_000);

  // ── What the calls taught us ───────────────────────────────────────
  // Once a day per business, the Desk's call summaries and outcomes are
  // read together: what customers objected to and asked, what converted, a
  // line per telecaller, and suggested answers for Nikki. The owner sees it
  // on the Desk; a suggestion reaches live calls only when they approve it
  // (it becomes a knowledge_base fact, like everything else she is taught).
  const istDay = (t = Date.now()) => new Date(t + 5.5 * 3600_000).toISOString().slice(0, 10);

  async function buildInsights(tenantId: string, day: string): Promise<{ ok: boolean; detail?: string; row?: any }> {
    const start = new Date(`${day}T00:00:00+05:30`).toISOString();
    const end   = new Date(new Date(start).getTime() + 86400_000).toISOString();
    const [{ data: calls }, { data: members }, { data: vp }] = await Promise.all([
      sb.from("click_to_call_log").select("agent_user_id, duration_seconds, disposition, ai_summary, notes, customer_fail_cause")
        .eq("tenant_id", tenantId).gte("created_at", start).lt("created_at", end).limit(400),
      sb.from("tenant_users").select("user_id, display_name, phone").eq("tenant_id", tenantId),
      sb.from("voice_profiles").select("id, business_name, services, catalogue")
        .eq("tenant_id", tenantId).eq("status", "active").limit(1).maybeSingle(),
    ]);
    // What the business actually sells, as Nikki knows it. Suggested answers
    // are held to this: the 24 Sep report proposed "CRM, ERP … pricing by
    // email" — ERP was one telecaller's pitch, not something Nikki sells,
    // and Nikki cannot send email at all.
    const { data: facts } = vp?.id
      ? await sb.from("knowledge_base").select("content").eq("voice_profile_id", vp.id)
          .order("created_at", { ascending: false }).limit(60)
      : { data: [] as any[] };
    const catalogue = [
      ...((vp?.services || []) as any[]).map(x => `service: ${x}`),
      ...((vp?.catalogue || []) as any[]).filter((x: any) => x?.available !== false)
        .map((x: any) => `product: ${x.name}${x.price ? ` — ₹${x.price}${x.unit && x.unit !== "single" ? "/" + x.unit : ""}` : ""}`),
      ...((facts || []) as any[]).map(f => `fact: ${String(f.content).slice(0, 200)}`),
    ].slice(0, 90);
    const all = calls || [];
    const talked = all.filter((c: any) => c.ai_summary && (c.duration_seconds || 0) >= CONVERSATION_SECS);
    if (talked.length < 3) return { ok: false, detail: `Only ${talked.length} conversation(s) on ${day} — not enough to learn from.` };
    // A seat without a display name is shown by its email (the part before
    // @), which people recognise; "…0340" was the phone's last four digits.
    const name = new Map<string, string>();
    for (const m of (members || []) as any[]) {
      let n = m.display_name as string | null;
      if (!n) {
        try { n = ((await sb.auth.admin.getUserById(m.user_id)).data?.user?.email || "").split("@")[0] || null; } catch { n = null; }
      }
      name.set(m.user_id, n || (m.phone ? `…${String(m.phone).slice(-4)}` : "Seat"));
    }
    const lines = talked.slice(0, 120).map((c: any, i: number) =>
      `${i + 1}. [${name.get(c.agent_user_id) || "Seat"}] outcome=${c.disposition || "unsaved"} ${c.duration_seconds}s: ${c.ai_summary}`);
    const perSeat: Record<string, any> = {};
    for (const c of all) {
      const k = name.get(c.agent_user_id) || "Seat";
      const s = perSeat[k] || (perSeat[k] = { calls: 0, conversations: 0, interested: 0, booked: 0, unreachable: 0 });
      s.calls += 1;
      if ((c.duration_seconds || 0) >= CONVERSATION_SECS) s.conversations += 1;
      if (c.disposition === "interested") s.interested += 1;
      if (c.disposition === "booked") s.booked += 1;
      if (c.customer_fail_cause) s.unreachable += 1;
    }

    const g = await geminiGenerate({
      contents: [{ parts: [{ text:
        `You coach the telecalling team of "${vp?.business_name || "a business"}" in India. Below are summaries of ` +
        `today's sales calls with their outcomes. Reply with JSON only:\n` +
        `{"headline": "<one sentence: how the day went>",\n` +
        ` "objections": ["<what customers pushed back with, most common first, max 5>"],\n` +
        ` "questions": ["<what customers asked, max 5>"],\n` +
        ` "what_worked": ["<what happened on the calls that went well, max 3>"],\n` +
        ` "tips": ["<concrete advice for tomorrow's calls, max 4, each one sentence>"],\n` +
        ` "suggested_answers": [{"question": "<a question customers asked>", "answer": "<a short answer the AI receptionist could give, in simple English>"}]}\n` +
        `Max 4 suggested answers. Base the digest only on these calls.\n` +
        `Suggested answers must use ONLY the products, services, prices and facts in BUSINESS FACTS below — ` +
        `never a product a telecaller mentioned that is not listed there, never an invented price. ` +
        `The receptionist can send details on WhatsApp and nothing else: never offer email, SMS, a visit or a brochure by post. ` +
        `If a question cannot be answered from BUSINESS FACTS, leave it out.\n\n` +
        `BUSINESS FACTS:\n${catalogue.join("\n") || "(none on file)"}\n\nCALLS:\n${lines.join("\n")}` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
    }, { timeoutMs: 45_000, attempts: 2 });
    if (!g.ok) return { ok: false, detail: `The summary model failed (${g.detail}).` };

    const digest = {
      headline: String(g.data?.headline || "").slice(0, 300),
      objections: (g.data?.objections || []).slice(0, 5).map(String),
      questions: (g.data?.questions || []).slice(0, 5).map(String),
      what_worked: (g.data?.what_worked || []).slice(0, 3).map(String),
      tips: (g.data?.tips || []).slice(0, 4).map(String),
      per_seat: perSeat,
    };
    const suggestions = (g.data?.suggested_answers || []).slice(0, 4)
      .filter((x: any) => x?.question && x?.answer)
      // Belt and braces for the one channel she cannot use.
      .filter((x: any) => !/\be-?mail\b|ఈమెయిల్|ఇమెయిల్/i.test(String(x.answer)))
      .map((x: any, i: number) => ({ id: `${day}-${i}`, question: String(x.question).slice(0, 200),
        answer: String(x.answer).slice(0, 400), status: "pending" }));
    const { data: row, error } = await sb.from("desk_insights")
      .upsert({ tenant_id: tenantId, day, calls: all.length, digest, suggestions }, { onConflict: "tenant_id,day" })
      .select().maybeSingle();
    if (error) return { ok: false, detail: /desk_insights/.test(error.message) ? "Needs migration 069." : error.message };
    return { ok: true, row };
  }

  // Latest insights (owner only).
  app.get("/api/desk/insights", verifyJWT, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    if (!who.owner) return res.status(403).json({ error: "Owner only" });
    const { data, error } = await sb.from("desk_insights").select("*")
      .eq("tenant_id", who.tenantId).order("day", { ascending: false }).limit(1).maybeSingle();
    if (error) return res.json({ insight: null, ready: false });
    res.json({ insight: data || null, ready: true, today: istDay() });
  });

  // Build today's now, rather than waiting for the evening run (owner).
  app.post("/api/desk/insights/run", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    if (!who.owner) return res.status(403).json({ error: "Owner only" });
    const r = await buildInsights(who.tenantId, istDay());
    if (!r.ok) return res.status(409).json({ error: r.detail });
    res.json({ insight: r.row });
  });

  // Approve (→ Nikki learns it) or dismiss one suggested answer (owner).
  app.post("/api/desk/insights/:id/suggestion", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    if (!who.owner) return res.status(403).json({ error: "Owner only" });
    const sid = String(req.body?.suggestion_id || "");
    const action = req.body?.action === "approve" ? "approved" : "dismissed";
    const { data: row } = await sb.from("desk_insights").select("id, suggestions")
      .eq("id", req.params.id).eq("tenant_id", who.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Not found" });
    const list = (row.suggestions || []) as any[];
    const item = list.find(x => x.id === sid);
    if (!item) return res.status(404).json({ error: "Suggestion not found" });
    // The owner may correct the wording before approving.
    const answer = String(req.body?.answer || item.answer).trim().slice(0, 400);
    if (action === "approved") {
      const { data: vp } = await sb.from("voice_profiles").select("id")
        .eq("tenant_id", who.tenantId).eq("status", "active").limit(1).maybeSingle();
      if (!vp) return res.status(409).json({ error: "No active voice profile to teach." });
      const { error } = await sb.from("knowledge_base").insert({
        tenant_id: who.tenantId, voice_profile_id: vp.id, source_type: "faq", source_name: `desk_insights ${String(item.id).slice(0, 10)}`,
        content: `If asked "${item.question}": ${answer}`,
      });
      if (error) return res.status(500).json({ error: error.message });
    }
    const next = list.map(x => x.id === sid ? { ...x, answer, status: action } : x);
    await sb.from("desk_insights").update({ suggestions: next }).eq("id", row.id).eq("tenant_id", who.tenantId);
    await audit("desk.insight_" + action, { tenantId: who.tenantId, actorId: who.userId, metadata: { suggestion: item.question } });
    res.json({ ok: true, suggestions: next });
  });

  // Every half hour from 21:00 IST: businesses with Desk calls today and no
  // insights yet get them, and the owner a push.
  async function eveningInsights() {
    const ist = new Date(Date.now() + 5.5 * 3600_000);
    if (ist.getUTCHours() < 21) return;
    const day = istDay();
    const start = new Date(`${day}T00:00:00+05:30`).toISOString();
    const { data: recent } = await sb.from("click_to_call_log").select("tenant_id").gte("created_at", start).limit(2000);
    const tenants = Array.from(new Set((recent || []).map((r: any) => r.tenant_id)));
    for (const t of tenants) {
      const { data: have, error } = await sb.from("desk_insights").select("id").eq("tenant_id", t).eq("day", day).maybeSingle();
      if (error || have) continue;
      const r = await buildInsights(t, day);
      if (!r.ok) continue;
      const { data: owners } = await sb.from("tenant_users").select("user_id").eq("tenant_id", t).in("role", ["owner", "super_admin"]);
      await d.pushToUsers((owners || []).map((o: any) => o.user_id), {
        title: "Today's calls, read for you",
        body: r.row?.digest?.headline || "What customers asked, what worked, and answers Nikki could learn.",
        data: { type: "desk_insights" },
      }).catch(() => 0);
    }
  }
  setInterval(() => { eveningInsights().catch(e => console.error("[desk] insights:", e?.message || e)); }, 30 * 60_000);

  // ── Callback reminders ─────────────────────────────────────────────
  // Every minute: callbacks due within ten minutes that nobody has been
  // reminded of. Claimed before sending (notified_at null → now), so two
  // processes or a slow push cannot remind twice. Goes to the person the
  // lead is assigned to, or the owners if nobody is.
  async function remind() {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data: dueRows, error } = await sb.from("leads")
      .select("id, tenant_id, name, phone, assigned_to, follow_up_at, follow_up_note")
      .not("follow_up_at", "is", null).is("follow_up_done_at", null).is("follow_up_notified_at", null)
      .lte("follow_up_at", soon).limit(50);
    if (error || !dueRows?.length) return;
    for (const l of dueRows) {
      const { data: claimed } = await sb.from("leads").update({ follow_up_notified_at: new Date().toISOString() })
        .eq("id", l.id).is("follow_up_notified_at", null).select("id");
      if (!claimed?.length) continue;
      let to: string[] = l.assigned_to ? [l.assigned_to] : [];
      if (!to.length) {
        const { data: owners } = await sb.from("tenant_users").select("user_id")
          .eq("tenant_id", l.tenant_id).in("role", ["owner", "super_admin"]);
        to = (owners || []).map((o: any) => o.user_id);
      }
      const when = new Date(l.follow_up_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
      await d.pushToUsers(to, {
        title: `Call back ${l.name || l.phone} at ${when}`,
        body: l.follow_up_note || "You promised to call back. Open the Desk to dial.",
        data: { type: "follow_up", lead_id: l.id, phone: l.phone },
      }).catch(() => 0);
    }
  }
  setInterval(() => { remind().catch(e => console.error("[desk] reminder sweep:", e?.message || e)); }, 60_000);
}
