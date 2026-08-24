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

Welcome to Nikki. Your 14-day free trial just started — no card required.

Three things to do in the next 5 minutes:

  1. Pick a voice profile (Standard / Clinic / Real Estate / Premium)
       → ${dashboardUrl}/setup
  2. Forward your business number to the Nikki DID we set up
  3. Make a test call to see it in action

If you get stuck, just reply to this email. I read every one.

— Karthikeya
Nikki Global Technologies`,
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
    subject:   () => "Your Nikki trial ends in 4 days",
    body: ({ firstName, dashboardUrl }) => `Hi ${firstName},

Heads up — your 14-day Nikki trial ends in 4 days.

To keep your AI receptionist running without interruption, pick a plan:
  → ${dashboardUrl}/billing

Plans start at ₹1,999/month (Starter — 200 mins). The first month is
fully refundable within 7 days if Nikki doesn't fit.

If you'd rather not continue, no action needed — your account becomes
read-only and is deleted after 30 days. All your call data is exportable
from the dashboard until then.

— Karthikeya`,
  },
  {
    id:        "day14_trial_ended",
    daysAfter: 14,
    subject:   () => "Your trial ended — what now?",
    body: ({ firstName, dashboardUrl }) => `Hi ${firstName},

Your 14-day Nikki trial ended today. Your AI receptionist has stopped
accepting calls, but your data is safe and exportable for 30 days at
${dashboardUrl}.

To pick up where you left off:
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
    console.error(`[onboarding] Resend ${r.status}:`, await r.text());
    return null;
  }
  const j = await r.json() as { id?: string };
  return j.id || null;
}

export async function runOnboardingEmails(): Promise<{ sent: number; skipped: number; errors: number }> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  let sent = 0, skipped = 0, errors = 0;

  for (const step of STEPS) {
    // Window: users created between (daysAfter+1) and daysAfter days ago.
    // i.e. for daysAfter=3, users created 3-4 days ago (24h window).
    const upper = new Date(Date.now() - step.daysAfter      * 86400000);
    const lower = new Date(Date.now() - (step.daysAfter + 1) * 86400000);

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
      // Check if this step has already been sent
      const { data: existing } = await sb.from("onboarding_emails_sent")
        .select("id").eq("user_id", u.id).eq("step", step.id).maybeSingle();
      if (existing) { skipped++; continue; }

      const firstName = (u.user_metadata?.full_name as string | undefined)?.split(" ")[0]
                     || u.email!.split("@")[0];
      const subject   = step.subject(firstName);
      const body      = step.body({ firstName, dashboardUrl: `${SITE_URL}/dashboard` });

      const resendId = await sendEmail(u.email!, subject, body);
      if (!resendId) { errors++; continue; }

      // Record AFTER successful send so a Resend outage gets retried tomorrow
      await sb.from("onboarding_emails_sent").insert({
        user_id: u.id, step: step.id, resend_id: resendId,
      });

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
