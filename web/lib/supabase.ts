// lib/supabase.ts
import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Single browser client - used everywhere in client components
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON);
}

// Alias for compatibility
export const createServerSupabase = createClient;

// ── Types ─────────────────────────────────────────────
export type CallRecord = {
  id: string;
  tenant_id: string;
  voice_profile_id: string;
  caller_number: string;
  direction: "inbound" | "outbound";
  status: "active" | "completed" | "missed" | "transferred" | "failed";
  duration_seconds: number;
  transcript: Array<{ role: string; content: string; ts: string }>;
  intent: string;
  recording_url: string | null;
  // Where recordings actually live — recording_url has never been written.
  r2_object_key?: string | null;
  wa_sent: boolean;
  appointment_created: boolean;
  created_at: string;
};

export type Appointment = {
  id: string;
  caller_name: string | null;
  caller_number: string;
  service: string | null;
  slot_date: string | null;
  slot_time: string | null;
  status: string;
  wa_confirmed: boolean;
  booking_ref?: string | null;
  created_at: string;
};

export type VoiceProfile = {
  id: string;
  tenant_id: string;
  profile_sku: string;
  display_name: string | null;
  business_name: string;
  open_time: string;
  close_time: string;
  open_days: string[];
  services: string[];
  appointment_types: string[];
  whatsapp_number: string | null;
  did_number: string | null;
  status: string;
  dialect_region?: string | null;
  capture_token?: string | null;
  auto_whatsapp_new_leads?: boolean;
  auto_call_new_leads?: boolean;
  skip_dnd_for_instant_leads?: boolean;
};

export type Tenant = {
  id: string;
  name: string;
  plan: string;
  status: string;
  trial_ends_at: string;
  // The balance that actually gates a free account.
  credit_minutes?: number | null;
  wallet_balance: number;
};

export type CallMinutes = {
  used_seconds: number;
  plan_limit_seconds: number;
};
