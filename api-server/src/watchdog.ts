/**
 * Watchdog — the conditions nobody currently learns about.
 *
 * WHY THIS EXISTS
 * Every failure this file detects has already happened on this deployment and
 * was found by a person looking, not by the system telling anyone:
 *
 *  - Jio answered 29 of 29 outbound INVITEs with 403 Forbidden. The
 *    dispatcher wrote trunk_outbound_state and the voice pipeline quietly
 *    stopped offering transfers for six hours. Nothing told a human.
 *  - The scheduler ran a 4 Sep image until 16 Sep. Nothing said so.
 *  - Calls sat 'active' for hours when the hangup hook died, and the only
 *    symptom was a dashboard that said a call was in progress.
 *  - SENTRY_DSN is empty, so every console.error in this stack goes to a
 *    container log that is rotated away and, until today, destroyed on every
 *    deploy. "Check the logs" was not an answer anyone could act on.
 *
 * A dead inbound line is the worst of them, because it is INVISIBLE: no
 * error, no row, no alert — just a quiet dashboard that looks like a quiet
 * week. That one is the reason this file exists at all.
 *
 * THE RULE THIS FILE KEEPS
 * The mailbox must tell the truth. An email goes out when a condition STARTS
 * and again when it CLEARS, so an inbox that shows an open alert means the
 * thing is still broken right now. That is the whole product of this file —
 * a watchdog that only ever pages and never says "fixed" trains its owner to
 * ignore it inside a week.
 *
 * ANTI-NOISE, in order of importance:
 *  1. A condition that appeared and fixed itself before it was ever emailed
 *     produces NO email at all — not the alert, not the all-clear.
 *  2. At most one email per condition per 6 hours. The all-clear is the only
 *     exception, because it is the second half of an alert already sent, not
 *     a new one.
 *  3. Derived signals (a dead line, a vendor breaker, a stuck call) must be
 *     observed on two consecutive runs — 15 minutes apart — before they page.
 *     Hard signals (a health endpoint that refuses two connections eight
 *     seconds apart) page on the first run.
 *  4. A check that ERRORS reports "unknown", which neither opens a condition
 *     nor clears one. Inventing "the trunk is down" because platform_config
 *     was briefly unreadable sends someone to a PBX that is working.
 *
 * STATE
 * platform_config.watchdog_state, one JSON row, written with the same
 * compare-and-set the scheduler lease uses. It survives container restarts —
 * which matters, because a scheduler that restarts is exactly when an
 * in-memory "already alerted" flag would re-page everything at once — and
 * the CAS means two hosts running this concurrently cannot both send. Emails
 * are only sent AFTER the state write wins; a lost race sends nothing and
 * retries in 15 minutes.
 *
 * COST
 * No probe here spends vendor credit. Sarvam and Gemini health is read off
 * the voice pipeline's own /health, which reports the circuit breakers it
 * already maintains from real call traffic.
 */
import os from "os";
import { createClient } from "@supabase/supabase-js";
import { sendOwnerEmail } from "./owner-alerts";
import { minutesGate } from "./usage";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const log = (...a: unknown[]) => console.log("[watchdog]", ...a);

/** The platform's own tenant. Its owner is the person these emails reach. */
const PLATFORM_TENANT_ID = "fe11adc0-0b4a-4e2a-9232-008caa650dff";

const STATE_KEY = "watchdog_state";

/** One alert per condition per 6 hours, matching the trunk fault's own
 *  freshness window — long enough that a flapping health check cannot fill
 *  a mailbox, short enough that a Monday-morning outage is still re-stated
 *  before the working day is over. */
const RENOTIFY_MS = 6 * 3600 * 1000;

/** A trunk fault older than this is history. Same six hours the voice
 *  pipeline trusts one for (voice-pipeline/main.py::_outbound_ok). */
const TRUNK_FAULT_FRESH_MS = 6 * 3600 * 1000;

/** A call still 'active' this long has outlived any real conversation on
 *  this system (the longest ever recorded is six minutes). The scheduler's
 *  own sweep closes them at 2 h, so anything past that also means the sweep
 *  is not running — the email says which case it is. */
const STUCK_CALL_MS = 1 * 3600 * 1000;

/** How many hours of silence make a line suspect, and the IST window in
 *  which silence means anything at all. Nobody rings a clinic at 04:00. */
const DEAD_LINE_HOURS = 4;
const BUSINESS_FROM_MIN = 9 * 60;      // 09:00 IST
const BUSINESS_TO_MIN   = 20 * 60;     // 20:00 IST

/** Answered inbound calls in the same clock-hour band over the previous
 *  seven days before "nothing today" means anything. Below this the line is
 *  simply quiet, and a quiet line is not an incident — it is most of this
 *  platform's hours today. */
const DEAD_LINE_MIN_BASELINE = 3;
const DEAD_LINE_BASELINE_DAYS = 7;

/** WhatsApp sends that failed today before it counts as "repeatedly". One
 *  failed send is a bad number; three is Meta refusing us. */
const WA_FAIL_THRESHOLD = 3;

/** A vendor breaker's consecutive_failures is the durable signal. The
 *  breaker's own OPEN state lasts 30 seconds, which a 15-minute poll will
 *  essentially never catch; consecutive_failures stays put until a call
 *  actually succeeds, so it is still there when we look. */
const VENDOR_FAIL_THRESHOLD = 3;

/** Episodes nobody has evaluated for a week are closed out. The only way to
 *  get one is a host-scoped condition (the lease complaint) raised by a box
 *  that has since been switched off — and an alert left open forever by a
 *  machine that no longer exists is the mailbox lying. */
const STALE_EPISODE_MS = 7 * 24 * 3600 * 1000;

const HTTP_TIMEOUT_MS = 8_000;

/* ── What a check reports ───────────────────────────────────── */

/**
 * "unknown" is not a synonym for "clear". A Supabase read that errored, or a
 * pipeline we could not reach while checking Sarvam, must leave whatever we
 * already believe untouched: it may neither raise a fault nor send an
 * all-clear for one that is still burning.
 */
type Verdict =
  | { state: "open"; detail: string }
  | { state: "clear" }
  | { state: "unknown"; why: string };

type Check = {
  /** Stable across runs — this is the dedupe key in platform_config. */
  id: string;
  /** Subject line, without the product prefix. */
  title: string;
  /** The FIRST thing to look at. Not a list; the one command or page. */
  firstCheck: string;
  /**
   * Consecutive runs the condition must be seen before it emails.
   *  1 — the signal is already debounced or unambiguous (a health endpoint
   *      that refused two connections, a persisted trunk fault, a daily
   *      failure count).
   *  2 — derived or noisy, so 15 minutes of persistence is the price of
   *      waking someone up.
   */
  confirmRuns: 1 | 2;
  run: () => Promise<Verdict>;
};

/* ── Persisted episode state ────────────────────────────────── */

type Episode = {
  /** When the condition was FIRST observed open — "since when" in the email. */
  since: string;
  /** Consecutive runs it has been observed open. */
  runs: number;
  /** When we last emailed about THIS episode. Absent = never emailed, which
   *  is what makes rule 1 (no email for a self-healing blip) work. */
  emailed_at?: string;
  /** Last observation, shown in the digest. */
  detail: string;
  /** Last run that evaluated this condition at all, for stale pruning. */
  seen_at: string;
};

type State = Record<string, Episode>;

export type WatchdogDeps = {
  /** Injected by tests so a run can be exercised against production reads
   *  without a real mailbox receiving anything. */
  send?: (to: string, subject: string, html: string) => Promise<boolean>;
  /** Overrides the owner lookup. WATCHDOG_EMAIL_TO does the same from env. */
  to?: string;
  /** false = evaluate and report, write nothing. Tests only. */
  persist?: boolean;
};

export type WatchdogResult = {
  open: number;
  emailed: number;
  cleared: number;
  unknown: number;
  /** Plain text, exactly as it is pasted into every email. */
  digest: string;
};

/* ── Small shared helpers ───────────────────────────────────── */

/** Minutes past IST midnight. Every boundary in this product is +05:30. */
function istMinutesNow(now = Date.now()): number {
  const d = new Date(now + 330 * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Today in IST, for the day boundary the WhatsApp failure count uses. */
function istDayStartIso(now = Date.now()): string {
  const ist = new Date(now + 330 * 60_000).toISOString().slice(0, 10);
  return `${ist}T00:00:00+05:30`;
}

/** An instant written the way the person reading the email thinks about it. */
function istStamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + 330 * 60_000).toISOString().replace("T", " ").slice(0, 16) + " IST";
}

function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Alert text is assembled from vendor strings and tenant names. Escaped
 *  rather than trusted, exactly as the morning briefing does it. */
function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A GET that answers a boolean, twice.
 *
 * A single refused connection is not an outage — it is a container being
 * restarted by `deploy.sh`, which happens on purpose and finishes in
 * seconds. Two refusals four seconds apart is a service that is down, and
 * that is worth an email on the first run rather than making someone wait
 * out a second 15-minute cycle for news their API is off the air.
 */
async function probe(url: string): Promise<{ ok: boolean; why: string }> {
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 4_000));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (r.ok) return { ok: true, why: "" };
      why = `HTTP ${r.status}`;
    } catch (e: any) {
      why = e?.name === "TimeoutError" ? `no answer in ${HTTP_TIMEOUT_MS / 1000}s` : (e?.message || String(e));
    }
  }
  return { ok: false, why };
}

/** The pipeline's /health, fetched once per run and shared by four checks so
 *  a single poll answers all of them. */
async function pipelineHealth(): Promise<any | null> {
  try {
    const r = await fetch(`${PIPELINE_URL}/health`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const PIPELINE_URL = (process.env.PIPELINE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const API_URL      = (process.env.API_URL      || "http://127.0.0.1:4000").replace(/\/$/, "");

/* ── The checks ─────────────────────────────────────────────── */

/**
 * The outbound trunk is refusing our INVITEs.
 *
 * The dispatcher already writes this on every state CHANGE, so the row is a
 * debounced fact rather than a sample — which is why this pages on the first
 * run. It matters beyond outbound: the voice pipeline reads the same row and
 * stops offering EVERY caller a transfer to a human while it is set.
 */
function checkTrunk(): Check {
  return {
    id: "trunk_fault",
    title: "Outbound trunk is rejecting calls",
    firstCheck: "infra/verify-trunk.sh, then `fs_cli -x 'sofia status'` — a Jio 403 usually means the SBC dropped our registration.",
    confirmRuns: 1,
    run: async () => {
      const { data, error } = await sb.from("platform_config")
        .select("value").eq("key", "trunk_outbound_state").maybeSingle();
      if (error) return { state: "unknown", why: `platform_config read failed: ${error.message}` };
      if (!data) return { state: "clear" };
      let st: any = {};
      try { st = JSON.parse(data.value); } catch { return { state: "unknown", why: "trunk_outbound_state is not JSON" }; }
      if (st?.ok !== false) return { state: "clear" };
      const at = Date.parse(st?.at || "");
      // Stale faults are not faults. The pipeline stops trusting one after
      // six hours and so does this: an old row must not hold an alert open
      // for a trunk that has been fine all day.
      if (!Number.isFinite(at) || Date.now() - at > TRUNK_FAULT_FRESH_MS) return { state: "clear" };
      return { state: "open", detail: `cause ${st.cause || "unknown"}, since ${istStamp(st.at)} (${ago(st.at)} ago)` };
    },
  };
}

/**
 * The two processes that answer a phone call.
 *
 * Checked over loopback because that is how they are actually reached here:
 * FreeSWITCH, api-server and the pipeline all share the host network
 * namespace, so 127.0.0.1 from this container is the same 127.0.0.1 a call
 * travels over. A check through the public hostname would test Cloudflare's
 * tunnel instead, and pass while the line was dead.
 */
function checkHealth(id: string, name: string, url: string, firstCheck: string): Check {
  return {
    id,
    title: `${name} is not answering`,
    firstCheck,
    confirmRuns: 1,
    run: async () => {
      const r = await probe(`${url}/health`);
      return r.ok ? { state: "clear" } : { state: "open", detail: `${url}/health — ${r.why} (two attempts)` };
    },
  };
}

/**
 * Calls the system still believes are in progress.
 *
 * A row stuck 'active' means the hangup hook did not fire, and everything
 * downstream of it did not happen either: no minutes billed, no transcript
 * saved, no missed-call follow-up, no summary line. The dashboard shows a
 * call in progress on a channel that closed hours ago.
 *
 * Past 2 h it means something worse — runCloseAbandonedCalls sweeps them at
 * 2 h every 15 minutes, so a 3-hour-old 'active' row says the scheduler's
 * own sweep is not running. The email distinguishes the two.
 */
function checkStuckCalls(): Check {
  return {
    id: "stuck_calls",
    title: "Calls stuck 'active'",
    firstCheck: "Compare with `fs_cli -x 'show channels'` — if FreeSWITCH has no channel, the hangup webhook (/webhooks/freeswitch/hangup) is not landing.",
    confirmRuns: 2,
    run: async () => {
      const cutoff = new Date(Date.now() - STUCK_CALL_MS).toISOString();
      const { data, error } = await sb.from("calls")
        .select("id, created_at, tenant_id")
        .eq("status", "active").lt("created_at", cutoff)
        .order("created_at", { ascending: true }).limit(50);
      if (error) return { state: "unknown", why: `calls read failed: ${error.message}` };
      if (!data?.length) return { state: "clear" };
      const oldest = data[0].created_at as string;
      const sweepDead = Date.now() - Date.parse(oldest) > 2 * 3600 * 1000;
      return {
        state: "open",
        detail: `${data.length} call${data.length === 1 ? "" : "s"} active over an hour; oldest ${ago(oldest)} (${data[0].id})` +
                (sweepDead ? " — past the 2h abandoned-call sweep, so the scheduler's sweep is NOT running" : ""),
      };
    },
  };
}

/**
 * The line is dead and nothing says so.
 *
 * This is the failure with no error attached to it. A DID unrouted at the
 * carrier, FreeSWITCH losing its registration, a dialplan edit that sends
 * every call to voicemail — none of them write a row, throw an exception or
 * turn a healthcheck red. The business sees a quiet dashboard and assumes a
 * quiet week, and the first real signal is a customer saying "I rang you
 * three times".
 *
 * So the only evidence available is the absence of calls, and absence alone
 * proves nothing on a platform whose busiest day is eight calls. The test is
 * therefore against the line's OWN history: if this clock-hour band answered
 * calls on the previous seven days and has answered none today, something
 * changed. If the band has no history, this says nothing at all — which is
 * most hours here today, and is the correct answer for them.
 *
 * Platform-wide on purpose. Per-DID would be the better signal and is where
 * this should go once there is enough traffic for a single number to have a
 * baseline; today it would only manufacture noise from three tenants.
 */
function checkDeadLine(): Check {
  return {
    id: "dead_line",
    title: "No inbound call answered during business hours",
    firstCheck: "Ring the DID from a mobile. If it does not ring, check `fs_cli -x 'sofia status gateway jio'` and that the DID is still routed at the carrier.",
    confirmRuns: 2,
    run: async () => {
      const nowMin = istMinutesNow();
      // Outside business hours this proves nothing — and reporting "clear"
      // at 20:01 would fire an all-clear for a line that is still dead.
      if (nowMin < BUSINESS_FROM_MIN + DEAD_LINE_HOURS * 60 || nowMin >= BUSINESS_TO_MIN) {
        return { state: "unknown", why: "outside the business-hours window" };
      }
      const now = Date.now();
      const sinceDays = new Date(now - (DEAD_LINE_BASELINE_DAYS + 1) * 24 * 3600 * 1000).toISOString();
      // Newest first, capped at PostgREST's own 1000-row ceiling rather than
      // asking for more and being silently given 1000 anyway. If eight days
      // ever exceed that, the rows dropped are the OLDEST — so the recent
      // window stays exact and only the baseline is under-counted, which
      // makes this quieter, never louder. That is the right way for a
      // truncation to fail.
      const { data, error } = await sb.from("calls")
        .select("created_at, status, duration_seconds")
        .eq("direction", "inbound").gte("created_at", sinceDays)
        .order("created_at", { ascending: false }).limit(1000);
      if (error) return { state: "unknown", why: `calls read failed: ${error.message}` };

      // "Answered" means a caller actually spoke to Nikki. A row with zero
      // seconds is a call that arrived and died, which is the very fault
      // this is looking for — counting it would hide the outage.
      const answered = (data || []).filter((c: any) =>
        ["completed", "transferred"].includes(String(c.status)) && Number(c.duration_seconds) > 0);

      const windowMs = DEAD_LINE_HOURS * 3600 * 1000;
      const recent = answered.filter((c: any) => Date.parse(c.created_at) >= now - windowMs).length;
      if (recent > 0) return { state: "clear" };

      // Same clock-hour band, each of the previous seven days.
      const fromMin = nowMin - DEAD_LINE_HOURS * 60;
      let baseline = 0;
      for (const c of answered) {
        const t = Date.parse(c.created_at);
        if (t >= now - 24 * 3600 * 1000) continue;                    // today is what we are testing
        if (t < now - DEAD_LINE_BASELINE_DAYS * 24 * 3600 * 1000) continue;
        const m = istMinutesNow(t);
        if (m >= fromMin && m < nowMin) baseline++;
      }
      if (baseline < DEAD_LINE_MIN_BASELINE) {
        return { state: "unknown", why: `only ${baseline} answered call(s) in this hour band over the last ${DEAD_LINE_BASELINE_DAYS} days — no baseline to judge against` };
      }
      return {
        state: "open",
        detail: `no inbound call answered in the last ${DEAD_LINE_HOURS}h; the same hours over the previous ` +
                `${DEAD_LINE_BASELINE_DAYS} days answered ${baseline}`,
      };
    },
  };
}

/**
 * Another host is running the jobs.
 *
 * The lease exists because a second `docker compose up -d` on a machine that
 * shares this compose file starts a second scheduler, and every job here is
 * "read an unsent flag, then send" — two copies send every reminder twice.
 * The lease stops the double-send, and then says nothing: the losing host
 * simply skips its run forever, so reminders, summaries and the retention
 * purge can stop happening on the box you believe is running them while
 * every log line reads "skipping this run".
 *
 * The id carries the hostname because only the LOSING host can see this, and
 * the winning host must not clear a complaint it is the cause of.
 */
function checkLease(): Check {
  const me = process.env.SCHEDULER_INSTANCE || os.hostname();
  return {
    id: `lease_foreign:${me}`,
    title: "Scheduler lease is held by another host",
    firstCheck: "`docker ps` on both hosts. Only the telephony host should run the `scheduler` compose profile; stop the other one.",
    confirmRuns: 2,
    run: async () => {
      const { data, error } = await sb.from("platform_config")
        .select("value, updated_at").eq("key", "scheduler_lease").maybeSingle();
      if (error) return { state: "unknown", why: `lease read failed: ${error.message}` };
      if (!data) return { state: "clear" };
      let held: any = {};
      try { held = JSON.parse(data.value); } catch { return { state: "unknown", why: "scheduler_lease is not JSON" }; }
      const live = Date.parse(held?.expires_at || "") > Date.now();
      if (!live || held?.holder === me) return { state: "clear" };
      return {
        state: "open",
        detail: `this host is "${me}"; the lease is held by "${held.holder}" until ${istStamp(held.expires_at)}. ` +
                `Scheduled jobs are running there, not here.`,
      };
    },
  };
}

/**
 * WhatsApp sends failing today.
 *
 * Every confirmation, reminder, missed-call follow-up and daily summary goes
 * out this way, and a failed send is logged and swallowed by design — a
 * logging failure must never block a send, and a send failure must never
 * break a call. The consequence is that Meta refusing our template for a day
 * looks exactly like a quiet day, in a log nobody opens.
 */
function checkWhatsApp(): Check {
  return {
    id: "whatsapp_failing",
    title: "WhatsApp sends are failing",
    firstCheck: "Super Admin > WhatsApp, and the template status on Meta — a reclassified or paused template fails every send with a 200 from our side.",
    confirmRuns: 1,
    run: async () => {
      const since = istDayStartIso();
      const [failed, total] = await Promise.all([
        sb.from("wa_dispatch_log").select("id", { count: "exact", head: true })
          .eq("status", "failed").gte("sent_at", since),
        sb.from("wa_dispatch_log").select("id", { count: "exact", head: true })
          .gte("sent_at", since),
      ]);
      if (failed.error) return { state: "unknown", why: `wa_dispatch_log read failed: ${failed.error.message}` };
      const n = failed.count ?? 0;
      if (n < WA_FAIL_THRESHOLD) return { state: "clear" };
      return { state: "open", detail: `${n} of ${total.count ?? "?"} WhatsApp sends failed today (IST)` };
    },
  };
}

/**
 * A paying tenant that has hit its plan's minutes.
 *
 * minutesGate stops the call, and owner-alerts tells the TENANT. Nobody tells
 * the platform: a customer whose number stopped answering mid-month is both a
 * support call that has not happened yet and an upgrade nobody offered.
 *
 * minutesGate fails OPEN on a read error, so an unreadable meter can never
 * raise this — it can only fail to.
 */
function checkPlanBlocked(): Check {
  return {
    id: "plan_minutes_blocked",
    title: "A tenant is blocked at its plan minutes",
    firstCheck: "Super Admin > Tenants — either grant top-up credit or move them up a plan. Their number is not answering until then.",
    confirmRuns: 1,
    run: async () => {
      const { data: tenants, error } = await sb.from("tenants")
        .select("id, name, plan").in("plan", ["starter", "growth", "scale"]).limit(500);
      if (error) return { state: "unknown", why: `tenants read failed: ${error.message}` };
      if (!tenants?.length) return { state: "clear" };
      const blocked: string[] = [];
      for (const t of tenants) {
        const g = await minutesGate(sb, t.id);
        if (!g.ok && g.reason === "plan_minutes_exhausted") {
          blocked.push(`${t.name} (${t.plan}, ${g.usedMinutes}/${g.limitMinutes} min used, ${g.credits} credit min left)`);
        }
      }
      if (!blocked.length) return { state: "clear" };
      return { state: "open", detail: blocked.join("; ") };
    },
  };
}

/**
 * Sarvam and Gemini, read off what the pipeline already knows.
 *
 * DELIBERATELY NOT A PROBE. A synthetic TTS or LLM call every 15 minutes
 * spends real vendor credit to learn something the pipeline already measured
 * from live traffic — and on the plan that ran out of Sarvam credit mid-call,
 * a monitor that burns credit is the fault, not the detector.
 *
 * Three distinct facts come off /health, and they fail differently:
 *  - sarvam_credits_exhausted: a 402. The voice stops. Only a top-up fixes it.
 *  - a breaker's consecutive_failures: the provider is erroring on real turns.
 *  - tts_vendor != "sarvam": we are already speaking through a fallback, which
 *    works but is not the voice the customer bought.
 */
function checkVendors(health: any | null): Check[] {
  const unknownIfDown = (why: string): Verdict => ({ state: "unknown", why });

  const credits: Check = {
    id: "sarvam_credits",
    title: "Sarvam credits exhausted — Nikki has no voice",
    firstCheck: "Top up the Sarvam account. Every call is on a fallback or silent until then.",
    confirmRuns: 1,
    run: async () => {
      if (!health) return unknownIfDown("voice pipeline /health unreachable");
      return health.sarvam_credits_exhausted
        ? { state: "open", detail: "the pipeline saw a 402 from Sarvam in the last 30 minutes" }
        : { state: "clear" };
    },
  };

  const fallback: Check = {
    id: "tts_fallback",
    title: "Speaking through a fallback TTS vendor",
    firstCheck: "The pipeline's /health tts_vendor field. Sarvam is the voice the product sells; anything else is a different one.",
    confirmRuns: 2,
    run: async () => {
      if (!health) return unknownIfDown("voice pipeline /health unreachable");
      const v = String(health.tts_vendor || "");
      // Empty means nothing has spoken since the pipeline started, which is
      // not a fault — it is a quiet hour.
      if (!v || v === "sarvam") return { state: "clear" };
      return { state: "open", detail: `last line was spoken by "${v}", not Sarvam` };
    },
  };

  const breakers: Check[] = ["sarvam_stt", "sarvam_tts", "gemini_llm"].map(name => ({
    id: `vendor_${name}`,
    title: `${name} is failing on live calls`,
    firstCheck: `curl -s ${PIPELINE_URL}/health | grep -o '"${name}"[^}]*' — then the vendor's own status page and the key's quota.`,
    confirmRuns: 2,
    run: async (): Promise<Verdict> => {
      if (!health) return unknownIfDown("voice pipeline /health unreachable");
      const b = (health.circuit_breakers || []).find((x: any) => x?.name === name);
      if (!b) return unknownIfDown(`/health did not report a breaker named ${name}`);
      const fails = Number(b.consecutive_failures) || 0;
      if (b.state !== "open" && fails < VENDOR_FAIL_THRESHOLD) return { state: "clear" };
      return { state: "open", detail: `circuit breaker ${b.state}, ${fails} consecutive failures` };
    },
  }));

  return [credits, fallback, ...breakers];
}

/* ── Who gets the mail ──────────────────────────────────────── */

/**
 * The platform owner's login email, which lives in auth.users and nowhere
 * else. Looked up every run rather than cached: this runs in a process that
 * restarts, and a stale cached address is how an alert goes to an inbox
 * nobody reads any more.
 */
async function platformOwnerEmail(): Promise<string | null> {
  const override = process.env.WATCHDOG_EMAIL_TO;
  if (override) return override;
  try {
    const { data: t, error } = await sb.from("tenants")
      .select("owner_id").eq("id", PLATFORM_TENANT_ID).maybeSingle();
    if (error || !t?.owner_id) {
      log("owner lookup failed:", error?.message || "platform tenant has no owner_id");
      return null;
    }
    const { data } = await sb.auth.admin.getUserById(String(t.owner_id));
    return data?.user?.email || null;
  } catch (e: any) {
    log("owner lookup failed:", e?.message || e);
    return null;
  }
}

/* ── State read / compare-and-set ───────────────────────────── */

async function readState(): Promise<{ state: State; raw: string | null }> {
  const { data, error } = await sb.from("platform_config")
    .select("value").eq("key", STATE_KEY).maybeSingle();
  if (error) throw new Error(`watchdog_state read failed: ${error.message}`);
  if (!data) return { state: {}, raw: null };
  try { return { state: JSON.parse(data.value) as State, raw: data.value }; }
  catch { return { state: {}, raw: data.value }; }   // unreadable = start over
}

/**
 * Write the new state only if nobody changed it since we read it.
 *
 * The emails are sent AFTER this returns true, never before. Two hosts
 * running the watchdog in the same minute would otherwise both decide a
 * condition is new and both send; this way the loser writes nothing, sends
 * nothing, and re-derives the same answer in 15 minutes.
 */
async function writeState(next: State, raw: string | null): Promise<boolean> {
  const value = JSON.stringify(next);
  const stamp = new Date().toISOString();
  if (raw === null) {
    const { error } = await sb.from("platform_config")
      .insert({ key: STATE_KEY, value, label: "Watchdog open-condition state", updated_at: stamp });
    if (!error) return true;
    // 23505 = someone inserted it between our read and our write. Their
    // state is the one that counts; we retry next run.
    if (error.code !== "23505") log("state insert failed:", error.message);
    return false;
  }
  const { data, error } = await sb.from("platform_config")
    .update({ value, updated_at: stamp })
    .eq("key", STATE_KEY).eq("value", raw).select("key");
  if (error) { log("state write failed:", error.message); return false; }
  if (!data?.length) { log("state changed under us — sending nothing this run"); return false; }
  return true;
}

/* ── Email bodies ───────────────────────────────────────────── */

/**
 * Every alert answers the same three questions, because the alerts that
 * already existed on this system ("WhatsApp send failed") answered none of
 * them and left the reader to go and find out.
 */
function alertHtml(c: { title: string; firstCheck: string }, ep: Episode, digest: string, resolved: boolean): string {
  const rows = resolved
    ? [["What was broken", c.title],
       ["Started", `${istStamp(ep.since)} (${ago(ep.since)} ago)`],
       ["Cleared", istStamp(new Date().toISOString())],
       ["Last seen as", ep.detail]]
    : [["What broke", c.title],
       ["Since", `${istStamp(ep.since)} (${ago(ep.since)} ago)`],
       ["Detail", ep.detail],
       ["First thing to check", c.firstCheck]];
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
<p style="margin:0 0 12px"><strong>${escapeHtml(resolved ? "Resolved" : "Hey Nikki watchdog")}</strong></p>
<table cellpadding="4" style="border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join("\n")}
</table>
<p style="margin:16px 0 4px;color:#666">Still open right now</p>
<pre style="background:#f6f6f6;padding:10px;border-radius:6px;white-space:pre-wrap;font-size:13px">${escapeHtml(digest)}</pre>
</div>`;
}

/** The digest, in plain text, so it reads the same in a phone notification
 *  preview as it does in the email body. */
function buildDigest(state: State, checks: Map<string, Check>): string {
  const open = Object.entries(state)
    .filter(([, ep]) => ep.runs > 0)
    .sort((a, b) => Date.parse(a[1].since) - Date.parse(b[1].since));
  if (!open.length) return "Nothing open.";
  return open.map(([id, ep]) => {
    const title = checks.get(id)?.title || id;
    const flag  = ep.emailed_at ? "" : " (not yet alerted)";
    return `• ${title}${flag}\n  since ${istStamp(ep.since)} (${ago(ep.since)})\n  ${ep.detail}`;
  }).join("\n");
}

/* ── The run ────────────────────────────────────────────────── */

/**
 * One pass. Called from the scheduler BEFORE the single-instance lease is
 * taken, because half the point is noticing that another host holds it — a
 * watchdog that only runs on the host that won the lease cannot report that
 * this host lost it.
 *
 * Never throws. Every failure mode here ends in a log line and a result: the
 * watchdog exists to keep the scheduler's other twelve jobs honest, and a
 * watchdog that can abort the run it is watching would be the worst bug in
 * this file.
 */
export async function runWatchdog(deps: WatchdogDeps = {}): Promise<WatchdogResult> {
  const send    = deps.send ?? sendOwnerEmail;
  const persist = deps.persist !== false;
  const empty: WatchdogResult = { open: 0, emailed: 0, cleared: 0, unknown: 0, digest: "Nothing open." };

  let prior: { state: State; raw: string | null };
  try { prior = await readState(); }
  catch (e: any) { log(e?.message || e); return empty; }

  // One poll of the pipeline feeds four vendor checks.
  const health = await pipelineHealth();

  const checks: Check[] = [
    checkTrunk(),
    checkHealth("pipeline_health", "Voice pipeline", PIPELINE_URL,
      "`docker logs --tail 100 heynikki-pipeline`. FreeSWITCH bridges every call into this process — while it is down, calls connect and hear nothing."),
    checkHealth("api_health", "API server", API_URL,
      "`docker logs --tail 100 heynikki-api`. The dashboard, every webhook and the pipeline's routing lookup all go through it."),
    checkStuckCalls(),
    checkDeadLine(),
    checkLease(),
    checkWhatsApp(),
    checkPlanBlocked(),
    ...checkVendors(health),
  ];
  const byId = new Map(checks.map(c => [c.id, c]));

  const now     = Date.now();
  const nowIso  = new Date(now).toISOString();
  const next: State = JSON.parse(JSON.stringify(prior.state || {}));
  const toSend: { check: Check; ep: Episode; resolved: boolean }[] = [];
  let unknown = 0;

  for (const c of checks) {
    let v: Verdict;
    // A check that throws is a check that told us nothing — never one that
    // told us everything is fine.
    try { v = await c.run(); }
    catch (e: any) { v = { state: "unknown", why: e?.message || String(e) }; }

    const ep = next[c.id];

    if (v.state === "unknown") {
      unknown++;
      log(`${c.id}: unknown — ${v.why}`);
      if (ep) ep.seen_at = nowIso;          // still being evaluated; not stale
      continue;
    }

    if (v.state === "open") {
      if (!ep) {
        next[c.id] = { since: nowIso, runs: 1, detail: v.detail, seen_at: nowIso };
      } else {
        ep.runs    = (ep.runs || 0) + 1;
        ep.detail  = v.detail;
        ep.seen_at = nowIso;
      }
      const e = next[c.id];
      const dueForFirst  = !e.emailed_at && e.runs >= c.confirmRuns;
      const dueForRepeat = !!e.emailed_at && now - Date.parse(e.emailed_at) >= RENOTIFY_MS;
      if (dueForFirst || dueForRepeat) {
        e.emailed_at = nowIso;
        toSend.push({ check: c, ep: e, resolved: false });
      }
      continue;
    }

    // Clear.
    if (!ep) continue;
    if (ep.emailed_at) {
      // The all-clear is the second half of an alert already sent, so it
      // ignores the 6-hour cap. Without it the mailbox shows an outage that
      // ended on Tuesday as still burning on Friday.
      toSend.push({ check: c, ep: { ...ep, seen_at: nowIso }, resolved: true });
    }
    // Never emailed and now gone: it fixed itself. Say nothing at all.
    delete next[c.id];
  }

  // Episodes raised by a condition nobody evaluates any more — in practice a
  // host-scoped lease complaint from a box that has been switched off.
  for (const [id, ep] of Object.entries(next)) {
    if (byId.has(id)) continue;
    if (now - Date.parse(ep.seen_at || ep.since) < STALE_EPISODE_MS) continue;
    if (ep.emailed_at) {
      toSend.push({
        check: {
          id, title: `${id} (no longer reported)`, confirmRuns: 1,
          firstCheck: "Nothing — the host that raised this has not been heard from for a week.",
          run: async () => ({ state: "clear" }),
        },
        ep, resolved: true,
      });
    }
    delete next[id];
  }

  const digest = buildDigest(next, byId);
  const open   = Object.values(next).filter(ep => ep.runs > 0).length;

  if (!toSend.length) {
    // Nothing to say — but the observation counters and seen_at stamps still
    // have to land, or a condition can never reach its second run.
    if (persist && JSON.stringify(next) !== (prior.raw ?? "{}")) await writeState(next, prior.raw);
    if (open) log(`${open} condition(s) open, nothing new to report`);
    return { open, emailed: 0, cleared: 0, unknown, digest };
  }

  if (persist && !await writeState(next, prior.raw)) {
    // Lost the race. Somebody else is about to send these, or already has.
    return { open, emailed: 0, cleared: 0, unknown, digest };
  }

  const to = deps.to || await platformOwnerEmail();
  if (!to) {
    log("no platform owner email — alerts not sent:", toSend.map(s => s.check.id).join(", "));
    return { open, emailed: 0, cleared: 0, unknown, digest };
  }

  let emailed = 0, cleared = 0;
  const lostClears: State = {};
  for (const s of toSend) {
    const subject = s.resolved
      ? `[Hey Nikki] Resolved — ${s.check.title}`
      : `[Hey Nikki] ${s.check.title}`;
    const ok = await send(to, subject, alertHtml(s.check, s.ep, digest, s.resolved));
    if (ok) { if (s.resolved) cleared++; else emailed++; continue; }
    if (s.resolved) {
      // An all-clear that Resend refused is the mailbox lying: the inbox
      // still shows an open outage that has ended. The episode goes back
      // into the state — closed (runs 0, so it is not "open" anywhere) but
      // still carrying emailed_at, which makes the next run try the
      // all-clear again.
      lostClears[s.check.id] = { ...s.ep, runs: 0, detail: s.ep.detail, seen_at: nowIso };
      log(`all-clear for ${s.check.id} could not be sent — retrying next run`);
    } else {
      log(`alert email failed for ${s.check.id} — next attempt in ${RENOTIFY_MS / 3600000}h`);
    }
  }
  if (persist && Object.keys(lostClears).length) {
    await writeState({ ...next, ...lostClears }, JSON.stringify(next));
  }
  log(`${open} open, ${emailed} alert(s) and ${cleared} all-clear(s) sent to ${to}`);
  return { open, emailed, cleared, unknown, digest };
}
