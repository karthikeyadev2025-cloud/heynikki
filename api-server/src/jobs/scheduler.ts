/**
 * Scheduler — the automation loop.
 *
 * Five jobs that all needed a periodic runner, so they share one rather
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
 * 3b. MORNING BRIEFING — the evening summary arrives after the shop has shut,
 *     when nothing in it can be acted on. This sends the same facts at 08:30
 *     IST, when they are still a to-do list: yesterday's answered and missed
 *     calls, today's diary, who is worth ringing back, minutes left.
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
import os from "os";
import { createClient } from "@supabase/supabase-js";
import { runOnboardingEmails } from "./onboarding-emails";
import { runOnboarding } from "./onboarding";
import { resolveGeminiModel } from "../gemini.js";
import { purgeRecordings, RECORDING_COLUMNS_CLEARED } from "../recordings";
import { sendOwnerEmail, sendOwnerTemplate, templateApproved } from "../owner-alerts";
import { minutesGate } from "../usage";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const GEMINI_KEY    = process.env.GEMINI_API_KEY || "";
const API_URL       = process.env.API_URL || "http://localhost:4000";
import { INTERNAL_SECRET } from "../internal-secret";

// Must match voice-pipeline/app/knowledge.py — a mismatch here means
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

function istMinutesNow(): number {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function slotMinutes(t: string | null): number | null {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}

// Two reminders, each sent once per appointment (wa_reminder_sent):
//
//  * the evening before, 17:00–21:00 IST. This used to fire on the first
//    15-minute tick after midnight IST — "your appointment is tomorrow" at
//    00:07 is a wake-up, not a reminder.
//  * the same day, 90–180 minutes before the slot, for anything the evening
//    pass could not cover: booked after 21:00 for the next morning, or booked
//    the same day (today's 20:30 was booked at 15:12 and would never have
//    been reminded at all).
const REMINDER_MAX_TRIES = 3;

export async function runAppointmentReminders(): Promise<number> {
  const nowMin = istMinutesNow();
  const evening = nowMin >= 17 * 60 && nowMin < 21 * 60;
  const [{ data: tomorrowRows, error: e1 }, { data: todayRows, error: e2 }] = await Promise.all([
    evening
      ? sb.from("appointments")
          .select("id, tenant_id, voice_profile_id, caller_number, caller_name, service, slot_time, slot_date")
          .eq("slot_date", istDateString(1)).eq("status", "confirmed")
          .eq("wa_reminder_sent", false).limit(200)
      : Promise.resolve({ data: [] as any[], error: null }),
    sb.from("appointments")
      .select("id, tenant_id, voice_profile_id, caller_number, caller_name, service, slot_time, slot_date")
      .eq("slot_date", istDateString(0)).eq("status", "confirmed")
      .eq("wa_reminder_sent", false).limit(200),
  ]);
  if (e1) { log("reminder fetch failed:", e1.message); return 0; }
  if (e2) { log("reminder fetch failed:", e2.message); return 0; }

  const due = [
    ...(tomorrowRows || []).map(a => ({ ...a, when: "tomorrow" as const })),
    ...(todayRows || []).filter(a => {
      const sm = slotMinutes(a.slot_time);
      // Not before 07:00 IST: a 07:30 slot otherwise got its WhatsApp at
      // 04:30–06:00. An early slot booked the evening before was already
      // covered by the evening pass.
      return sm !== null && nowMin >= 7 * 60 && sm - nowMin >= 90 && sm - nowMin <= 180;
    }).map(a => ({ ...a, when: "today" as const })),
  ];
  if (!due.length) return 0;

  let sent = 0;
  for (const a of due) {
    if (!a.caller_number) continue;

    // wa_reminder_sent is set by the API AFTER the WhatsApp goes out, so when
    // that write fails the appointment still reads "not reminded" and every
    // 15-minute run sends the same reminder again — all evening, or for the
    // whole three-hour same-day band. wa_dispatch_log records every attempt
    // against the appointment whatever happened to the flag, so it is the
    // record this job trusts: anything that went out means done, and a
    // reminder Meta refused three times is not tried a fourth. Fails CLOSED
    // on a read error — a missed reminder is better than a repeated one.
    const { data: prior, error: priorErr } = await sb.from("wa_dispatch_log")
      .select("status").eq("appointment_id", a.id)
      .in("message_type", ["reminder", "reminder_today"]);
    if (priorErr) { log(`reminder history lookup failed for ${a.id} — not sending:`, priorErr.message); continue; }
    if ((prior || []).some((p: any) => p.status !== "failed")) {
      const { error: flagErr } = await sb.from("appointments")
        .update({ wa_reminder_sent: true }).eq("id", a.id).eq("wa_reminder_sent", false);
      log(`appointment ${a.id} was already reminded but not flagged` +
        (flagErr ? ` (flag write failed again: ${flagErr.message})` : " — flag set, not resending"));
      continue;
    }
    if ((prior || []).length >= REMINDER_MAX_TRIES) continue;

    // tenants has no business_name column — this select failed on every
    // reminder and the error was discarded, so every customer was told
    // about "your appointment" with no idea whose. The name a caller
    // actually knows the business by is on the voice profile; tenants.name
    // is the fallback.
    const [{ data: vp }, { data: t }] = await Promise.all([
      sb.from("voice_profiles").select("business_name")
        .eq("tenant_id", a.tenant_id).limit(1).maybeSingle(),
      sb.from("tenants").select("name").eq("id", a.tenant_id).maybeSingle(),
    ]);
    const businessName = vp?.business_name || t?.name || "";
    try {
      const r = await fetch(`${API_URL}/api/whatsapp/reminder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({
          caller_number:    a.caller_number,
          business_name:    businessName || "your appointment",
          slot_time:        a.slot_time,
          service:          a.service,
          tenant_id:        a.tenant_id,
          voice_profile_id: a.voice_profile_id,
          appointment_id:   a.id,
          when:             a.when,
        }),
      });
      // The endpoint answers 200 with {ok:false} when Meta refused, so the
      // status alone over-counted. A failure is retried next run, up to
      // REMINDER_MAX_TRIES logged attempts (see above).
      const j: any = await r.json().catch(() => ({}));
      if (r.ok && j.ok !== false) sent++;
      else log(`reminder for ${a.id} not sent (HTTP ${r.status})`);
    } catch (e) {
      log("reminder send failed:", e);
    }
  }
  if (sent) log(`sent ${sent} appointment reminder(s)`);
  return sent;
}

/* ── Incomplete bookings ────────────────────────────────────── */

/**
 * Someone who started booking an appointment and never got a slot.
 *
 * Nikki opens an appointments row the moment a caller asks to book, and
 * fills slot_date/slot_time when they agree one. A call that ends before
 * that leaves a 'pending' row with no time on it — and nothing in this
 * system has ever looked at those rows again. They are not failed calls in
 * any log; they are people who rang a clinic to book and then never heard
 * from anyone.
 *
 * Two hours is the abandonment line: long enough that the call is
 * definitively over and they are not mid-conversation, short enough to
 * still reach them the same day.
 *
 * One follow-up per NUMBER per day, not per row. Six abandoned rows from
 * one person is one person who had a bad time, not six people to message —
 * and six identical "we could not finish your booking" messages is the
 * harassment pattern the campaign retry rules already exist to prevent.
 */
const INCOMPLETE_AFTER_MS   = 2 * 3600 * 1000;
// Anything older than this is history, not a lead. Without the floor the
// first run of this job would wake up every abandoned booking ever taken.
const INCOMPLETE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export async function runIncompleteBookings(): Promise<number> {
  // Daytime only: the WhatsApp goes out the moment this runs and the
  // callback it queues dials as soon as the dispatcher's window allows.
  // Neither belongs at 00:15 IST, which is when a 2-hour-old booking from a
  // late-evening call used to come due.
  const istHour = Number(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 13));
  if (istHour < 9 || istHour >= 20) return 0;
  const now = Date.now();
  const { data, error } = await sb
    .from("appointments")
    .select("id, tenant_id, voice_profile_id, call_id, caller_number, caller_name, service, created_at")
    .eq("status", "pending")
    .is("slot_time", null)
    .lt("created_at", new Date(now - INCOMPLETE_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - INCOMPLETE_MAX_AGE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { log("incomplete-booking fetch failed:", error.message); return 0; }
  if (!data?.length) return 0;

  // Newest row per number — the ordering above means the first one seen is
  // the most recent attempt, which is the one worth referring to.
  const byNumber = new Map<string, any>();
  for (const a of data) {
    if (!a.caller_number) continue;
    if (!byNumber.has(a.caller_number)) byNumber.set(a.caller_number, a);
  }

  const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
  let sent = 0;

  for (const a of byNumber.values()) {
    // One chase per abandoned booking, ever. The per-day guard below only
    // holds for 24 h, so a row that sat pending re-queued a callback every
    // night until it aged out — the same person was rung at 00:01 and again
    // at 00:15 the next night about a booking from five days earlier.
    //
    // Per NUMBER as well as per row: one caller routinely leaves several
    // pending rows (six from one number on 25 Aug), and each new row used to
    // earn its own chase. One callback per person per 30 days, whichever row.
    //
    // Both lookups fail CLOSED. `chased` coming back null on a query error
    // read as "never chased" — a guard that fails open here dials a stranger.
    const { data: chased, error: chasedErr } = await sb.from("outbound_recipients")
      .select("id").eq("tenant_id", a.tenant_id).eq("is_instant", true)
      .or(`metadata->>appointment_id.eq.${a.id},` +
          `and(phone.eq."${a.caller_number}",created_at.gt.${new Date(now - 30 * 24 * 3600 * 1000).toISOString()})`)
      .limit(1);
    if (chasedErr) { log("incomplete-booking chase lookup failed:", chasedErr.message); continue; }
    if (chased?.length) continue;

    // Asked not to be called: no WhatsApp chase and no callback either.
    const digits = String(a.caller_number).replace(/\D/g, "").slice(-10);
    const { data: optedOut, error: optErr } = await sb.from("outbound_opt_outs")
      .select("id").eq("tenant_id", a.tenant_id)
      .in("phone", [digits, `91${digits}`, `+91${digits}`]).limit(1);
    if (optErr) { log("incomplete-booking opt-out lookup failed:", optErr.message); continue; }
    if (optedOut?.length) continue;

    // Already chased this number today?
    const { data: recent, error: recentErr } = await sb.from("wa_dispatch_log")
      .select("id")
      .eq("to_number", a.caller_number)
      .eq("message_type", "booking_incomplete")
      .gt("sent_at", dayAgo)
      .limit(1);
    if (recentErr || recent?.length) continue;

    // Did they get through in the end? An abandoned row is not evidence of
    // an unserved caller if the same person has a booking on the books —
    // they rang back, or Nikki opened a second row and finished that one.
    // Telling someone who is booked for this afternoon that we could not
    // confirm their date is worse than saying nothing at all.
    const { data: booked, error: bookedErr } = await sb.from("appointments")
      .select("id")
      .eq("caller_number", a.caller_number)
      .eq("tenant_id", a.tenant_id)
      .eq("status", "confirmed")
      .gte("slot_date", istDateString(0))
      .limit(1);
    if (bookedErr || booked?.length) continue;

    const [{ data: vp }, { data: t }] = await Promise.all([
      sb.from("voice_profiles").select("business_name")
        .eq("tenant_id", a.tenant_id).limit(1).maybeSingle(),
      sb.from("tenants").select("name").eq("id", a.tenant_id).maybeSingle(),
    ]);
    const businessName = vp?.business_name || t?.name || "";
    // Same rule as the campaign follow-up: without a business identity there
    // is no honest message to send.
    if (!businessName) continue;

    try {
      const r = await fetch(`${API_URL}/api/whatsapp/booking-incomplete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({
          caller_number:    a.caller_number,
          caller_name:      a.caller_name,
          business_name:    businessName,
          service:          a.service,
          tenant_id:        a.tenant_id,
          voice_profile_id: a.voice_profile_id,
          appointment_id:   a.id,
          call_id:          a.call_id,
        }),
      });
      if (!r.ok) continue;
      sent++;
    } catch (e) {
      log("incomplete-booking WhatsApp failed:", e);
      continue;
    }

    // And queue the callback. It sits harmlessly in the queue while the
    // trunk is down and dials the moment outbound works.
    //
    // consent_call_id is the point: this number is not a marketing target,
    // it is someone who phoned this business and asked for an appointment,
    // and the recording of that call is the consent record. The dispatcher
    // reads it as consent so the callback is not blocked as unscrubbed.
    const { data: already, error: alreadyErr } = await sb.from("outbound_recipients")
      .select("id").eq("tenant_id", a.tenant_id)
      .eq("phone", a.caller_number).eq("is_instant", true)
      .in("status", ["pending", "scrubbing", "queued", "in_progress"])
      .limit(1);
    if (alreadyErr || already?.length) continue;

    const { error: insErr } = await sb.from("outbound_recipients").insert({
      tenant_id:       a.tenant_id,
      campaign_id:     null,
      is_instant:      true,
      phone:           a.caller_number,
      first_name:      a.caller_name,
      status:          "pending",
      consent_call_id: a.call_id || null,
      metadata:        { source: "incomplete_booking", appointment_id: a.id,
                         voice_profile_id: a.voice_profile_id },
    });
    if (insErr) log("incomplete-booking callback queue failed:", insErr.message);
  }

  if (sent) log(`chased ${sent} incomplete booking(s)`);
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
  // IST midnight, with the offset spelled out. A bare "T00:00:00" is read as
  // UTC — 05:30 IST — so "today's" calls silently left out everything
  // between midnight and half past five.
  const dayStart = `${today}T00:00:00+05:30`;
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
    const { data: already, error: alreadyErr } = await sb.from("wa_dispatch_log")
      .select("id").eq("tenant_id", t.id).eq("message_type", "daily_summary")
      // sent_at: wa_dispatch_log has no created_at. The query 400d, so
      // `already` came back null and this idempotency guard FAILED OPEN —
      // once the evening window opened the daily summary would resend on
      // every 15-minute tick, roughly eight WhatsApps a night to the owner.
      // Any other read error did exactly the same, so it now skips instead.
      .gte("sent_at", dayStart).limit(1);
    if (alreadyErr) { log(`summary history lookup failed for ${t.id} — not sending:`, alreadyErr.message); continue; }
    if (already?.length) continue;

    const [calls, appts, leads] = await Promise.all([
      sb.from("calls").select("id, status")
        .eq("tenant_id", t.id).gte("created_at", dayStart),
      sb.from("appointments").select("id")
        .eq("tenant_id", t.id).gte("created_at", dayStart),
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

/* ── 3b. Morning briefing to the business owner ─────────────── */
/**
 * The other half of the day.
 *
 * runDailySummaries above sends an EVENING message about the day that just
 * happened — useful, but it arrives after the shop is shut, when nothing in
 * it can be acted on. The three things an owner can still do something about
 * are all morning things: ring back the people who did not get through
 * yesterday, know who is walking in today, and see the minutes running out
 * before the day's calls stop being answered.
 *
 * Deliberately NOT the evening summary moved earlier. It carries YESTERDAY's
 * outcome and TODAY's diary, which is what the approved
 * `daily_business_summary` template was written for — its fixed text opens
 * "నిన్నటి summary" (yesterday's summary), so the evening job has always been
 * sending it a day out of step with its own wording.
 *
 * Channel: the approved template to the business's WhatsApp number, exactly
 * as the evening summary does. A scheduled message is by definition outside
 * Meta's 24-hour service window, so free text is accepted and then dropped —
 * a template is the only form that arrives. A tenant with no WhatsApp number
 * gets an email instead, which is also where the fuller version lives: the
 * template has four slots and cannot carry named leads or a minutes balance.
 *
 * One per tenant per IST day, idempotent across the 15-minute ticks, and
 * silent for a business that had no calls yesterday and nothing booked
 * today — a message that says "nothing happened" every morning is the
 * reason people mute a number.
 */
const BRIEFING_FROM_MIN = 8 * 60 + 30;   // 08:30 IST
const BRIEFING_TO_MIN   = 9 * 60 + 30;   // …to 09:30, so one missed tick is not a missed day

/** Both message types are markers for the SAME once-a-day briefing. They are
 *  separate only so the dispatch row is honest about which channel it went
 *  out on; the guard below reads both. */
const BRIEFING_TYPES = ["morning_briefing", "morning_briefing_email"];

export async function runMorningBriefings(): Promise<number> {
  const nowMin = istMinutesNow();
  if (nowMin < BRIEFING_FROM_MIN || nowMin >= BRIEFING_TO_MIN) return 0;

  // An off switch that does not need a deploy. This job puts a message on a
  // paying customer's phone every morning; if the wording is wrong, or Meta
  // flags the template, or an owner simply asks to stop, somebody needs to be
  // able to stop it from the Platform Config screen at the time it is going
  // wrong. Default ON — set platform_config.morning_briefing to "off".
  const { data: toggle, error: toggleErr } = await sb.from("platform_config")
    .select("value").eq("key", "morning_briefing").maybeSingle();
  if (toggleErr) { log("briefing: config read failed — not sending:", toggleErr.message); return 0; }
  if (String(toggle?.value ?? "on").trim().toLowerCase() === "off") return 0;

  const today     = istDateString(0);
  const yesterday = istDateString(-1);
  // Offsets spelled out. A bare "T00:00:00" is parsed as UTC — 05:30 IST — so
  // every window would start and end five and a half hours late and
  // "yesterday" would include this morning's calls.
  const dayStart = `${today}T00:00:00+05:30`;
  const yStart   = `${yesterday}T00:00:00+05:30`;

  // Demo rows and suspended accounts are not businesses to brief.
  const { data: tenants, error } = await sb.from("tenants")
    .select("id, name, owner_id, is_demo, status")
    .neq("status", "suspended");
  if (error) { log("briefing: tenant read failed:", error.message); return 0; }
  if (!tenants?.length) return 0;

  let sent = 0;
  for (const t of tenants) {
    if (t.is_demo) continue;

    // Fails CLOSED. A read error that read as "not sent yet" would put a
    // briefing on the owner's phone on every tick for a whole hour.
    const { data: already, error: alreadyErr } = await sb.from("wa_dispatch_log")
      .select("id").eq("tenant_id", t.id).in("message_type", BRIEFING_TYPES)
      // sent_at — wa_dispatch_log has no created_at column.
      .gte("sent_at", dayStart).limit(1);
    if (alreadyErr) { log(`briefing: history lookup failed for ${t.id} — not sending:`, alreadyErr.message); continue; }
    if (already?.length) continue;

    const [profileRes, callsRes, apptsRes, leadsRes] = await Promise.all([
      sb.from("voice_profiles").select("id, business_name, whatsapp_number")
        .eq("tenant_id", t.id).limit(1).maybeSingle(),
      sb.from("calls").select("id, status")
        .eq("tenant_id", t.id).gte("created_at", yStart).lt("created_at", dayStart),
      // The diary for the day ahead, by the business-local slot date — not by
      // when the booking was taken.
      sb.from("appointments").select("id")
        .eq("tenant_id", t.id).eq("slot_date", today).in("status", ["pending", "confirmed"]),
      // The same worklist the dashboard shows: warm and not yet closed.
      sb.from("leads").select("id, name, phone, score")
        .eq("tenant_id", t.id).not("stage", "in", '("won","lost")').gte("score", 50)
        .order("score", { ascending: false }).limit(5),
    ]);

    // Fail CLOSED on every count. A briefing built on a failed query is a
    // briefing that tells an owner they had no calls yesterday when they had
    // forty — worse than no briefing at all, because they will believe it.
    if (callsRes.error || apptsRes.error || leadsRes.error) {
      log(`briefing: data read failed for ${t.id} — not sending:`,
          callsRes.error?.message || apptsRes.error?.message || leadsRes.error?.message);
      continue;
    }

    const calls    = callsRes.data || [];
    const missed   = calls.filter((c: any) => c.status === "missed").length;
    const answered = calls.length - missed;
    const booked   = apptsRes.data?.length ?? 0;
    const hot      = leadsRes.data ?? [];

    // Nothing happened yesterday and nothing is booked today: say nothing.
    //
    // Deliberately NOT triggered by the lead list. Leads sit in "worth calling
    // back" until somebody changes their stage, so a shop with two stale leads
    // and no calls would get an identical email every morning forever — which
    // is the behaviour that gets a sender muted. Leads are content when there
    // is already a reason to write; they are never the reason.
    if (calls.length === 0 && booked === 0) continue;

    const profile  = profileRes.data as any;
    const business = (profile?.business_name || t.name || "your business").trim();
    const gate     = await minutesGate(sb, t.id);
    const minsLeft = gate.paid
      ? Math.max(0, gate.limitMinutes - gate.usedMinutes)
      : Math.round(gate.credits);
    const minsLine = gate.paid && gate.limitMinutes <= 0
      ? ""                                    // no published allowance: no honest number to quote
      : `${minsLeft} minute${minsLeft === 1 ? "" : "s"} left ${gate.paid ? "this month" : "on your free credit"}`;

    // The three template slots, phrased so each value still reads correctly
    // under the template's own fixed labels (Calls / Appointments / New leads)
    // and stays inside Meta's 60-character parameter cap.
    const callsParam = calls.length === 0 ? "none yesterday"
      : missed ? `${answered} answered · ${missed} missed` : `${answered} answered`;
    const apptParam  = booked ? `${booked} today` : "none today";
    const leadParam  = hot.length ? `${hot.length} worth calling back` : "none waiting";

    const body =
      `Yesterday: ${callsParam}. Appointments today: ${apptParam}. ` +
      `Leads: ${leadParam}.${minsLine ? ` ${minsLine}.` : ""}`;

    if (profile?.whatsapp_number) {
      const ok = await sendOwnerTemplate(sb, {
        to:              profile.whatsapp_number,
        tenantId:        t.id,
        voiceProfileId:  profile.id || null,
        messageType:     "morning_briefing",
        // The UTILITY replacement the moment Meta approves it; the MARKETING
        // one until then. Same four parameters, so nothing else changes.
        template:        await templateApproved("daily_account_update")
                           ? "daily_account_update" : "daily_business_summary",
        lang:            "te",
        params:          [business, callsParam, apptParam, leadParam],
        logBody:         body,
      });
      if (ok) sent++;
      continue;   // sendOwnerTemplate has already written the marker row
    }

    // No WhatsApp number on the profile — email the owner instead. This is
    // also the only version that can carry the names and numbers to ring and
    // the minutes balance; four template slots cannot.
    const email = await ownerEmail(t.owner_id);
    if (!email) continue;                     // no destination at all
    const rows = hot.map(l => `<li>${escapeHtml(l.name || "Unknown caller")} — ${escapeHtml(l.phone || "")}</li>`).join("");
    const html =
      // The caller-facing name, the same one in the subject — tenants.name is
      // the internal label ("sai clinic ", trailing space and all).
      `<p>Good morning, ${escapeHtml(business)}.</p>` +
      `<p><strong>Yesterday:</strong> ${escapeHtml(callsParam)}.<br>` +
      `<strong>Booked in for today:</strong> ${escapeHtml(apptParam)}.</p>` +
      (hot.length ? `<p><strong>Worth calling back:</strong></p><ul>${rows}</ul>` : "") +
      (minsLine ? `<p>${escapeHtml(minsLine)}.</p>` : "") +
      `<p><a href="https://heynikki.in/dashboard">Open your dashboard</a></p>`;
    const ok = await sendOwnerEmail(email, `${business} — this morning's briefing`, html);

    // Same marker the WhatsApp path leaves, so tomorrow's run can tell
    // "already briefed" from "never tried" whichever channel was used.
    const { error: logErr } = await sb.from("wa_dispatch_log").insert({
      tenant_id: t.id, voice_profile_id: profile?.id || null,
      message_type: "morning_briefing_email", to_number: email,
      message_body: body, status: ok ? "sent" : "failed",
    });
    if (logErr) log("briefing: marker write failed:", logErr.message);
    if (ok) sent++;
  }

  if (sent) log(`sent ${sent} morning briefing${sent === 1 ? "" : "s"}`);
  return sent;
}

/** The owner's login email. Lives in auth, not in tenants. */
async function ownerEmail(ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  try {
    const { data } = await sb.auth.admin.getUserById(ownerId);
    return data?.user?.email || null;
  } catch (e: any) {
    log("briefing: owner email lookup failed:", e?.message || e);
    return null;
  }
}

/** Lead names come from call transcripts, so they are arbitrary text going
 *  into an HTML email. Escaped rather than trusted. */
function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
const CHAT_MODEL      = resolveGeminiModel();

type Turn = { role?: string; content?: string };

export async function runCallQuality(): Promise<number> {
  if (!GEMINI_KEY) { log("quality: GEMINI_API_KEY not set — skipping"); return 0; }

  // Left join in two steps: PostgREST cannot express "not exists" cheaply,
  // and the scored set stays small enough to filter in memory.
  const { data: scored, error: scoredErr } = await sb.from("call_quality").select("call_id").limit(5000);
  // Unreadable means "everything is unscored" to the filter below, which
  // re-sent already-scored calls to Gemini — paid for twice.
  if (scoredErr) { log("quality: scored-set fetch failed:", scoredErr.message); return 0; }
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
    // OLDEST first. Newest-first takes the same 200 recent calls every run
    // and filters the already-scored ones out AFTERWARDS, so once the recent
    // window is scored the job does nothing while an older unscored call
    // waits behind it forever — and /quality tells customers "every call is
    // scored, not a sample". Oldest-first drains the backlog instead.
    .order("created_at", { ascending: true })
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


/* ── 5. Close abandoned calls ───────────────────────────────── */
/**
 * A call row is created with status 'active' when the caller connects and
 * moved to completed/missed by the hangup webhook. If that webhook never
 * arrives — the channel died abnormally, the container restarted mid-call,
 * the pipeline crashed — the row stays 'active' forever.
 *
 * Four such rows have been sitting there for eighty hours, and the
 * super-admin dashboard counts exactly that column: it reported LIVE CALLS
 * NOW 4 while FreeSWITCH held zero channels. A dashboard that is confidently
 * wrong is worse than one that is empty, because nobody thinks to check it.
 *
 * Two hours is far longer than any real call — the dialplan caps a leg at
 * 120 seconds — so anything still 'active' past that was abandoned, not
 * ongoing.
 */
const ABANDON_AFTER_MS = 2 * 3600 * 1000;

export async function runCloseAbandonedCalls(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  const { data, error } = await sb.from("calls")
    .select("id")
    .eq("status", "active")
    .lt("created_at", cutoff)
    .limit(500);
  if (error) { log("abandoned-call sweep failed:", error.message); return 0; }
  if (!data?.length) return 0;

  // 'missed' rather than 'completed': nothing is known about how the call
  // ended, and recording it as completed would inflate the answered figures
  // the business is billed and judged on.
  const { error: upErr } = await sb.from("calls")
    .update({ status: "missed", updated_at: new Date().toISOString() })
    .in("id", data.map((c: any) => c.id));
  if (upErr) { log("abandoned-call update failed:", upErr.message); return 0; }

  log(`closed ${data.length} abandoned call${data.length === 1 ? "" : "s"}`);
  return data.length;
}

export async function runScheduler() {
  if (!await acquireSchedulerLease()) return;
  log("run start");
  // Sequential on purpose: these are small jobs and running them one at a
  // time keeps log output readable and avoids hammering Gemini/Supabase.
  await runEmbedKnowledge();
  await runAppointmentReminders();
  await runIncompleteBookings();
  // Morning first, evening second — each is a no-op outside its own IST
  // window, so the order only decides which one is checked first.
  await runMorningBriefings();
  await runDailySummaries();
  await runCallQuality();
  await runCloseAbandonedCalls();

  // Onboarding messages from HeyNikki itself. Send-once is enforced by a
  // unique index, so running this every cycle is safe.
  try { await runOnboarding(); }
  catch (e: any) { console.error("[scheduler] onboarding failed:", e.message); }

  // Recording retention. Each tenant's plan says how long recordings are
  // kept; past that they are deleted from R2 and the call row forgets the
  // key. Deliberately runs AFTER everything else, capped at 200 per cycle —
  // a purge that can never run away is worth more than one that finishes
  // a backlog in one pass.
  try { await runRetentionPurge(); }
  catch (e: any) { console.error("[scheduler] retention failed:", e.message); }

  // Demo expiry: a stamped demo_expires_at becomes a suspension. Demos are
  // disposable by construction now — the alternative was the two "Hey
  // Nikki" demo rows that sat as ordinary tenants for two months.
  // The onboarding EMAIL sequence was written, made idempotent via
  // onboarding_emails_sent, and then never called by anything — no signup
  // has ever received one. It is idempotent, so a per-cycle call is safe;
  // it no-ops without a Resend key rather than throwing every fifteen
  // minutes for a service that may never be configured.
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await runOnboardingEmails();
      if (r.sent) console.log(`[scheduler] onboarding emails sent=${r.sent} errors=${r.errors}`);
    } catch (e: any) { console.error("[scheduler] onboarding emails:", e.message); }
  }

  try { await runExpireDemos(); }
  catch (e: any) { console.error("[scheduler] demo expiry failed:", e.message); }

  try { await runPlanExpiry(); }
  catch (e: any) { console.error("[scheduler] plan expiry failed:", e.message); }

  try { await runWhatsAppRegistrations(); }
  catch (e: any) { console.error("[scheduler] whatsapp registration sweep failed:", e.message); }
  log("run complete");
}

/* ── WhatsApp registration sweep ────────────────────────────── */
/**
 * Every business whose HeyNikki number should be on WhatsApp and is not.
 *
 * The product sells one number for calls and WhatsApp, but getting there was
 * four manual steps in order, with Meta's code copied by hand out of a call
 * transcript inside its expiry window. Predictably nobody finished it: the
 * only tenant who started has sat in pending_verification since 2 September.
 *
 * The API decides whether a tenant is eligible and what to do (see
 * startWhatsAppRegistration); this only finds candidates and asks. Daytime
 * only, because asking for a code makes Meta RING the number, and a business
 * whose phone is answered by Nikki still has staff who see the call.
 *
 * Deliberately gentle: at most a handful a run, and a tenant whose code was
 * requested in the last ten minutes is left alone by the API itself.
 */
const WA_SWEEP_FROM_MIN = 9 * 60 + 30;   // 09:30 IST
const WA_SWEEP_TO_MIN   = 19 * 60;       // 19:00 IST
const WA_SWEEP_MAX      = 5;

export async function runWhatsAppRegistrations(): Promise<number> {
  const nowMin = istMinutesNow();
  if (nowMin < WA_SWEEP_FROM_MIN || nowMin >= WA_SWEEP_TO_MIN) return 0;

  // Candidates: a registration row that never finished. 'active' is done,
  // and a row Meta rejected outright carries its reason for a human.
  const { data: rows, error } = await sb.from("tenant_whatsapp")
    .select("tenant_id, status, updated_at")
    .in("status", ["awaiting_signup", "pending_verification"])
    .order("updated_at", { ascending: true })
    .limit(WA_SWEEP_MAX);
  if (error) { log("whatsapp sweep: read failed:", error.message); return 0; }
  if (!rows?.length) return 0;

  let started = 0;
  for (const r of rows) {
    try {
      const resp = await fetch(`${API_URL}/webhooks/whatsapp/auto-sweep`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
        body: JSON.stringify({ tenant_id: r.tenant_id }),
      });
      const j = await resp.json().catch(() => ({})) as any;
      if (j?.started) { started++; log(`whatsapp: started for tenant ${r.tenant_id} — ${j.detail}`); }
    } catch (e: any) {
      log("whatsapp sweep: request failed:", e?.message || e);
    }
  }
  return started;
}

/* ── Recording retention purge ──────────────────────────────── */
async function runRetentionPurge(): Promise<void> {
  // recording_days per plan; anything unrecognised keeps the tightest
  // default. A retention bug must err toward keeping less, not more —
  // these are recordings of real people's calls.
  // An unreadable plans table used to mean "every plan keeps 30 days", and
  // the purge went ahead — deleting recordings a Scale tenant pays to keep
  // for longer. Deletion is the one thing here that cannot be retried, so a
  // failed read stops it.
  const { data: plans, error: plansErr } = await sb.from("plans").select("id, recording_days");
  if (plansErr || !plans?.length) {
    console.error(`[retention] plans unreadable — not purging: ${plansErr?.message || "no rows"}`);
    return;
  }
  const daysOf = new Map((plans || []).map((p: any) => [String(p.id), p.recording_days || 30]));

  const { data: tenants, error: tenantsErr } = await sb.from("tenants").select("id, plan");
  if (tenantsErr) { console.error("[retention] tenant read failed:", tenantsErr.message); return; }
  let purged = 0;
  for (const t of tenants || []) {
    const days = daysOf.get(String(t.plan)) ?? 30;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const { data: calls } = await sb.from("calls")
      .select("id, r2_object_key")
      .eq("tenant_id", t.id).not("r2_object_key", "is", null)
      .lt("created_at", cutoff).limit(200 - purged);
    if (!calls?.length) continue;

    const keys = calls.map((c: any) => c.r2_object_key).filter(Boolean);
    const r = await purgeRecordings(keys);
    if (!r.ok) {
      console.error(`[retention] purge call failed: ${r.status ?? "unreachable"}`);
      continue;   // keys stay on the rows; retried next cycle
    }
    // Only forget keys AFTER R2 confirmed. A row that forgets its key
    // while the object survives is an orphan nobody can ever delete.
    await sb.from("calls")
      .update(RECORDING_COLUMNS_CLEARED)
      .in("id", calls.map((c: any) => c.id));
    purged += calls.length;
    if (purged >= 200) break;
  }
  if (purged) console.log(`[scheduler] retention: purged ${purged} recordings`);
}

/* ── Demo tenant expiry ─────────────────────────────────────── */
async function runExpireDemos(): Promise<void> {
  const { data, error } = await sb.from("tenants")
    .update({ status: "suspended" })
    .eq("is_demo", true).eq("status", "trial")
    .lt("demo_expires_at", new Date().toISOString())
    .select("id, name");
  if (error) { console.error("[demos]", error.message); return; }
  for (const t of data || []) {
    console.log(`[scheduler] demo expired: ${t.name}`);
  }
}

/* ── Single-instance lease ──────────────────────────────────── */
/**
 * docker-compose.yml is shared with the EC2 host, and the scheduler had no
 * profile, so a plain `docker compose up -d` there started a SECOND
 * scheduler against the same database. Every job here is "check a flag,
 * then send": two copies read the same unsent flag in the same minute and
 * both send — the reminder, the incomplete-booking chase and the callback
 * it queues all go out twice.
 *
 * The profile in docker-compose.yml stops that from happening by accident;
 * this stops it happening at all. A lease row in platform_config (no
 * migration: key/value/updated_at already exist) names the host that runs
 * the jobs. The holder renews it at the start of every run; anyone else
 * skips while it is unexpired. Taking it over is a compare-and-set on the
 * exact value that was read, so two hosts racing for an expired lease cannot
 * both win.
 *
 * The holder is the HOST, not the process: each run is a fresh node process,
 * and a per-process holder released at the end of each run would let a
 * second host whose 15-minute cycle is offset by seven minutes run in every
 * gap. The TTL is longer than one cycle plus a slow run, so the owning host
 * keeps it; a host that stops running hands over after 30 minutes.
 *
 * Any read or write error skips the run. A missed cycle is retried in 15
 * minutes; a doubled one has already messaged people.
 */
const LEASE_KEY    = "scheduler_lease";
const LEASE_TTL_MS = 30 * 60_000;

async function acquireSchedulerLease(): Promise<boolean> {
  const holder = process.env.SCHEDULER_INSTANCE || os.hostname();
  const now    = Date.now();
  const stamp  = new Date(now).toISOString();
  const value  = JSON.stringify({ holder, expires_at: new Date(now + LEASE_TTL_MS).toISOString() });

  const { error: insErr } = await sb.from("platform_config")
    .insert({ key: LEASE_KEY, value, updated_at: stamp });
  if (!insErr) return true;
  if (insErr.code !== "23505") {
    log("lease insert failed — skipping this run:", insErr.message);
    return false;
  }

  const { data: cur, error: readErr } = await sb.from("platform_config")
    .select("value").eq("key", LEASE_KEY).maybeSingle();
  if (readErr || !cur) {
    log("lease read failed — skipping this run:", readErr?.message || "row vanished");
    return false;
  }
  let held: { holder?: string; expires_at?: string } = {};
  try { held = JSON.parse(cur.value); } catch { /* unreadable lease = expired */ }
  const live = Date.parse(held.expires_at || "") > now;
  if (live && held.holder !== holder) {
    log(`another scheduler (${held.holder}) holds the lease until ${held.expires_at} — skipping this run`);
    return false;
  }

  const { data: won, error: casErr } = await sb.from("platform_config")
    .update({ value, updated_at: stamp })
    .eq("key", LEASE_KEY).eq("value", cur.value)
    .select("key");
  if (casErr) { log("lease renew failed — skipping this run:", casErr.message); return false; }
  if (!won?.length) { log("lease taken by another scheduler a moment ago — skipping this run"); return false; }
  if (held.holder && held.holder !== holder) log(`took over the scheduler lease from ${held.holder} (expired ${held.expires_at})`);
  return true;
}

/* ── Paid plan expiry ───────────────────────────────────────── */
/**
 * Nothing ever took a paid plan away. /api/billing/verify sets tenants.plan
 * when a one-off order is paid, and the only thing that could ever undo it
 * was a person remembering to — so a month's Starter payment bought Starter
 * for good.
 *
 * Downgrades to 'trial' (tenants_plan_check allows demo/trial/starter/
 * growth/scale) only when the tenant's subscription record positively says
 * the paid period is over. Everything uncertain leaves the plan alone:
 *
 *  - NO subscriptions row at all: the plan was set by hand by an admin
 *    ("sai clinic", "Go motion"). There is nothing here that says it ends.
 *  - any row without current_period_end: we cannot tell when it ends.
 *  - an 'active' Razorpay recurring subscription (razorpay_sub_id): the
 *    subscription.charged webhook renews it every month WITHOUT moving
 *    current_period_end, so its end date goes stale while it is being paid.
 *  - the latest row is for a different plan than the tenant is on: somebody
 *    changed the plan by hand after that payment.
 *
 * A day's grace past current_period_end, so a customer renewing on the
 * last evening is not downgraded overnight. Any query error: do nothing.
 */
const PAID_PLANS = ["starter", "growth", "scale"];
const PLAN_EXPIRY_GRACE_MS = 24 * 3600 * 1000;

export async function runPlanExpiry(): Promise<number> {
  const { data: tenants, error } = await sb.from("tenants")
    .select("id, name, plan").in("plan", PAID_PLANS);
  if (error) { log("plan expiry: tenant read failed:", error.message); return 0; }
  if (!tenants?.length) return 0;

  const { data: subs, error: subErr } = await sb.from("subscriptions")
    .select("tenant_id, plan_id, status, razorpay_sub_id, current_period_end")
    .in("tenant_id", tenants.map((t: any) => t.id));
  if (subErr) { log("plan expiry: subscriptions read failed:", subErr.message); return 0; }

  const byTenant = new Map<string, any[]>();
  for (const s of subs || []) {
    const list = byTenant.get(s.tenant_id) || [];
    list.push(s);
    byTenant.set(s.tenant_id, list);
  }

  const now = Date.now();
  let downgraded = 0;
  for (const t of tenants) {
    const rows = byTenant.get(t.id) || [];
    if (!rows.length) continue;
    if (rows.some(s => !s.current_period_end || Number.isNaN(Date.parse(s.current_period_end)))) continue;
    if (rows.some(s => s.status === "active" && s.razorpay_sub_id)) continue;

    const latest = rows.reduce((a, b) =>
      Date.parse(b.current_period_end) > Date.parse(a.current_period_end) ? b : a);
    if (Date.parse(latest.current_period_end) + PLAN_EXPIRY_GRACE_MS > now) continue;
    if (String(latest.plan_id || "").toLowerCase() !== String(t.plan).toLowerCase()) continue;

    // Conditional on the plan we read, so a payment that lands mid-run and
    // moves the tenant to another plan is not overwritten.
    const { data: done, error: upErr } = await sb.from("tenants")
      .update({ plan: "trial" }).eq("id", t.id).eq("plan", t.plan).select("id");
    if (upErr) { log(`plan expiry: downgrade of ${t.name} failed:`, upErr.message); continue; }
    if (!done?.length) continue;
    downgraded++;
    log(`plan expired: ${t.name} (${t.id}) ${t.plan} → trial — paid period ended ${latest.current_period_end}` +
        ` (subscription status ${latest.status})`);
  }
  return downgraded;
}

// At the END of the file: module-level consts below the old position
// (LEASE_TTL_MS, PAID_PLANS) were still in their temporal dead zone when
// main() ran, and every scheduler run died with a ReferenceError.
if (require.main === module) {
  runScheduler()
    .then(() => process.exit(0))
    .catch(e => { console.error("[scheduler] fatal", e); process.exit(1); });
}
