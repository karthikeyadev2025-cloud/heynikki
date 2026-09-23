/**
 * The number an outgoing call shows as caller ID.
 *
 * Every outbound path used to take "any assigned DID" with limit(1), so a
 * business with three numbers always dialled out as the same one and could
 * not keep its published number for incoming calls. dids.use_for_outbound
 * (064) marks the numbers outgoing calls may use.
 *
 * The CLI MUST be a number this tenant owns — a spoofed caller ID on an
 * Indian trunk gets the trunk suspended. Everything returned here is an
 * assigned DID of the tenant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type OutboundDid = { number: string; voice_profile_id: string | null };

/**
 * The tenant's numbers that outgoing calls may show, in a stable order.
 * When none is marked (every number set to incoming-only, or 064 not yet
 * applied) it falls back to all assigned numbers: a call from the "wrong"
 * number of the business beats a call that cannot be placed.
 */
export async function outboundDids(sb: SupabaseClient, tenantId: string): Promise<OutboundDid[]> {
  const { data, error } = await sb.from("dids")
    .select("number, voice_profile_id, use_for_outbound")
    .eq("tenant_id", tenantId).eq("status", "assigned")
    .order("number", { ascending: true });
  if (error) {
    // 064 not applied yet: the column does not exist. Behave as before.
    const { data: any } = await sb.from("dids")
      .select("number, voice_profile_id")
      .eq("tenant_id", tenantId).eq("status", "assigned")
      .order("number", { ascending: true });
    return (any || []) as OutboundDid[];
  }
  const all = (data || []) as (OutboundDid & { use_for_outbound: boolean | null })[];
  const marked = all.filter(d => d.use_for_outbound !== false);
  if (!marked.length && all.length) {
    console.warn(`[outbound-cli] tenant ${tenantId} has every number set to incoming-only — dialling from ${all[0].number}`);
  }
  return (marked.length ? marked : all).map(({ number, voice_profile_id }) => ({ number, voice_profile_id }));
}

/**
 * One of the numbers, chosen by the customer's number: the calls spread
 * across the outgoing numbers, and the same customer always sees the same
 * one — so a callback lands on the number they were rung from.
 */
export function pickFor(dids: OutboundDid[], customer: string): OutboundDid | null {
  if (!dids.length) return null;
  const digits = String(customer || "").replace(/\D/g, "").slice(-10);
  let h = 0;
  for (const ch of digits) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return dids[h % dids.length];
}

export async function outboundCli(sb: SupabaseClient, tenantId: string, customer: string): Promise<OutboundDid | null> {
  return pickFor(await outboundDids(sb, tenantId), customer);
}
