/**
 * Scheduler — the automation loop.
 *
 * Four jobs that all needed a periodic runner, so they share one rather
 * than three separate crons:
 *
 *  1. EMBED KNOWLEDGE — rows added via the "Teach Nikki" page are saved with
 *     embedding = NULL, because embedding needs the Gemini key and that must
 *     never ship to a browser. This picks them up and embeds them, at which
 *     point calls start using them. Without this job the knowledge base page
 *     writes rows that RAG can never match.
 *
 *  2. APPOINTMENT REMINDERS — the 24h reminder endpoint existed in
 *     api-server but NOTHING EVER CALLED IT, so no reminder has ever been
 *     sent. This finds tomorrow's confirmed appointments that haven't been
 *     reminded and fires them.
 *
 *  3. DAILY SUMMARY — the business owner had no way to learn what happened
 *     unless they opened the dashboard. This sends an end-of-day WhatsApp:
 *     calls answered, appointments booked, leads worth calling back.
 *
 *  4. CALL QUALITY — scores completed calls from the transcript already
 *     stored on them. Nothing has ever read those transcripts back except a
 *     person opening one call at a time; this reviews all of them so a
 *     supervisor can look at the worst ten instead of listening to two
 *     hundred.
 *
 * Idempotency: every job checks a persisted flag before acting
 * (embedding IS NULL, wa_reminder_sent = false, summary keyed by date), so
 * running this more often than needed never double-sends.
 *
 * Run every 15 minutes:
 *   npx ts-node src/jobs/scheduler.ts
 * On Railway: add as a Cron service with schedule "*\/15 * * * *".
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const GEMINI_KEY    = process.env.GEMINI_API_KEY || "";
const API_URL       = process.env.API_URL || "http://localhost:4000";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

// Must match voice-pipeline/app/exotel/knowledge.py — a mismatch here means
// embeddings that can never match at query time.
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMENSIONS = 1536;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const log = (...a: unknown[]) => console.log("[scheduler]", ...a);

/* ── 1. Embed pending knowledge ─────────────────────────────── */

async function embedText(text: string): Promise<number[] | null> {
  if (!GEMINI_KEY || !text?.trim()) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: EMBED_DIMENSIONS,
        }),
      }
    );
    if (!r.ok) {
      log("embed failed", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j = (await r.json()) as { embedding?: { values?: number[] } };
    return j?.embedding?.values ?? null;
  } catch (e) {
    log("embed error", e);
    return null;
  }
}

export async function runEmbedKnowledge(): Promise<number> {
  const { data, error } = await sb
    .from("knowledge_base")
    .select("id, content")
    .is("embedding", null)
    .limit(50);
  if (error) { log("knowledge fetch failed:", error.message); return 0; }
  if (!data?.length) return 0;

  let done = 0;
  for (const row of data) {
    const vec = await embedText(row.content);
    if (!vec) continue;                       // retried on the next run
    const { error: uErr } = await sb
      .from("knowledge_base")
      .update({ embedding: vec })
      .eq("id", row.id);
    if (uErr) log("embedding write failed:", uErr.message);
    else done++;
  }
  if (done) log(`embedded ${done} knowledge ${done === 1 ? "entry" : "entries"}`);
  return done;
}

/* ── 2. Appointment reminders ───────────────────────────────── */

function istDateString(daysAhead = 0): string {
  // Appointments are stored as local (IST) dates, so "tomorrow" must be
  // computed in IST rather than the container's UTC clock — otherwise
  // reminders fire a day early for part of every day.
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  now.setUTCDate(now.getUTCDate() + daysAhead);
  return now.toISOString().split("T")[0];
}

export async function runAppointmentReminders(): Promise<number> {
  const tomorrow = istDateString(1);
  const { data, error } = await sb
    .from("appointments")
    .select("id, tenant_id, voice_profile_id, caller_number, caller_name, service, slot_time")
    .eq("slot_date", tomorrow)
    .eq("status", "confirmed")
    .eq("wa_reminder_sent", false)
    .limit(200);
  if (error) { log("reminder fetch failed:", error.message); return 0; }
  if (!data?.length) return 0;

  let sent = 0;
  for (const a of data) {
    if (!a.caller_number) continue;
    // Business name comes from the tenant, not the appointment row.
    const { data: t } = await sb.from("tenants")
      .select("business_name").eq("id", a.tenant_id).maybeSingle();
    try {
      const r = await fetch(`${API_URL}/api/whatsapp/reminder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({
          caller_number:    a.caller_number,
          business_name:    t?.business_name || "your appointment",
          slot_time:        a.slot_time,
          service:          a.service,
          tenant_id:        a.tenant_id,
          voice_profile_id: a.voice_profile_id,
          appointment_id:   a.id,
        }),
      });
      if (r.ok) sent++;
      // The endpoint itself sets wa_reminder_sent, so a failure here simply
      // means it's retried on the next run rather than silently dropped.
    } catch (e) {
      log("reminder send failed:", e);
    }
  }
  if (sent) log(`sent ${sent} appointment reminder(s) for ${tomorrow}`);
  return sent;
}

/* ── 3. Daily summary to the business owner ─────────────────── */

export async function runDailySummaries(): Promise<number> {
  // Only fire in the evening IST — a summary at 6am describes nothing.
  const istHour = Number(
    new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 13)
  );
  if (istHour < 19 || istHour > 21) return 0;

  const today = istDateString(0);
  // Destination is the business's own WhatsApp number from their voice
  // profile — already collected at setup, so no extra field to fill in.
  const { data: profiles, error } = await sb
    .from("voice_profiles")
    .select("tenant_id, business_name, whatsapp_number, id")
    .not("whatsapp_number", "is", null);
  if (error) { log("profile fetch failed:", error.message); return 0; }
  if (!profiles?.length) return 0;

  let sent = 0;
  for (const p of profiles) {
    const t = { id: p.tenant_id, business_name: p.business_name,
                owner_phone: p.whatsapp_number, voice_profile_id: p.id };
    // Skip if today's summary already went out (idempotent across runs).
    const { data: already } = await sb.from("wa_dispatch_log")
      .select("id").eq("tenant_id", t.id).eq("message_type", "daily_summary")
      // sent_at: wa_dispatch_log has no created_at. The query 400d, so
      // `already` came back null and this idempotency guard FAILED OPEN —
      // once the evening window opened the daily summary would resend on
      // every 15-minute tick, roughly eight WhatsApps a night to the owner.
      .gte("sent_at", today + "T00:00:00").limit(1).maybeSingle();
    if (already) continue;

    const [calls, appts, leads] = await Promise.all([
      sb.from("calls").select("id, status")
        .eq("tenant_id", t.id).gte("created_at", today + "T00:00:00"),
      sb.from("appointments").select("id")
        .eq("tenant_id", t.id).gte("created_at", today + "T00:00:00"),
      sb.from("leads").select("id, name, phone, score")
        .eq("tenant_id", t.id).eq("stage", "new").gte("score", 50)
        .order("score", { ascending: false }).limit(3),
    ]);

    const callCount = calls.data?.length ?? 0;
    if (callCount === 0) continue;            // nothing happened; don't nag

    const apptCount = appts.data?.length ?? 0;
    const hot = leads.data ?? [];

    let msg = `📊 ఈరోజు ${t.business_name || "మీ business"} summary\n\n`;
    msg += `📞 ${callCount} calls answered\n`;
    if (apptCount) msg += `📅 ${apptCount} appointments booked\n`;
    if (hot.length) {
      msg += `\n🔥 Worth calling back:\n`;
      for (const l of hot) msg += `• ${l.name || "Unknown"} — ${l.phone}\n`;
    }
    msg += `\nపూర్తి details: https://heynikki.in/dashboard`;

    try {
      const r = await fetch(`${API_URL}/api/whatsapp/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({
          to: t.owner_phone,
          message: msg,
          tenant_id: t.id,
          voice_profile_id: t.voice_profile_id,
          message_type: "daily_summary",
        }),
      });
      if (r.ok) sent++;
    } catch (e) {
      log("summary send failed:", e);
    }
  }
  if (sent) log(`sent ${sent} daily summary/summaries`);
  return sent;
}

/* ── entry point ────────────────────────────────────────────── */


/* ── 4. Conversation intelligence ───────────────────────────── */
/**
 * Score completed calls on the transcript that is already stored.
 *
 * Every call keeps a {ts, role, content} array and until now nothing read
 * them back except a person opening one call at a time. This reviews all of
 * them and writes call_quality, so a supervisor can look at the worst ten
 * calls of the week instead of listening to two hundred.
 *
 * Only calls with a real conversation are scored. Most rows are a few
 * seconds long with an empty transcript — nobody spoke, so there is nothing
 * to judge, and scoring them would drag every average toward a number that
 * means nothing.
 *
 * Idempotent: a call already in call_quality is skipped, so this can run
 * every 15 minutes alongside the other jobs and only picks up new work.
 */
const QUALITY_BATCH   = 15;    // per run — keeps one tick well short of a minute
const MIN_TURNS       = 4;     // below this there is no conversation to score
const CHAT_MODEL      = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

type Turn = { role?: string; content?: string };

export async function runCallQuality(): Promise<number> {
  if (!GEMINI_KEY) { log("quality: GEMINI_API_KEY not set — skipping"); return 0; }

  // Left join in two steps: PostgREST cannot express "not exists" cheaply,
  // and the scored set stays small enough to filter in memory.
  const { data: scored } = await sb.from("call_quality").select("call_id").limit(5000);
  const done = new Set((scored || []).map((r: any) => r.call_id));

  const { data: calls, error } = await sb.from("calls")
    // Deliberately NOT filtered on status = 'completed'. Half the calls
    // holding a real conversation are still stored as 'missed' — historical
    // rows from the billsec fault that recorded every answered call as
    // missed with zero duration. A twenty-turn conversation is not a missed
    // call whatever the column says, and those rows are worth scoring most:
    // they are the ones nobody has ever looked at. The turn count below is
    // the honest test of whether there is anything to judge.
    .select("id, tenant_id, transcript, duration_seconds, intent")
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) { log("quality: call fetch failed:", error.message); return 0; }

  const todo = (calls || [])
    .filter((c: any) => !done.has(c.id))
    .filter((c: any) => Array.isArray(c.transcript) && c.transcript.length >= MIN_TURNS)
    .slice(0, QUALITY_BATCH);
  if (!todo.length) return 0;

  let n = 0;
  for (const call of todo) {
    const dialogue = (call.transcript as Turn[])
      .map(t => `${t.role === "assistant" ? "AGENT" : "CALLER"}: ${String(t.content || "").slice(0, 400)}`)
      .join("\n")
      .slice(0, 12000);   // a very long call must not blow the context window

    const prompt = [
      "You are a contact-centre quality analyst. Score this call.",
      "The AGENT is an AI receptionist for an Indian small business. Calls are",
      "in Telugu, Hindi or English, often mixed. Judge what was said, not the",
      "language it was said in.",
      "",
      "Return ONLY minified JSON with exactly these keys:",
      '{"overall_score":0-100,"resolution_score":0-100,"courtesy_score":0-100,',
      '"compliance_score":0-100,"sentiment":"positive|neutral|negative|mixed",',
      '"next_step_captured":true|false,"objections":[],"topics":[],',
      '"risk_flags":[],"summary":"","coaching":""}',
      "",
      "resolution: did the caller get what they rang for?",
      "courtesy: tone and patience.",
      "compliance: A FIXED TRAI AI-DISCLOSURE IS PLAYED AS PRE-RECORDED AUDIO",
      "  BEFORE THIS TRANSCRIPT BEGINS and is never transcribed, so the",
      "  transcript always opens with the caller. Do NOT mark the disclosure",
      "  missing merely because you cannot see it — it was made. Judge",
      "  compliance on what the agent SAYS: claiming to be a human, denying",
      "  being an AI, promising prices or outcomes it cannot, or pressuring",
      "  the caller.",
      "next_step_captured: did the call end with a booking, a callback, or",
      "  contact details taken? Not merely a polite goodbye.",
      "objections: sales objections the caller raised, short phrases.",
      "topics: what the caller actually wanted, for aggregation across calls.",
      "sentiment: EXACTLY one of positive, neutral, negative, mixed. Not any",
      "  other word — describe a frustrated caller as negative.",
      "risk_flags: anything a supervisor must see. Empty array if none.",
      "summary: two sentences maximum, in English.",
      "coaching: one specific thing the agent should do differently. Empty",
      "  string if the call was genuinely fine — do not invent faults.",
      "",
      `Call intent recorded at the time: ${call.intent || "unknown"}`,
      `Duration: ${call.duration_seconds || 0}s`,
      "",
      "TRANSCRIPT:",
      dialogue,
    ].join("\n");

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(30_000),
        });
      if (!r.ok) { log(`quality: gemini ${r.status} for ${call.id}`); continue; }
      const j: any = await r.json();
      const raw = j.candidates?.[0]?.content?.parts?.[0]?.text || "";
      // responseMimeType asks for JSON, but a refusal or a truncation still
      // arrives as prose. Pull the object out rather than trusting the shape.
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) { log(`quality: no JSON back for ${call.id}`); continue; }
      const d = JSON.parse(m[0]);

      const clamp = (v: any) => Math.max(0, Math.min(100, parseInt(v) || 0));
      const arr   = (v: any) => Array.isArray(v) ? v.map(String).slice(0, 12) : [];

      /**
       * The model describes feeling in its own words however firmly the enum
       * is stated — a real call came back "frustrated", which is not one of
       * the four allowed values. Mapping the unknown case to "neutral" would
       * have labelled the ANGRIEST calls as unremarkable, hiding exactly the
       * ones a supervisor needs, so synonyms are folded to the nearest
       * allowed value and only a genuinely unrecognised word falls back.
       * The column has a CHECK constraint, so an unmapped word would also
       * fail the insert outright.
       */
      const sentimentOf = (v: any): string => {
        const s = String(v || "").toLowerCase().trim();
        if (["positive", "neutral", "negative", "mixed"].includes(s)) return s;
        if (/frustrat|angry|upset|annoy|irritat|dissatisf|unhappy|rude|abusive/.test(s)) return "negative";
        if (/happy|pleased|satisfied|delight|grateful|warm/.test(s)) return "positive";
        if (/mixed|ambival|both/.test(s)) return "mixed";
        if (s) log(`quality: unmapped sentiment "${s}" — recorded as neutral`);
        return "neutral";
      };

      const { error: upErr } = await sb.from("call_quality").upsert({
        call_id:            call.id,
        tenant_id:          call.tenant_id,
        overall_score:      clamp(d.overall_score),
        resolution_score:   clamp(d.resolution_score),
        courtesy_score:     clamp(d.courtesy_score),
        compliance_score:   clamp(d.compliance_score),
        sentiment:          sentimentOf(d.sentiment),
        next_step_captured: !!d.next_step_captured,
        objections:         arr(d.objections),
        topics:             arr(d.topics),
        risk_flags:         arr(d.risk_flags),
        summary:            String(d.summary || "").slice(0, 600),
        coaching:           String(d.coaching || "").slice(0, 600),
        model:              CHAT_MODEL,
        analysed_at:        new Date().toISOString(),
      }, { onConflict: "call_id" });
      if (upErr) { log("quality: write failed:", upErr.message); continue; }
      n++;
    } catch (e: any) {
      log(`quality: ${call.id} failed:`, e.message);
    }
  }
  if (n) log(`scored ${n} call${n === 1 ? "" : "s"}`);
  return n;
}

export async function runScheduler() {
  log("run start");
  // Sequential on purpose: these are small jobs and running them one at a
  // time keeps log output readable and avoids hammering Gemini/Supabase.
  await runEmbedKnowledge();
  await runAppointmentReminders();
  await runDailySummaries();
  await runCallQuality();
  log("run complete");
}

if (require.main === module) {
  runScheduler()
    .then(() => process.exit(0))
    .catch(e => { console.error("[scheduler] fatal", e); process.exit(1); });
}
