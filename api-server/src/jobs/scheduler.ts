/**
 * Scheduler — the automation loop.
 *
 * Three jobs that all needed a periodic runner, so they share one rather
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
      .gte("created_at", today + "T00:00:00").limit(1).maybeSingle();
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

export async function runScheduler() {
  log("run start");
  // Sequential on purpose: these are small jobs and running them one at a
  // time keeps log output readable and avoids hammering Gemini/Supabase.
  await runEmbedKnowledge();
  await runAppointmentReminders();
  await runDailySummaries();
  log("run complete");
}

if (require.main === module) {
  runScheduler()
    .then(() => process.exit(0))
    .catch(e => { console.error("[scheduler] fatal", e); process.exit(1); });
}
