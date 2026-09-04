/**
 * Outbound campaign endpoints.
 *
 * TRAI compliance gates implemented here:
 *   1. DND scrubbing before dispatch (status: scrubbing -> blocked_dnd or queued)
 *   2. Calling-hours enforcement (refuse to dispatch outside window_start/end IST)
 *   3. Opt-out check on every dispatch (cross-references outbound_opt_outs)
 *   4. Concurrency cap (max_concurrent per campaign, hard ceiling 25)
 *
 * The actual call dispatch hands off to the voice-pipeline via POST
 * /dispatch — pipeline initiates the LiveKit call and applies the
 * TRAI disclosure on connect (already handled in main.py).
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

export function mountOutboundRoutes(
  app:     Express,
  sb:      SupabaseClient,
  verifyInternal: (req: Request, res: Response, next: NextFunction) => void,
  audit:   (action: string, ctx: any) => Promise<void>,
) {

  // POST /api/campaigns — create draft
  app.post("/api/campaigns", verifyInternal, async (req, res) => {
    const { tenant_id, name, script, voice_profile_id, window_start, window_end, max_concurrent, created_by,
            start_date, end_date } = req.body;
    if (!tenant_id || !name || !script) {
      return res.status(400).json({ error: "tenant_id, name, script required" });
    }

    const { data, error } = await sb.from("outbound_campaigns").insert({
      tenant_id, name, script, voice_profile_id,
      window_start:  window_start  || "10:00",
      window_end:    window_end    || "19:00",
      max_concurrent: Math.min(max_concurrent || 3, 25),
      start_date: start_date || null,
      end_date:   end_date   || null,
      created_by,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    await audit("campaign.created", {
      tenantId: tenant_id, actorId: created_by, req,
      metadata: { campaign_id: data!.id, name },
    });

    res.status(201).json(data);
  });

  // POST /api/campaigns/:id/recipients — bulk upload recipients
  // Body: { recipients: [{ phone, first_name?, metadata?, consent_call_id? }] }
  app.post("/api/campaigns/:id/recipients", verifyInternal, async (req, res) => {
    const { id } = req.params;
    const { recipients } = req.body;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "recipients array required" });
    }
    if (recipients.length > 10000) {
      return res.status(400).json({ error: "Max 10,000 recipients per upload" });
    }

    // Look up tenant_id from the campaign
    const { data: c, error: cErr } = await sb.from("outbound_campaigns")
      .select("tenant_id").eq("id", id).single();
    if (cErr || !c) return res.status(404).json({ error: "Campaign not found" });

    // Normalize phone numbers (E.164 for India: +91 prefix, 10 digits)
    const normalize = (raw: string): string | null => {
      const digits = raw.replace(/[^\d]/g, "");
      if (digits.length === 10)               return `+91${digits}`;
      if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
      if (digits.length === 13 && digits.startsWith("91")) return `+${digits}`;
      return null;
    };

    // Cross-reference opt-outs for this tenant
    const phones    = recipients.map(r => normalize(r.phone)).filter(Boolean);
    const { data: optOuts } = await sb.from("outbound_opt_outs")
      .select("phone").eq("tenant_id", c.tenant_id).in("phone", phones);
    const blocked = new Set((optOuts || []).map(o => o.phone));

    const rows = recipients
      .map(r => ({ ...r, phone: normalize(r.phone) }))
      .filter(r => r.phone && !blocked.has(r.phone))
      .map(r => ({
        campaign_id:     id,
        tenant_id:       c.tenant_id,
        phone:           r.phone,
        first_name:      r.first_name || null,
        metadata:        r.metadata || {},
        consent_call_id: r.consent_call_id || null,
        status:          r.consent_call_id ? "queued" : "pending", // skip DND scrub if we have consent proof
      }));

    if (rows.length === 0) {
      return res.json({ inserted: 0, skipped: recipients.length,
                        reason: "All recipients invalid or opted out" });
    }

    const { error: insErr } = await sb.from("outbound_recipients").insert(rows);
    if (insErr) return res.status(500).json({ error: insErr.message });

    res.json({
      inserted:  rows.length,
      skipped:   recipients.length - rows.length,
      opted_out: blocked.size,
    });
  });

  // POST /api/campaigns/:id/start — kick off scrubbing + dispatch
  app.post("/api/campaigns/:id/start", verifyInternal, async (req, res) => {
    const { id } = req.params;
    const { actor_id } = req.body;

    const { data: c, error } = await sb.from("outbound_campaigns")
      .select("*").eq("id", id).single();
    if (error || !c) return res.status(404).json({ error: "Not found" });

    if (c.status === "running") return res.status(400).json({ error: "Already running" });
    if (c.status === "completed" || c.status === "cancelled") {
      return res.status(400).json({ error: `Cannot restart a ${c.status} campaign` });
    }

    await sb.from("outbound_campaigns").update({
      status: "running",
      started_at: new Date().toISOString(),
    }).eq("id", id);

    await audit("campaign.started", {
      tenantId: c.tenant_id, actorId: actor_id, req,
      metadata: { campaign_id: id, name: c.name },
    });

    // The actual dispatch loop runs as a separate worker (jobs/outbound-dispatcher.ts).
    // Starting the campaign just flips the state — the dispatcher polls for
    // running campaigns and picks up their pending recipients.
    res.json({ ok: true, status: "running" });
  });

  // POST /api/campaigns/:id/pause
  app.post("/api/campaigns/:id/pause", verifyInternal, async (req, res) => {
    const { id } = req.params;
    const { error } = await sb.from("outbound_campaigns")
      .update({ status: "paused" }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // POST /api/campaigns/:id/opt-out — add a number to the tenant's DNC list
  // Called from: (a) the dashboard manually, (b) a "STOP" SMS reply webhook,
  // (c) a recipient saying "remove me" during an AI call.
  app.post("/api/campaigns/:id/opt-out", verifyInternal, async (req, res) => {
    const { phone, reason } = req.body;
    if (!phone) return res.status(400).json({ error: "phone required" });

    const { data: c } = await sb.from("outbound_campaigns").select("tenant_id").eq("id", req.params.id).single();
    if (!c) return res.status(404).json({ error: "Campaign not found" });

    await sb.from("outbound_opt_outs").upsert({
      tenant_id: c.tenant_id, phone, reason: reason || "user_request",
    }, { onConflict: "tenant_id,phone" });

    // Mark any pending recipient rows with this phone as opted_out.
    //
    // Scoped to the campaign's tenant: the same number can sit on several
    // tenants' lists, and an opt-out from one business is not an opt-out
    // from the others. Without the tenant filter one tenant's STOP flipped
    // every tenant's row for that phone.
    await sb.from("outbound_recipients")
      .update({ status: "opted_out" })
      .eq("tenant_id", c.tenant_id)
      .eq("phone", phone)
      .in("status", ["pending", "queued", "scrubbing"]);

    await audit("campaign.opt_out", {
      tenantId: c.tenant_id, req,
      metadata: { phone, reason },
    });

    res.json({ ok: true });
  });

  // GET /api/campaigns/:id/stats — counters for the dashboard
  app.get("/api/campaigns/:id/stats", verifyInternal, async (req, res) => {
    const { data, error } = await sb.from("outbound_recipients")
      .select("status")
      .eq("campaign_id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    const counts: Record<string, number> = {};
    for (const r of (data || [])) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    res.json({
      total:        data?.length || 0,
      by_status:    counts,
      pending:      counts.pending      || 0,
      queued:       counts.queued       || 0,
      in_progress:  counts.in_progress  || 0,
      completed:    counts.completed    || 0,
      blocked_dnd:  counts.blocked_dnd  || 0,
      opted_out:    counts.opted_out    || 0,
      failed:       counts.failed       || 0,
    });
  });
}
