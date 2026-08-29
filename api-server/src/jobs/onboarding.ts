// api-server/src/jobs/onboarding.ts
// ────────────────────────────────────────────────────────────────
// The messages a new business gets from HeyNikki itself, as opposed to
// the ones their callers trigger.
//
// A signup that goes quiet is a signup that churns: they created an
// account, nobody told them what happens next, and the number they were
// promised never arrived as far as they know. Each step below answers the
// question a customer is actually asking at that moment.
//
// SEND-ONCE is enforced by a unique index on onboarding_events
// (tenant_id, step), not by a flag this code remembers to set. The job
// runs every 15 minutes; anything relying on in-process memory would
// message every owner four times an hour.
// ────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

const API = process.env.SELF_URL || "http://127.0.0.1:4000";
const INTERNAL = process.env.INTERNAL_SECRET || "";

type Step = {
  step: string;
  /** Should this tenant get this message right now? */
  when: (t: any) => boolean;
  /** Template key in WA_TEMPLATES. Free text alone will not deliver. */
  messageType: string;
  body: (t: any) => string;
  /** Body variables, in order, when the template takes more than the name. */
  params?: (t: any) => string[];
};

const STEPS: Step[] = [
  {
    step: "welcome",
    when: () => true,                       // everyone, immediately after signup
    messageType: "onboarding_welcome",
    body: t => `నమస్కారం ${t.name}! HeyNikki ని ఎంచుకున్నందుకు ధన్యవాదాలు. 🙏\n\n` +
      `మీ account ready — 100 free minutes కూడా add చేశాము. ` +
      `మీ business number setup చేయడానికి మా team మిమ్మల్ని సంప్రదిస్తుంది.`,
  },
  {
    step: "kyc_verified",
    when: t => t.kyc_approved,
    messageType: "onboarding_kyc_verified",
    body: t => `${t.name} — మీ KYC verify అయింది. ✅\n\n` +
      `ఇప్పుడు మీ business number assign చేస్తున్నాము. ` +
      `Number live అయిన వెంటనే మీకు message వస్తుంది.`,
  },
  {
    step: "number_live",
    // voice_profiles.did_number is a free-text field the TENANT fills in on
    // /setup under the label "Your Business Phone Number". Gating on it sent
    // "your HeyNikki number is live: <their own mobile>" minutes after signup
    // and permanently burned the send-once row, so the real assignment could
    // never be announced. assigned_did comes from the dids table, which only
    // an operator can write.
    when: t => !!t.assigned_did,
    messageType: "onboarding_number_live",
    params: t => [t.name, String(t.assigned_did)],
    body: t => `${t.name} — మీ HeyNikki number live! 📞 ${t.assigned_did}\n\n` +
      `ఈ number కి call చేసి Nikki ని మీరే test చేయండి. ` +
      `ప్రతి call మీ dashboard లో కనిపిస్తుంది.`,
  },
  {
    step: "setup_incomplete",
    // Only once they have a number. Nagging about setup before there is
    // anything to set up reads as spam, and it is.
    when: t => !!t.assigned_did && !t.profile_ready && t.hours_since_signup >= 24,
    messageType: "onboarding_setup_reminder",
    body: t => `${t.name} — మీ Nikki ఇంకా పూర్తిగా setup కాలేదు.\n\n` +
      `మీ services, timings చెప్తే Nikki మీ customers కి సరిగ్గా answer చేస్తుంది. ` +
      `Dashboard లో Setup page చూడండి.`,
  },
  {
    step: "credits_low",
    when: t => t.credit_minutes > 0 && t.credit_minutes <= 20 && !t.on_paid_plan,
    messageType: "onboarding_credits_low",
    body: t => `${t.name} — మీ free minutes అయిపోతున్నాయి (${Math.round(t.credit_minutes)} మిగిలాయి).\n\n` +
      `Calls ఆగిపోకుండా ఉండాలంటే plan activate చేయండి.`,
  },
];

async function sendStep(t: any, s: Step): Promise<void> {
  // Claim the step FIRST. If the send fails we still hold the row, and the
  // detail column says why — the alternative is a send that half-worked
  // being retried every fifteen minutes.
  const { error: claimErr } = await sb.from("onboarding_events").insert({
    tenant_id: t.id, step: s.step, to_number: t.phone, status: "sending",
  });
  if (claimErr) {
    // The unique index says this step was claimed before. That is final for
    // a step that SENT — but a step that FAILED had its one chance eaten by
    // whatever was wrong at the time (a Meta outage, a transient 500), and a
    // customer silently never receiving their welcome message is not an
    // acceptable resting state. Re-claim a failed step up to three times.
    const { data: prior } = await sb.from("onboarding_events")
      .select("status, attempts").eq("tenant_id", t.id).eq("step", s.step).maybeSingle();
    if (!prior || prior.status !== "failed" || (prior.attempts ?? 1) >= 3) return;
    const { error: reclaimErr } = await sb.from("onboarding_events")
      .update({ status: "sending" })
      .eq("tenant_id", t.id).eq("step", s.step).eq("status", "failed");
    if (reclaimErr) return;
    console.log(`[onboarding] retrying ${s.step} for ${t.name} (attempt ${(prior.attempts ?? 1) + 1})`);
  }

  let ok = false, detail = "";
  try {
    const r = await fetch(`${API}/api/whatsapp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL },
      body: JSON.stringify({
        to: t.phone, message: s.body(t), tenant_id: t.id,
        voice_profile_id: t.voice_profile_id, message_type: s.messageType,
        business_name: t.name,
        template_params: s.params ? s.params(t) : undefined,
      }),
    });
    const j: any = await r.json().catch(() => ({}));
    ok = r.ok && j.ok === true;
    detail = ok ? "" : `HTTP ${r.status} ${JSON.stringify(j).slice(0, 120)}`;
  } catch (e: any) {
    detail = e.message;
  }

  const { data: cur } = await sb.from("onboarding_events")
    .select("attempts").eq("tenant_id", t.id).eq("step", s.step).maybeSingle();
  await sb.from("onboarding_events")
    .update({
      status:   ok ? "sent" : "failed",
      detail:   detail || null,
      attempts: ok ? (cur?.attempts ?? 1) : (cur?.attempts ?? 0) + 1,
    })
    .eq("tenant_id", t.id).eq("step", s.step);

  console.log(`[onboarding] ${s.step} -> ${t.name} ${ok ? "sent" : "FAILED " + detail}`);
}

export async function runOnboarding(): Promise<void> {
  const { data: tenants, error } = await sb.from("tenants")
    .select("id, name, plan, status, credit_minutes, created_at");
  if (error) { console.error("[onboarding] tenant read failed:", error.message); return; }

  const PAID = ["starter", "growth", "scale"];

  for (const t of tenants || []) {
    // The owner's own number, captured at signup by handle_new_user. No
    // phone means no recipient: skip quietly rather than inventing one from
    // the business's DID, which would message the business's own callers.
    const { data: owner } = await sb.from("tenant_users")
      // Not .eq("role","owner"): a tenant whose only member is a
      // super_admin (the platform's own) got no onboarding messages at all.
      .select("phone").eq("tenant_id", t.id)
      .not("phone", "is", null).limit(1).maybeSingle();
    if (!owner?.phone) continue;

    const [{ data: profile }, { data: kyc }, { data: assigned }] = await Promise.all([
      sb.from("voice_profiles")
        .select("id, did_number, status, services, open_time")
        .eq("tenant_id", t.id).limit(1).maybeSingle(),
      sb.from("kyc_documents")
        .select("id").eq("tenant_id", t.id).eq("status", "approved").limit(1).maybeSingle(),
      // The only trustworthy answer to "does this business have a HeyNikki
      // number yet" — a row an operator assigned, not a field the customer
      // typed into a form.
      sb.from("dids")
        .select("number").eq("tenant_id", t.id).eq("status", "assigned")
        .limit(1).maybeSingle(),
    ]);

    const ctx = {
      ...t,
      phone: owner.phone,
      voice_profile_id: profile?.id || null,
      did_number: profile?.did_number || null,
      assigned_did: assigned?.number || null,
      // "Ready" means Nikki could actually answer a caller — a profile row
      // exists but says nothing about the business is not ready.
      profile_ready: !!(profile?.status === "active" && profile?.open_time &&
                        Array.isArray(profile?.services) && profile.services.length > 0),
      kyc_approved: !!kyc,
      on_paid_plan: PAID.includes(String(t.plan || "").toLowerCase()),
      hours_since_signup: (Date.now() - new Date(t.created_at).getTime()) / 3600000,
    };

    for (const s of STEPS) {
      if (s.when(ctx)) await sendStep(ctx, s);
    }
  }
}
