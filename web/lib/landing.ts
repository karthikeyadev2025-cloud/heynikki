import { createClient } from "./supabase";

/** One app, one login — the role decides which desk opens.
 *  owner/super_admin → Reception (owner console), member/support → Human Desk. */
export async function landingFor(sb: ReturnType<typeof createClient>): Promise<string> {
  try {
    const { data } = await sb.auth.getUser();
    if (!data.user) return "/dashboard";
    const { data: tu } = await sb.from("tenant_users").select("role").eq("user_id", data.user.id).single();
    const role = tu?.role || "owner";
    if (role === "member" || role === "support") return "/desk";
    return "/dashboard";
  } catch { return "/dashboard"; }
}

