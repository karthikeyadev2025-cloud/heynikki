/**
 * What a telecaller does WHILE the customer is on the line.
 *
 * The Desk could dial, and after the call it could take an outcome and one
 * note. Everything a conversation actually produces — "send me the details",
 * "book me for Thursday at four", "my brother decides, call him" — had to
 * wait until the customer had gone, be remembered, and be done on three
 * other pages. This is the call screen's working half:
 *
 *   GET  /api/desk/workspace?phone=     what the screen needs for this number
 *   POST /api/desk/remark               add a remark (append-only, 075)
 *   POST /api/desk/appointment          book, with a WhatsApp confirmation
 *   POST /api/desk/appointment/:id      reschedule or cancel
 *
 * WhatsApp itself needs no new route: the brochure (/api/desk/whatsapp), an
 * approved template (/api/whatsapp/send-template) and a typed reply inside
 * Meta's 24-hour window (/api/whatsapp/send-as-tenant) already exist; the
 * workspace says which of them will work for this number right now.
 *
 * Everything keys on the PHONE NUMBER, not a lead id: an incoming call from
 * a number nobody has seen before must be bookable and remarkable in the
 * first ten seconds, and the lead is created quietly when it is needed.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneForms } from "./campaign-import";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Deps = {
  sb: SupabaseClient;
  verifyJWT: Mw;
  apiLimiter: Mw;
  getTenantId: (userId: string) => Promise<string | null>;
  audit: (action: string, o: any) => Promise<any>;
  /** Sends the booking confirmation the way the AI's own bookings do. */
  confirmAppointment: (o: { tenantId: string; voiceProfileId: string | null; businessName: string;
    phone: string; slotDate: string; slotTime: string; service: string | null; appointmentId: string }) => Promise<boolean>;
};

const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IST_MS = 5.5 * 3600_000;

/* ── pure helpers (tested) ──────────────────────────────────── */

/** A remark as it is stored: trimmed, one blank line at most, 2,000 chars. */
export function cleanRemark(v: unknown): string {
  return String(v ?? "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
}

/** A person's name as typed on a call: no control characters, 80 chars. */
export function cleanName(v: unknown): string {
  return String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export type SlotCheck =
  | { ok: true; warning: string | null }
  | { ok: false; error: string };

/**
 * Is this a slot a person may be booked into?
 *
 * Refused outright: a date or time that is not one, a moment already gone,
 * and anything more than a year out (a slipped year in a date picker).
 * Warned, not refused: a day or hour the business says it is closed —
 * a telecaller on the phone with the owner's blessing may know better than
 * the Setup page, so they are told and may go ahead.
 *
 * Dates and times are the business's own: IST, as every slot here is.
 */
export function checkSlot(
  slotDate: unknown, slotTime: unknown,
  hours: { open_days?: string[] | null; open_time?: string | null; close_time?: string | null },
  nowMs = Date.now(),
): SlotCheck {
  const d = String(slotDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(slotTime ?? "").match(/^(\d{2}):(\d{2})$/);
  if (!d) return { ok: false, error: "Pick a date." };
  if (!t) return { ok: false, error: "Pick a time." };
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  const utc = Date.UTC(y, mo - 1, da, h, mi) - IST_MS;
  const back = new Date(utc + IST_MS);
  if (h > 23 || mi > 59 || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== da) {
    return { ok: false, error: "That date or time doesn't exist." };
  }
  if (utc < nowMs - 5 * 60_000) return { ok: false, error: "That time has already passed." };
  if (utc > nowMs + 366 * 86400_000) return { ok: false, error: "That is more than a year away — check the date." };

  const day = DAYS[back.getUTCDay()];
  const openDays = (hours.open_days || []).map(x => String(x).slice(0, 3));
  if (openDays.length && !openDays.includes(day)) {
    return { ok: true, warning: `The business is marked closed on ${day}.` };
  }
  const mins = (s: unknown) => { const m = String(s ?? "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const open = mins(hours.open_time), close = mins(hours.close_time), at = h * 60 + mi;
  // open < close is an ordinary day. Anything else (overnight, or hours never
  // filled in) is not something to second-guess a booking with.
  if (open !== null && close !== null && open < close && (at < open || at >= close)) {
    return { ok: true, warning: `That is outside working hours (${hours.open_time}–${hours.close_time}).` };
  }
  return { ok: true, warning: null };
}

/** The remark as one line on a lead's notes, for before 075 is applied. */
export function remarkAsNote(body: string, author: string, nowMs = Date.now()): string {
  const d = new Date(nowMs + IST_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return `[${stamp}${author ? " " + author : ""}] ${body.replace(/\n+/g, " ")}`;
}

/* ── routes ─────────────────────────────────────────────────── */

export function mountDeskCallRoutes(app: Express, deps: Deps) {
  const { sb, verifyJWT, apiLimiter, getTenantId, audit } = deps;

  async function me(req: any, res: Response) {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) { res.status(403).json({ error: "No tenant" }); return null; }
    const { data: m } = await sb.from("tenant_users").select("id, role, display_name")
      .eq("tenant_id", tenantId).eq("user_id", req.user.id).maybeSingle();
    if (!m) { res.status(403).json({ error: "No seat" }); return null; }
    const name = cleanName(m.display_name) || String(req.user.email || "").split("@")[0] || "";
    return { tenantId, userId: req.user.id as string, name };
  }

  async function profile(tenantId: string) {
    const { data } = await sb.from("voice_profiles")
      .select("id, business_name, services, appointment_types, open_days, open_time, close_time")
      .eq("tenant_id", tenantId).eq("status", "active").limit(1).maybeSingle();
    return data || null;
  }

  async function findLead(tenantId: string, phone: string) {
    const { data } = await sb.from("leads").select("id, name, stage, notes, assigned_to")
      .eq("tenant_id", tenantId).in("phone", phoneForms(phone))
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    return data || null;
  }

  /** The lead for this number, created if this is the first anyone has heard of it. */
  async function ensureLead(tenantId: string, phone: string, name: string, userId: string) {
    const lead = await findLead(tenantId, phone);
    if (lead) {
      if (name && !lead.name) await sb.from("leads").update({ name }).eq("id", lead.id).eq("tenant_id", tenantId);
      return lead;
    }
    const { data, error } = await sb.from("leads").insert({
      tenant_id: tenantId, phone, name: name || null, stage: "contacted", source: "manual",
      intent: "other", score: 30, call_count: 0, assigned_to: userId,
      notes: "Added from the Human Desk",
    }).select("id, name, stage, notes, assigned_to").maybeSingle();
    if (error) console.error("[desk-call] lead insert:", error.message);
    return data || null;
  }

  // ── What the call screen needs for this number ────────────────────
  app.get("/api/desk/workspace", verifyJWT, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const phone = last10(req.query.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "phone required" });
    const forms = phoneForms(phone);
    const today = new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
    const [vp, lead, remarks, appts, lastIn, optOut] = await Promise.all([
      profile(who.tenantId),
      findLead(who.tenantId, phone),
      sb.from("lead_remarks").select("id, body, author_name, during_call, created_at")
        .eq("tenant_id", who.tenantId).eq("phone", phone)
        .order("created_at", { ascending: false }).limit(30),
      sb.from("appointments").select("id, caller_name, service, slot_date, slot_time, status, booking_ref, notes")
        .eq("tenant_id", who.tenantId).in("caller_number", forms).eq("status", "confirmed")
        .gte("slot_date", today).order("slot_date", { ascending: true }).limit(5),
      sb.from("wa_inbound").select("received_at").eq("tenant_id", who.tenantId)
        .like("from_number", `%${phone}`).order("received_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("outbound_opt_outs").select("phone").eq("tenant_id", who.tenantId).in("phone", forms).limit(1).maybeSingle(),
    ]);
    const lastAt = (lastIn as any).data?.received_at || null;
    res.json({
      phone,
      lead: lead ? { id: lead.id, name: lead.name, stage: lead.stage } : null,
      // 075 not applied yet: no timeline to show, and remarks go onto the
      // lead's notes instead (shown here so they are still visible).
      remarks_ready: !(remarks as any).error,
      remarks: (remarks as any).error ? [] : (remarks as any).data || [],
      legacy_notes: (remarks as any).error ? (lead?.notes || "") : "",
      appointments: (appts as any).data || [],
      business: vp ? {
        name: vp.business_name, services: vp.services || [], appointment_types: vp.appointment_types || [],
        open_days: vp.open_days || [], open_time: vp.open_time, close_time: vp.close_time,
      } : null,
      whatsapp: {
        opted_out: !!(optOut as any).data,
        // A typed message only arrives within 24 hours of THEIR last one.
        can_type: !!lastAt && Date.now() - new Date(lastAt).getTime() < 24 * 3600_000,
        last_message_at: lastAt,
      },
    });
  });

  // ── A remark ──────────────────────────────────────────────────────
  app.post("/api/desk/remark", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const phone = last10(req.body?.phone);
    const body = cleanRemark(req.body?.text);
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "phone required" });
    if (!body) return res.status(400).json({ error: "Type a remark first." });

    const lead = await ensureLead(who.tenantId, phone, cleanName(req.body?.name), who.userId);
    // The Desk call it belongs to, if it is one of this business's.
    let ctcLogId: string | null = null;
    if (req.body?.ctc_log_id) {
      const { data: log } = await sb.from("click_to_call_log").select("id")
        .eq("id", String(req.body.ctc_log_id)).eq("tenant_id", who.tenantId).maybeSingle();
      ctcLogId = log?.id || null;
    }
    const row = {
      tenant_id: who.tenantId, lead_id: lead?.id || null, phone, body,
      author_user_id: who.userId, author_name: who.name || null,
      ctc_log_id: ctcLogId, during_call: !!req.body?.during_call,
    };
    const ins = await sb.from("lead_remarks").insert(row)
      .select("id, body, author_name, during_call, created_at").maybeSingle();
    if (ins.error) {
      // Before 075: keep the words. Appended to the lead's notes, newest
      // first, so the next person to open the lead reads them.
      if (!lead) return res.status(500).json({ error: "Could not save the remark." });
      const line = remarkAsNote(body, who.name);
      const notes = (line + (lead.notes ? "\n" + lead.notes : "")).slice(0, 8000);
      const { error } = await sb.from("leads").update({ notes }).eq("id", lead.id).eq("tenant_id", who.tenantId);
      if (error) return res.status(500).json({ error: "Could not save the remark." });
      return res.json({ ok: true, legacy: true, lead_id: lead.id, legacy_notes: notes });
    }
    res.json({ ok: true, remark: ins.data, lead_id: lead?.id || null });
  });

  // ── Book ──────────────────────────────────────────────────────────
  app.post("/api/desk/appointment", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const phone = last10(req.body?.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: "Enter a 10-digit mobile number" });
    const name = cleanName(req.body?.name);
    const service = cleanName(req.body?.service) || null;
    const notes = cleanRemark(req.body?.notes).slice(0, 500) || null;
    const slotDate = String(req.body?.slot_date || ""), slotTime = String(req.body?.slot_time || "");

    const vp = await profile(who.tenantId);
    const check = checkSlot(slotDate, slotTime, vp || {});
    if (check.ok === false) return res.status(400).json({ error: check.error });
    // A warning is a question for the telecaller, not a refusal.
    if (check.warning && !req.body?.confirm_warning) {
      return res.status(409).json({ error: check.warning, needs_confirm: true });
    }
    // Two people in one slot. Whether that is a clash depends on the
    // business (a clinic sees one patient at a time, a showroom does not),
    // so it too is asked, with the name already in that slot.
    if (!req.body?.confirm_clash) {
      const { data: clash } = await sb.from("appointments").select("caller_name, caller_number")
        .eq("tenant_id", who.tenantId).eq("status", "confirmed")
        .eq("slot_date", slotDate).eq("slot_time", slotTime).limit(1).maybeSingle();
      if (clash && last10(clash.caller_number) !== phone) {
        return res.status(409).json({
          error: `${clash.caller_name || "Someone"} is already booked at that time.`, needs_confirm: true, clash: true });
      }
      if (clash) return res.status(409).json({ error: "This customer is already booked at that time." });
    }

    const lead = await ensureLead(who.tenantId, phone, name, who.userId);
    const { data: appt, error } = await sb.from("appointments").insert({
      tenant_id: who.tenantId, voice_profile_id: vp?.id || null,
      caller_name: name || lead?.name || null, caller_number: phone,
      service, slot_date: slotDate, slot_time: slotTime, status: "confirmed", notes,
    }).select("id, caller_name, service, slot_date, slot_time, status, booking_ref, notes").maybeSingle();
    if (error || !appt) {
      console.error("[desk-call] appointment insert:", error?.message);
      return res.status(500).json({ error: "Could not save the booking. Try again." });
    }
    if (lead) {
      await sb.from("leads").update({ stage: "won", last_contacted_at: new Date().toISOString() })
        .eq("id", lead.id).eq("tenant_id", who.tenantId);
    }

    // The customer's copy. The booking stands whether or not WhatsApp
    // takes it — the telecaller is told which, while the customer is still
    // on the line and can be given the time by voice.
    let whatsapp: "sent" | "failed" | "skipped" = "skipped";
    if (req.body?.notify !== false) {
      const { data: opt } = await sb.from("outbound_opt_outs").select("phone")
        .eq("tenant_id", who.tenantId).in("phone", phoneForms(phone)).limit(1).maybeSingle();
      if (!opt) {
        try {
          whatsapp = (await deps.confirmAppointment({
            tenantId: who.tenantId, voiceProfileId: vp?.id || null, businessName: vp?.business_name || "us",
            phone, slotDate, slotTime, service, appointmentId: appt.id,
          })) ? "sent" : "failed";
        } catch (e: any) {
          console.error("[desk-call] confirmation:", e?.message || e);
          whatsapp = "failed";
        }
      }
    }
    await audit("desk.appointment_booked", { tenantId: who.tenantId, actorId: who.userId,
      metadata: { appointment_id: appt.id, phone, slot_date: slotDate, slot_time: slotTime } });
    // The trigger stamps the booking number on insert; read it back.
    const { data: fresh } = await sb.from("appointments").select("booking_ref").eq("id", appt.id).maybeSingle();
    res.json({ ok: true, appointment: { ...appt, booking_ref: fresh?.booking_ref || appt.booking_ref }, whatsapp, lead_id: lead?.id || null });
  });

  // ── Reschedule or cancel ──────────────────────────────────────────
  app.post("/api/desk/appointment/:id", verifyJWT, apiLimiter, async (req: any, res) => {
    const who = await me(req, res); if (!who) return;
    const { data: appt } = await sb.from("appointments")
      .select("id, caller_number, service, slot_date, slot_time, status, voice_profile_id")
      .eq("id", String(req.params.id)).eq("tenant_id", who.tenantId).maybeSingle();
    if (!appt) return res.status(404).json({ error: "Booking not found" });
    if (appt.status !== "confirmed") return res.status(409).json({ error: "This booking is no longer open." });

    if (req.body?.action === "cancel") {
      const { error } = await sb.from("appointments").update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", appt.id).eq("tenant_id", who.tenantId);
      if (error) return res.status(500).json({ error: "Could not cancel the booking." });
      await audit("desk.appointment_cancelled", { tenantId: who.tenantId, actorId: who.userId, metadata: { appointment_id: appt.id } });
      return res.json({ ok: true, status: "cancelled" });
    }
    if (req.body?.action !== "reschedule") return res.status(400).json({ error: "action must be reschedule or cancel" });

    const slotDate = String(req.body?.slot_date || ""), slotTime = String(req.body?.slot_time || "");
    const vp = await profile(who.tenantId);
    const check = checkSlot(slotDate, slotTime, vp || {});
    if (check.ok === false) return res.status(400).json({ error: check.error });
    if (check.warning && !req.body?.confirm_warning) return res.status(409).json({ error: check.warning, needs_confirm: true });
    const { error } = await sb.from("appointments")
      .update({ slot_date: slotDate, slot_time: slotTime, wa_reminder_sent: false, updated_at: new Date().toISOString() })
      .eq("id", appt.id).eq("tenant_id", who.tenantId);
    if (error) return res.status(500).json({ error: "Could not move the booking." });
    let whatsapp: "sent" | "failed" | "skipped" = "skipped";
    if (req.body?.notify !== false) {
      try {
        whatsapp = (await deps.confirmAppointment({
          tenantId: who.tenantId, voiceProfileId: vp?.id || appt.voice_profile_id || null,
          businessName: vp?.business_name || "us", phone: last10(appt.caller_number),
          slotDate, slotTime, service: appt.service, appointmentId: appt.id,
        })) ? "sent" : "failed";
      } catch { whatsapp = "failed"; }
    }
    await audit("desk.appointment_moved", { tenantId: who.tenantId, actorId: who.userId,
      metadata: { appointment_id: appt.id, slot_date: slotDate, slot_time: slotTime } });
    res.json({ ok: true, status: "confirmed", slot_date: slotDate, slot_time: slotTime, whatsapp });
  });
}
