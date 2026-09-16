/**
 * Onboarding email sequence — runs daily.
 *
 * Picks up users whose auth.users.created_at falls on the lookback
 * days [0, 3, 10, 14] and sends the matching email IF and ONLY IF a
 * row doesn't already exist in onboarding_emails_sent for that step.
 *
 * Idempotent: re-running the same day = no duplicates (unique
 * constraint on user_id + step in the schema).
 *
 * Run from cron / pg_cron / systemd timer:
 *   npx ts-node src/jobs/onboarding-emails.ts
 *
 * Or programmatically by calling runOnboardingEmails().
 */
import { createClient } from "@supabase/supabase-js";

const RESEND_API_KEY = process.env.RESEND_API_KEY!;

// Set when Resend rejects for an unverified domain, so one run does not make
// the same doomed call once per pending email.
let domainBlocked = false;
const FROM_EMAIL     = process.env.FROM_EMAIL     || "hello@heynikki.in";
const SITE_URL       = process.env.SITE_URL       || "https://heynikki.in";

interface OnboardingStep {
  id:          string;
  daysAfter:   number;
  subject:     (firstName: string) => string;
  body:        (vars: { firstName: string; dashboardUrl: string }) => string;
}

const STEPS: OnboardingStep[] = [
  {
    id:        "welcome",
    daysAfter: 0,
    subject:   () => "Welcome to Nikki — let's get your AI receptionist live",
    body: ({ firstName, dashboardUrl }) => `Hi ${firstName},

Welcome to Nikki. You start with 100 free minutes of answered calls —
no card required, and no clock running.

Three things to do in the next 5 minutes:

  1. Pick a voice profile (Standard / Clinic / Real Estate / Premium)
       → ${dashboardUrl}/setup
  2. Forward your business number to the Nikki DID we set up
  3. Make a test call to see it in action

If you get stuck, just reply to this email. I read every one.

— Karthikeya
Nikki Technologies`,
  },
  {
    id:        "day3_check_in",
    daysAfter: 3,
    subject:   () => "How's the AI receptionist going?",
    body: ({ firstName, dashboardUrl }) => `Hi ${firstName},

Day 3 of your Nikki trial. Quick check-in — has the AI handled any
real calls yet?

  • If yes: take a peek at the call recordings + transcripts at
    ${dashboardUrl}/calls — you'll see exactly what callers heard
    and what was booked.
  • If not: most likely the forwarding isn't active. Common fixes:
    https://docs.heynikki.in/call-forwarding

Any questions, just reply.

— Karthikeya`,
  },
  {
    id:        "day10_trial_ending",
    daysAfter: 10,
    subject:   () => "How your free minutes are going",
    body: ({ firstName, dashboardUrl }) => `Hi ${firstName},

Your free minutes get used as Nikki answers calls — there is no deadline,
but they do run out, and calls stop when they do.

To keep her answering without a gap, pick a plan when you're ready:
  → ${dashboardUrl}/billing

Plans start at ₹1,999/month (Starter — 200 mins). The first month is
fully refundable within 7 days if Nikki doesn't fit.

If you'd rather not continue, no action needed. Your account stays
read-only and everything is exportable from the dashboard.

— Karthikeya`,
  },
  {
    id:        "day14_trial_ended",
    daysAfter: 14,
    subject:   () => "Two weeks in — what Nikki has done so far",
    body: ({ firstName, dashboardUrl }) => `Hi ${firstName},

It's been two weeks since you set Nikki up. Everything she has answered —
calls, transcripts, leads and bookings — is on your dashboard at
${dashboardUrl}.

When your free minutes run out, calls stop until you choose a plan:
  → ${dashboardUrl}/billing

If Nikki wasn't a fit, I'd love to know why — just reply with a
sentence. It's the single most valuable feedback we get.

— Karthikeya`,
  },
];

async function sendEmail(to: string, subject: string, body: string): Promise<string | null> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      [to],
      subject,
      text:    body,
      // Plain text only on purpose — onboarding emails should look like
      // they came from a human, not a marketing automation.
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    console.error(`[onboarding] Resend ${r.status}:`, body);
    // A domain that is not verified will reject EVERY send, for every tenant,
    // on every fifteen-minute cycle. That is not a per-email failure and
    // retrying it is pointless — say so once and stand down for this run.
    if (/domain is not verified|not verified/i.test(body)) {
      domainBlocked = true;
      console.error(
        "[onboarding] SENDING DOMAIN NOT VERIFIED — no onboarding email can go out. " +
        "Add and verify the domain at resend.com/domains. Nothing is lost: the " +
        "send-once claim is released when a send fails.",
      );
    }
    return null;
  }
  const j = await r.json() as { id?: string };
  return j.id || null;
}

export async function runOnboardingEmails(): Promise<{ sent: number; skipped: number; errors: number }> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  let sent = 0, skipped = 0, errors = 0;
  domainBlocked = false;

  for (const step of STEPS) {
    // Window: users created between (daysAfter+1) and daysAfter days ago —
    // a 24h band, so each step fires once on its day.
    //
    // The welcome is the exception, and it has to be. A 24h band means
    // anyone who signed up while sending was broken never gets one at all:
    // their day passed, and no later run looks back. That is exactly what
    // happened here — the domain was unverified for two days, and a real
    // customer's welcome was lost rather than delayed. Wrong claim on my
    // part, and this is the correction. The welcome now reaches anyone
    // confirmed in the last seven days who has not had it, exactly once,
    // because onboarding_emails_sent still guarantees that.
    const backfill = step.id === "welcome";
    const upper = new Date(Date.now() - step.daysAfter      * 86400000);
    // Seven days, not thirty. A welcome that arrives three weeks after
    // someone signed up does not read as a welcome, it reads as a system
    // that has just noticed them.
    const lower = backfill
      ? new Date(Date.now() - 7 * 86400000)
      : new Date(Date.now() - (step.daysAfter + 1) * 86400000);

    // List users via Supabase Admin API
    const { data: usersList, error } = await sb.auth.admin.listUsers({
      page: 1, perPage: 1000,
    });
    if (error) { console.error("[onboarding] list users:", error); errors++; continue; }

    const candidates = (usersList.users || []).filter(u => {
      if (!u.email || !u.email_confirmed_at) return false;
      const created = new Date(u.created_at);
      return created >= lower && created < upper;
    });

    for (const u of candidates) {
      // CLAIM, then send. The old order was look-up, send, record — and both
      // ends failed open: a lookup ERROR came back as `existing = null`,
      // which read as "never sent", and the insert that recorded the send
      // had its error ignored. So one bad read, or one failed insert, and the
      // same welcome email went out again on every 15-minute cycle.
      //
      // The unique (user_id, step) constraint makes the insert itself the
      // guard: exactly one run can create the row, and only that run sends.
      // Any other insert error means we do not know — so we do not send.
      const { data: claim, error: claimErr } = await sb.from("onboarding_emails_sent")
        .insert({ user_id: u.id, step: step.id })
        .select("id").single();
      if (claimErr) {
        if (claimErr.code === "23505") { skipped++; continue; }
        console.error(`[onboarding] claim ${step.id} for ${u.id} failed — not sending:`, claimErr.message);
        errors++;
        continue;
      }

      const firstName = (u.user_metadata?.full_name as string | undefined)?.split(" ")[0]
                     || u.email!.split("@")[0];
      const subject   = step.subject(firstName);
      const body      = step.body({ firstName, dashboardUrl: `${SITE_URL}/dashboard` });

      let resendId: string | null = null;
      try { resendId = await sendEmail(u.email!, subject, body); }
      catch (e: any) { console.error(`[onboarding] send ${step.id} to ${u.id} threw:`, e?.message || e); }
      if (!resendId) {
        // Nothing went out, so give the step back for the next run. If the
        // release itself fails the claim stays and this email is never sent
        // — the safe way round; it is logged so it can be cleared by hand.
        const { error: relErr } = await sb.from("onboarding_emails_sent").delete().eq("id", claim.id);
        if (relErr) console.error(`[onboarding] could not release claim ${claim.id} (${step.id} for ${u.id}) — it will not be retried:`, relErr.message);
        errors++;
        if (domainBlocked) break;
        continue;
      }

      const { error: idErr } = await sb.from("onboarding_emails_sent")
        .update({ resend_id: resendId }).eq("id", claim.id);
      if (idErr) console.error(`[onboarding] resend_id not recorded for ${claim.id}:`, idErr.message);

      // Audit log for DPDP
      await sb.from("audit_log").insert({
        actor_id:    u.id,
        actor_email: u.email,
        action:      `onboarding.${step.id}.sent`,
        metadata:    { resend_id: resendId },
      });

      sent++;
      // Resend rate-limit: 10 req/sec on free tier. Sleep 150ms between sends.
      await new Promise(r => setTimeout(r, 150));
    }
  }

  console.log(`[onboarding] sent=${sent} skipped=${skipped} errors=${errors}`);
  return { sent, skipped, errors };
}

if (require.main === module) {
  runOnboardingEmails().then(
    r => process.exit(r.errors > 0 ? 1 : 0),
    e => { console.error(e); process.exit(2); }
  );
}
