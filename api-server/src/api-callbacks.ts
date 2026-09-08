/**
 * Callbacks for calls placed over the public API.
 *
 * POST /api/v1/calls/outbound accepts a callback_url. When the call is over
 * — answered, unanswered, blocked, or never dialled — this module tells that
 * URL what happened, once. Both the dispatcher (a call that could not be
 * dialled) and the API server's hangup hook (a call that rang) end up here,
 * so the payload and the signature are defined in exactly one place.
 *
 * Delivery is at-least-once with a short retry ladder and a delivered_at
 * stamp in metadata; a retry after a crash therefore re-sends rather than
 * losing the event, and the receiver dedupes on `id` if it cares.
 */
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const API_CALL_SOURCE = "api_reminder";

/** What the receiver gets. Documented at /developers — change both. */
export type OutboundCallPayload = {
  event:            "outbound_call.completed";
  id:               string;
  reference:        string | null;
  phone:            string;
  name:             string | null;
  purpose:          string;
  status:           "completed" | "failed" | "blocked";
  outcome:          string;
  call_id:          string | null;
  duration_seconds: number;
  answered:         boolean;
  /** Set only when the call was answered and the pipeline could judge it. */
  result:           { delivered: boolean; customer_response: string; note: string } | null;
  metadata:         Record<string, unknown>;
  requested_at:     string;
  completed_at:     string;
};

/** Public shape of an API-placed call — the same object every /api/v1/calls/outbound route returns. */
export function publicOutboundCall(r: any): Record<string, unknown> {
  const md = r.metadata || {};
  const status = publicStatus(r.status);
  return {
    id:               r.id,
    reference:        r.reference ?? md.reference ?? null,
    phone:            r.phone,
    name:             r.first_name || null,
    purpose:          md.purpose || "reminder",
    message:          md.message || "",
    status,
    outcome:          r.outcome || null,
    call_id:          r.call_id || null,
    duration_seconds: md.duration_seconds ?? 0,
    answered:         status === "completed" && r.outcome === "answered",
    result:           md.result || null,
    not_before:       r.next_attempt_at || null,
    attempts:         r.attempts || 0,
    metadata:         md.api_metadata || {},
    requested_at:     r.created_at,
    completed_at:     md.completed_at || null,
    callback:         md.callback_url
      ? { url: md.callback_url, delivered_at: md.callback_delivered_at || null, error: md.callback_error || null }
      : null,
  };
}

/** The recipient state machine, translated for someone who never sees it. */
export function publicStatus(s: string): string {
  switch (s) {
    case "pending": case "scrubbing": case "queued": return "queued";
    case "in_progress":  return "calling";
    case "completed":    return "completed";
    case "blocked_dnd":  return "blocked";
    case "opted_out":    return "blocked";
    default:             return "failed";
  }
}

export function signCallback(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

const RETRY_MS = [0, 15_000, 60_000, 300_000];     // now, 15 s, 1 min, 5 min

/**
 * Deliver the completion callback for one recipient. Safe to call more
 * than once and from more than one process: it re-reads the row, skips
 * rows that are not API-placed or not finished, and records delivery.
 */
export async function notifyApiCallback(sb: SupabaseClient, recipientId: string, log = console): Promise<void> {
  const { data: r, error } = await sb.from("outbound_recipients")
    .select("id, tenant_id, phone, first_name, status, outcome, call_id, attempts, reference, metadata, created_at")
    .eq("id", recipientId).maybeSingle();
  if (error || !r) { if (error) log.error(`[api-callback] ${recipientId}: ${error.message}`); return; }
  const md = (r.metadata || {}) as Record<string, any>;
  if (md.source !== API_CALL_SOURCE) return;
  if (["pending", "scrubbing", "queued", "in_progress"].includes(r.status)) return;   // not over yet
  if (md.callback_delivered_at) return;

  // Duration comes from the calls row the hangup hook linked; the
  // recipient itself never learns it.
  let duration = 0;
  if (r.call_id) {
    const { data: c } = await sb.from("calls").select("duration_seconds").eq("id", r.call_id).maybeSingle();
    duration = c?.duration_seconds || 0;
  }
  const completedAt = md.completed_at || new Date().toISOString();
  const status = publicStatus(r.status) as OutboundCallPayload["status"];
  const payload: OutboundCallPayload = {
    event:            "outbound_call.completed",
    id:               r.id,
    reference:        r.reference ?? md.reference ?? null,
    phone:            r.phone,
    name:             r.first_name || null,
    purpose:          md.purpose || "reminder",
    status,
    outcome:          r.outcome || "",
    call_id:          r.call_id || null,
    duration_seconds: duration,
    answered:         status === "completed" && r.outcome === "answered",
    result:           md.result || null,
    metadata:         md.api_metadata || {},
    requested_at:     r.created_at,
    completed_at:     completedAt,
  };
  // The duration is remembered on the row so GET /calls/outbound/:id can
  // answer without a join, whether or not there is a callback to deliver.
  const stamp: Record<string, unknown> = { ...md, duration_seconds: duration, completed_at: completedAt };

  if (!md.callback_url) {
    await sb.from("outbound_recipients").update({ metadata: stamp }).eq("id", r.id);
    return;
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent":   "HeyNikki-Callback/1.0",
    "X-Nikki-Event": payload.event,
    "X-Nikki-Delivery": crypto.randomUUID(),
  };
  if (md.callback_secret) headers["X-Nikki-Signature"] = signCallback(String(md.callback_secret), body);

  let lastErr = "";
  for (let i = 0; i < RETRY_MS.length; i++) {
    if (RETRY_MS[i]) await new Promise(res => setTimeout(res, RETRY_MS[i]));
    try {
      const resp = await fetch(md.callback_url, {
        method: "POST", headers, body, signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        await sb.from("outbound_recipients").update({
          metadata: { ...stamp, callback_delivered_at: new Date().toISOString(), callback_error: null },
        }).eq("id", r.id);
        log.log(`[api-callback] ${r.id} → ${md.callback_url} ${resp.status}`);
        return;
      }
      lastErr = `HTTP ${resp.status}`;
      // 4xx other than 408/429 is the receiver saying "no" — stop retrying.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) break;
    } catch (e: any) {
      lastErr = String(e?.name === "TimeoutError" ? "timeout" : e?.message || e).slice(0, 120);
    }
  }
  log.error(`[api-callback] ${r.id} → ${md.callback_url} failed: ${lastErr}`);
  await sb.from("outbound_recipients").update({
    metadata: { ...stamp, callback_error: lastErr, callback_failed_at: new Date().toISOString() },
  }).eq("id", r.id);
}
