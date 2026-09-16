/**
 * Who in a tenant may change what — the API's half of migration 039.
 *
 * 039 put owner-only rules on voice_profiles and outbound_campaigns as RLS
 * policies. Every route in this server talks to Supabase with the SERVICE
 * key, which bypasses RLS entirely, so none of those policies applied to a
 * request that came through here: a member could set the negotiation floor,
 * start a campaign, mint an API key or buy a plan through the API that the
 * database would have refused them directly. The rule has to be enforced
 * again at this layer, and one copy of it is the only way the two layers
 * stay saying the same thing.
 *
 * The split is 039's, not a new one: anyone on the team works leads, calls
 * and appointments; only an owner changes what the business says, what it
 * charges, and what it spends.
 */
import type { Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

export const OWNER_ROLES = ["owner", "super_admin"];

export async function tenantRole(sb: SupabaseClient, userId: string, tenantId: string): Promise<string | null> {
  const { data, error } = await sb.from("tenant_users")
    .select("role").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
  // A failed lookup is not a member and certainly not an owner. Fail closed.
  if (error) {
    console.error("[roles] role lookup failed:", error.message);
    return null;
  }
  return data?.role ?? null;
}

/**
 * true when the caller is an owner of tenantId. Otherwise answers 403 with
 * `message` and returns false, so a route reads:
 *   if (!(await requireOwner(sb, req.user.id, tenantId, res, "..."))) return;
 */
export async function requireOwner(sb: SupabaseClient, userId: string, tenantId: string,
                                   res: Response, message: string): Promise<boolean> {
  const role = await tenantRole(sb, userId, tenantId);
  if (role && OWNER_ROLES.includes(role)) return true;
  res.status(403).json({ error: message, code: "owner_only" });
  return false;
}
