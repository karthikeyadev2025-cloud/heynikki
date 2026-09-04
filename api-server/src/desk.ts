/**
 * The Human Desk — the tenant-facing side of the Human CRM Seat.
 *
 * Everything the seat needs already existed on the server: click-to-call
 * (esl.ts clickToCall — rings the seat's mobile, then the customer),
 * routing_mode on the DID (ai / hybrid / human — the pipeline hands a
 * 'human' call to the ring group at call start, 'hybrid' when the caller
 * asks), and the ring group built from tenant_users.phone. None of it had a
 * door in the dashboard: routing_mode could only be changed from the
 * super-admin table, seat phones lived on one field on /setup, and the only
 * dial button sat on a lead card. So a paid line item was invisible to the
 * person paying for it. These routes are the door.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

type Deps = {
  sb:          SupabaseClient;
  verifyJWT:   (req: Request, res: Response, next: NextFunction) => void;
  apiLimiter:  any;
  getTenantId: (userId: string) => Promise<string | null>;
  audit:       (action: string, ctx: any) => Promise<void>;
  supabaseUrl: string;
  supabaseKey: string;
};

const ROUTING = ["ai", "hybrid", "human"] as const;
const last10  = (n: unknown) => String(n || "").replace(/\D/g, "").slice(-10);

export function mountDeskRoutes(app: Express, d: Deps) {
  const { sb, verifyJWT, apiLimiter, getTenantId, audit } = d;

  async function membership(userId: string, tenantId: string) {
    const { data } = await sb.from("tenant_users")
      .select("id, role, phone, display_name")
      .eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    return data;
  }
  const isOwner = (m: any) => !!m && ["owner", "super_admin"].includes(m.role);

  // GET /api/desk — who answers, who rings, what the seat did lately.
  app.get("/api/desk", verifyJWT, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });

    const [{ data: did }, { data: members }, { data: recent }, me] = await Promise.all([
      sb.from("dids").select("number, routing_mode, missed_call_guard")
        .eq("tenant_id", tenantId).eq("status", "assigned").limit(1).maybeSingle(),
      sb.from("tenant_users").select("id, user_id, role, phone, display_name")
        .eq("tenant_id", tenantId).order("created_at", { ascending: true }),
      sb.from("click_to_call_log")
        .select("id, agent_user_id, lead_id, callee_number, disposition, notes, duration_seconds, created_at, freeswitch_uuid")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(30),
      membership(req.user.id, tenantId),
    ]);
    // Incoming calls that reached people: answered by a seat (transferred)
    // or rang out to the guard (missed). Seven days — this is a to-do list,
    // not an archive; /calls has the rest.
    const { data: teamRows } = await sb.from("calls")
      .select("id, caller_number, status, duration_seconds, created_at, wa_sent, recording_url, r2_object_key")
      .eq("tenant_id", tenantId).eq("direction", "inbound").in("status", ["transferred", "missed"])
      .gte("created_at", new Date(Date.now() - 7 * 86400e3).toISOString())
      .order("created_at", { ascending: false }).limit(20);

    // Emails live in auth, not tenant_users; a seat with neither a name nor
    // an email is a UUID, which nobody can ring.
    const seats = [];
    for (const m of members || []) {
      const r = await fetch(`${d.supabaseUrl}/auth/v1/admin/users/${m.user_id}`,
        { headers: { apikey: d.supabaseKey, Authorization: `Bearer ${d.supabaseKey}` } });
      const u: any = r.ok ? await r.json() : {};
      seats.push({
        id: m.id, user_id: m.user_id, role: m.role, phone: m.phone || null,
        display_name: m.display_name || null, email: u?.email || null,
        is_you: m.user_id === req.user.id,
      });
    }

    // Names for the recent-calls list: the lead the number belongs to, and
    // which seat placed the call.
    const leadIds = Array.from(new Set((recent || []).map((r: any) => r.lead_id).filter(Boolean)));
    const teamPhones = Array.from(new Set((teamRows || []).map((c: any) => last10(c.caller_number)).filter((p: string) => p.length === 10)));
    const [{ data: leads }, { data: phoneLeads }] = await Promise.all([
      leadIds.length ? sb.from("leads").select("id, name, phone, stage").in("id", leadIds) : Promise.resolve({ data: [] as any[] }),
      teamPhones.length ? sb.from("leads").select("id, name, phone").eq("tenant_id", tenantId).in("phone", teamPhones) : Promise.resolve({ data: [] as any[] }),
    ]);
    const leadById    = new Map((leads || []).map((l: any) => [l.id, l]));
    const leadByPhone = new Map((phoneLeads || []).map((l: any) => [l.phone, l]));
    const seatByUser = new Map(seats.map(s => [s.user_id, s]));

    res.json({
      did:           did?.number || null,
      routing_mode:  did?.routing_mode || "ai",
      seats,
      ring_count:    seats.filter(s => s.phone).length,
      you:           me ? { id: me.id, role: me.role, phone: me.phone || null, display_name: me.display_name || null } : null,
      you_are_owner: isOwner(me),
      team_calls: (teamRows || []).map((c: any) => {
        const n = last10(c.caller_number);
        const l = leadByPhone.get(n);
        return {
          id: c.id, number: n, status: c.status, duration_seconds: c.duration_seconds || 0,
          created_at: c.created_at, wa_sent: !!c.wa_sent,
          has_recording: !!(c.recording_url || c.r2_object_key),
          lead_id: l?.id || null, lead_name: l?.name || null,
        };
      }),
      recent: (recent || []).map((r: any) => {
        const l = leadById.get(r.lead_id);
        const s = seatByUser.get(r.agent_user_id);
        return {
          id: r.id, number: last10(r.callee_number), lead_id: r.lead_id,
          lead_name: l?.name || null, lead_stage: l?.stage || null,
          by: s?.display_name || s?.email || null,
          disposition: r.disposition, notes: r.notes,
          duration_seconds: r.duration_seconds || 0, created_at: r.created_at,
          live: !r.disposition && !r.duration_seconds
                && Date.now() - new Date(r.created_at).getTime() < 2 * 3600e3,
        };
      }),
    });
  });

  // POST /api/desk/routing { routing_mode } — owner only. 'human' and
  // 'hybrid' ring the seats' phones, so both refuse to switch on with nobody
  // to ring: the server would fall back to the AI and the owner would think
  // the desk was live.
  app.post("/api/desk/routing", verifyJWT, apiLimiter, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    const me = await membership(req.user.id, tenantId);
    if (!isOwner(me)) return res.status(403).json({ error: "Only the owner can change who answers calls." });

    const mode = String(req.body?.routing_mode || "");
    if (!(ROUTING as readonly string[]).includes(mode)) {
      return res.status(400).json({ error: "routing_mode must be ai, hybrid or human" });
    }
    if (mode !== "ai") {
      const { count } = await sb.from("tenant_users")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).not("phone", "is", null);
      if (!count) {
        return res.status(409).json({
          error: "Nobody has a phone number yet. Add at least one seat's mobile below, then switch.",
        });
      }
    }
    const { data: did, error } = await sb.from("dids")
      .update({ routing_mode: mode })
      .eq("tenant_id", tenantId).eq("status", "assigned")
      .select("number");
    if (error) return res.status(500).json({ error: error.message });
    if (!did?.length) return res.status(409).json({ error: "No number is assigned to this account yet." });

    await audit("desk.routing_changed", {
      tenantId, actorId: req.user.id, req, metadata: { routing_mode: mode, numbers: did.map((x: any) => x.number) },
    });
    res.json({ ok: true, routing_mode: mode });
  });

  // POST /api/desk/seat { member_id?, phone, display_name } — a person edits
  // their own row; the owner edits anyone's. phone null/"" clears it, which
  // simply drops that seat from the ring group.
  app.post("/api/desk/seat", verifyJWT, apiLimiter, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    const me = await membership(req.user.id, tenantId);
    if (!me) return res.status(403).json({ error: "No seat" });

    const memberId = String(req.body?.member_id || me.id);
    if (memberId !== me.id && !isOwner(me)) {
      return res.status(403).json({ error: "Only the owner can edit another seat." });
    }
    const patch: Record<string, any> = {};
    if (req.body?.phone !== undefined) {
      const digits = last10(req.body.phone);
      if (digits && !/^[6-9]\d{9}$/.test(digits)) {
        return res.status(400).json({ error: "Enter a 10-digit Indian mobile number." });
      }
      patch.phone = digits || null;
    }
    if (req.body?.display_name !== undefined) {
      patch.display_name = String(req.body.display_name).trim().slice(0, 60) || null;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change" });

    const { error } = await sb.from("tenant_users").update(patch)
      .eq("id", memberId).eq("tenant_id", tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, ...patch });
  });
}
