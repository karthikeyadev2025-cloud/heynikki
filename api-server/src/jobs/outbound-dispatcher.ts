/**
 * Outbound campaign dispatcher.
 *
 * Polls every 30 seconds for running campaigns. For each, it:
 *   1. Checks current IST hour is inside the campaign's window
 *   2. Pulls up to (max_concurrent - in_progress_count) recipients
 *      that are status='queued' or status='pending' (pending => scrub first)
 *   3. For 'pending': runs DND scrubbing, marks blocked_dnd or queued
 *   4. For 'queued': dispatches to the voice-pipeline /outbound endpoint
 *   5. Marks completed when all recipients are settled
 *
 * Run as a systemd service (nikki-outbound-dispatcher.service) — single
 * long-lived process. Multi-instance dispatching is NOT safe yet because
 * we don't lock recipient rows during pickup; that's a future enhancement
 * via SELECT FOR UPDATE SKIP LOCKED.
 *
 * TRAI: DND scrubbing is currently a STUB. Wire a real provider (Exotel,
 * KMS, or TRAI direct feed) into scrubDnd() before launching to numbers
 * that DON'T have explicit consent.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const PIPELINE_URL  = process.env.PIPELINE_URL || "https://pipeline.jovio.in";
const INTERNAL_SEC  = process.env.INTERNAL_SECRET!;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const POLL_INTERVAL_MS = 30_000;

// ─── DND scrubbing ────────────────────────────────────
// TODO: replace this stub with an actual TRAI NCPR provider call.
//
// CONSENT CARVE-OUT — this comment used to say "only campaigns where ALL
// recipients have consent_call_id should be allowed in production" but
// that carve-out was never implemented; every recipient hit the same
// fail-safe block. isConsented finally builds it: an instant lead-capture
// row (someone who just submitted the business's own enquiry form) can
// skip third-party DND scrubbing IF the tenant has explicitly opted in
// via voice_profiles.skip_dnd_for_instant_leads. Bulk campaign dialing
// is completely untouched by this — it always requires either a real
// DND_SCRUB_PROVIDER_URL or stays blocked, exactly as before.
async function scrubDnd(
  phone: string,
  isConsented: boolean = false
): Promise<{ blocked: boolean; reason?: string }> {
  if (isConsented) {
    return { blocked: false, reason: "self_submitted_enquiry_consent" };
  }
  if (!process.env.DND_SCRUB_PROVIDER_URL) {
    console.warn(`[dispatcher] DND_SCRUB_PROVIDER_URL not set — phone ${phone} unscrubbed`);
    // Fail SAFE: if we can't scrub and it's not consent-based, block.
    return { blocked: true, reason: "scrubbing_unavailable" };
  }
  try {
    const r = await fetch(`${process.env.DND_SCRUB_PROVIDER_URL}/check?phone=${encodeURIComponent(phone)}`, {
      headers: { Authorization: `Bearer ${process.env.DND_SCRUB_PROVIDER_TOKEN || ""}` },
    });
    if (!r.ok) return { blocked: true, reason: "scrub_provider_error" };
    const j = await r.json() as { on_dnd?: boolean; reason?: string };
    return { blocked: !!j.on_dnd, reason: j.reason };
  } catch (e) {
    console.error("[dispatcher] scrub error:", e);
    return { blocked: true, reason: "scrub_exception" };
  }
}

// ─── Pipeline dispatch ────────────────────────────────
// `campaign` is null for instant (is_instant=true) recipients — there is
// no campaign row to pull voice_profile_id or a script from, so those
// come from the recipient row itself for that case.
async function dispatchCall(recipient: any, campaign: any | null): Promise<string | null> {
  const rawScript = campaign
    ? campaign.script
    // Default callback script for a self-submitted enquiry — short,
    // because this is a callback the person is expecting, not a cold
    // pitch. Businesses can override per-lead via metadata.script later.
    : (recipient.metadata?.script ||
       "Hi {{first_name}}, this is Hey Nikki calling about your enquiry. Do you have a moment?");
  const script = rawScript
    .replace(/\{\{first_name\}\}/g,    recipient.first_name || "there")
    .replace(/\{\{business_name\}\}/g, campaign?.business_name || "");

  try {
    const r = await fetch(`${PIPELINE_URL}/outbound`, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-internal-secret": INTERNAL_SEC,
      },
      body: JSON.stringify({
        tenant_id:        recipient.tenant_id,
        voice_profile_id: campaign?.voice_profile_id || recipient.voice_profile_id || null,
        to_number:        recipient.phone,
        script,
        recipient_id:     recipient.id,
      }),
    });
    if (!r.ok) {
      console.error(`[dispatcher] pipeline ${r.status}:`, await r.text());
      return null;
    }
    const j = await r.json() as { call_id?: string };
    return j.call_id || null;
  } catch (e) {
    console.error("[dispatcher] dispatch exception:", e);
    return null;
  }
}

// ─── Hours check (recipient timezone assumed IST for now) ───
function withinWindow(start: string, end: string): boolean {
  const now = new Date();
  // IST = UTC+5:30
  const istMinutes  = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % (24 * 60);
  const [sH, sM]    = start.split(":").map(Number);
  const [eH, eM]    = end.split(":").map(Number);
  const startMin    = sH * 60 + sM;
  const endMin      = eH * 60 + eM;
  return istMinutes >= startMin && istMinutes < endMin;
}

async function tick(): Promise<void> {
  const { data: campaigns } = await sb.from("outbound_campaigns")
    .select("*").eq("status", "running");

  for (const c of (campaigns || [])) {
    if (!withinWindow(c.window_start, c.window_end)) continue;

    // How many slots are free?
    const { count: inProgress } = await sb.from("outbound_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id).eq("status", "in_progress");
    const slots = (c.max_concurrent || 3) - (inProgress || 0);
    if (slots <= 0) continue;

    // First, scrub any pending. Then dispatch queued.
    const { data: pending } = await sb.from("outbound_recipients")
      .select("*").eq("campaign_id", c.id).eq("status", "pending").limit(slots);

    for (const r of (pending || [])) {
      await sb.from("outbound_recipients").update({ status: "scrubbing" }).eq("id", r.id);
      // Campaign (bulk list) recipients are never treated as consented —
      // that carve-out is only for is_instant rows, handled in tickInstant.
      const { blocked, reason } = await scrubDnd(r.phone, false);
      await sb.from("outbound_recipients").update({
        status:       blocked ? "blocked_dnd" : "queued",
        scrubbed_at:  new Date().toISOString(),
        dnd_blocked:  blocked,
        metadata:     { ...r.metadata, scrub_reason: reason },
      }).eq("id", r.id);
    }

    // Dispatch queued recipients
    const { data: queued } = await sb.from("outbound_recipients")
      .select("*").eq("campaign_id", c.id).eq("status", "queued").limit(slots);

    for (const r of (queued || [])) {
      await sb.from("outbound_recipients").update({
        status:       "in_progress",
        attempts:     r.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      }).eq("id", r.id);

      const callId = await dispatchCall(r, c);
      if (callId) {
        await sb.from("outbound_recipients").update({
          call_id: callId,
        }).eq("id", r.id);
      } else {
        // Failed to even start the call — back off, retry tomorrow
        await sb.from("outbound_recipients").update({
          status: r.attempts >= 3 ? "failed" : "queued",
          next_attempt_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }).eq("id", r.id);
      }
    }

    // Mark campaign completed if no more work
    const { count: remaining } = await sb.from("outbound_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .in("status", ["pending", "queued", "in_progress", "scrubbing"]);
    if ((remaining || 0) === 0) {
      await sb.from("outbound_campaigns").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", c.id);
    }
  }
}

// ─── Instant lead-capture dispatch ─────────────────────
// Handles is_instant=true recipients — one-off callbacks for a lead who
// just submitted the business's own enquiry form, created by
// POST /webhooks/lead-capture/:token. These have no campaign_id, so
// tick() above (which is scoped per-campaign) never sees them.
// Capped at 20 dispatches per tick (every 30s) so a burst of form
// submissions can't overwhelm Exotel or a single tenant's concurrency.
async function tickInstant(): Promise<void> {
  const { data: pending } = await sb.from("outbound_recipients")
    .select("*").eq("is_instant", true).eq("status", "pending").limit(20);

  for (const r of (pending || [])) {
    // Whether THIS tenant has opted in to skipping third-party DND
    // scrubbing for self-submitted enquiries. Default false — the
    // business must explicitly choose this in Setup.
    const { data: profile } = await sb.from("voice_profiles")
      .select("skip_dnd_for_instant_leads")
      .eq("tenant_id", r.tenant_id).limit(1).maybeSingle();
    const consented = !!profile?.skip_dnd_for_instant_leads;

    await sb.from("outbound_recipients").update({ status: "scrubbing" }).eq("id", r.id);
    const { blocked, reason } = await scrubDnd(r.phone, consented);
    if (blocked) {
      await sb.from("outbound_recipients").update({
        status: "blocked_dnd", scrubbed_at: new Date().toISOString(),
        dnd_blocked: true, metadata: { ...r.metadata, scrub_reason: reason },
      }).eq("id", r.id);
      continue;
    }

    await sb.from("outbound_recipients").update({
      status: "in_progress", scrubbed_at: new Date().toISOString(), dnd_blocked: false,
    }).eq("id", r.id);

    const callId = await dispatchCall(r, null);
    if (callId) {
      await sb.from("outbound_recipients").update({ call_id: callId }).eq("id", r.id);
    } else {
      // One-off leads don't get a 24h retry cycle like campaigns —
      // the moment has passed; a failed instant callback just fails.
      await sb.from("outbound_recipients").update({ status: "failed" }).eq("id", r.id);
    }
  }
}

async function main() {
  console.log("[dispatcher] started");
  while (true) {
    try {
      await tick();
      await tickInstant();
    } catch (e) {
      console.error("[dispatcher] tick error:", e);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
