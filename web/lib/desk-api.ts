// lib/desk-api.ts — one way to call the API as the signed-in person.
import { createClient } from "./supabase";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

/** GET when there is no body, POST when there is. Throws the API's own words. */
export async function deskApi(path: string, body?: any): Promise<any> {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session) { window.location.href = "/login"; throw new Error("Signed out"); }
  const r = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
