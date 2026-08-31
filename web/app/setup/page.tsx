// app/setup/page.tsx — Voice Profile Setup
"use client";
import TeamCard from "../../components/TeamCard";
import { useState, useEffect, useRef, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { VoiceProfile } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import AgentDraftBox from "../../components/AgentDraftBox";
import BrochureUpload from "../../components/BrochureUpload";
import ScriptAndMenu from "../../components/ScriptAndMenu";
import { Building2, Hospital, HardHat, Star, Pause, Play, Check, Phone, PhoneOff, Settings } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const PROFILE_SKUS = [
  { id: "standard",    name: "Nikki Telugu Receptionist — Standard",    desc: "General business, retail, coaching",        icon: Building2, voice: "priya" },
  { id: "clinic",      name: "Nikki Telugu Receptionist — Clinic",      desc: "Hospitals, clinics, diagnostic labs",       icon: Hospital, voice: "shreya"   },
  { id: "real_estate", name: "Nikki Telugu Receptionist — Real Estate", desc: "Site visits, lead capture, property enquiries", icon: HardHat, voice: "aditya"   },
  { id: "premium",     name: "Nikki Telugu Receptionist — Premium",     desc: "High-value clients, luxury brands",         icon: Star, voice: "kavya" },
];

// Voice sample URLs — public Supabase Storage bucket `voice-samples` serves
// short 5-second clips. Filenames match `voice` field above. If a sample is
// missing the button shows a tooltip and disables playback.
function sampleUrl(voice: string): string | null {
  const base = process.env.NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${voice}.mp3`;
}

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ color: C.mid, fontSize: 12, fontWeight: 600,
    display: "block", marginBottom: 6 }}>{children}</label>;
}
function FieldGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 16 }}>{children}</div>;
}
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.surf, border: "1px solid " + C.bord,
    borderRadius: 10, padding: 20, ...style }}>{children}</div>;
}

export default function SetupPage() {
  const [neg, setNeg] = useState<any>({ enabled: false, floor_note: "", max_discount_pct: "", offers: "", close_line: "" });
  const [ownerPhone, setOwnerPhone] = useState("");
  const [phoneMsg, setPhoneMsg]     = useState("");
  const [tenantId, setTenantId]       = useState<string | null>(null);
  const [profile, setProfile]         = useState<VoiceProfile | null>(null);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [testCalling, setTestCalling] = useState(false);
  const [error, setError]             = useState("");

  // Voice preview audio — single shared <audio> element. Tracks which SKU
  // is currently playing so the button shows pause/play accurately.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingSku, setPlayingSku] = useState<string | null>(null);

  const togglePreview = (sku: { id: string; voice: string }) => {
    const url = sampleUrl(sku.voice);
    if (!url) return;

    if (playingSku === sku.id) {
      audioRef.current?.pause();
      setPlayingSku(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = url;
      audioRef.current.play()
        .then(() => setPlayingSku(sku.id))
        .catch(() => setPlayingSku(null));   // 404 / blocked autoplay etc.
    }
  };

  const [form, setForm] = useState({
    profile_sku:        "standard",
    business_name:      "",
    // The agent's own name and its Telugu out-of-hours line. Neither was
    // editable here, so the two fields an owner is least able to write
    // themselves were the two the form could not save.
    display_name:       "",
    fallback_message:   "",
    open_time:          "09:00",
    close_time:         "21:00",
    open_days:          ["Mon","Tue","Wed","Thu","Fri","Sat"],
    services:           "",
    appointment_types:  "",
    whatsapp_number:    "",
    did_number:         "",
    dialect_region:     "neutral",
    auto_whatsapp_new_leads: true,
    auto_call_new_leads:     false,
    skip_dnd_for_instant_leads: false,
  });

  // Pulled out of the effect so applying a brochure draft can re-run it.
  // Without this the values land in the database and the form on screen
  // still shows the old ones, which reads as the apply having failed.
  const loadProfile = useCallback(async () => {
    const sb = createClient();
    await sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;
      setTenantId(tu.tenant_id);
      const { data: me } = await sb.from("tenant_users")
        .select("phone").eq("user_id", data.user.id).maybeSingle();
      if (me?.phone) setOwnerPhone(me.phone);

      // Ordered, because an unordered limit(1) on a tenant that has two
      // profiles hands the owner whichever row Postgres felt like — they
      // then edit one profile while calls route through the other.
      const { data: vp } = await sb.from("voice_profiles")
        .select("*").eq("tenant_id", tu.tenant_id)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (vp) {
        setProfile(vp);
        const n = (vp as any)?.negotiation || {};
        if (Object.keys(n).length) setNeg({
          enabled: !!n.enabled, floor_note: n.floor_note || "",
          max_discount_pct: n.max_discount_pct ?? "",
          offers: Array.isArray(n.offers) ? n.offers.join(", ") : "",
          close_line: n.close_line || "",
        });
        setForm({
          profile_sku:       vp.profile_sku,
          business_name:     vp.business_name,
          display_name:      vp.display_name || "",
          fallback_message:  vp.fallback_message || "",
          open_time:         vp.open_time,
          close_time:        vp.close_time,
          open_days:         vp.open_days,
          services:          vp.services?.join(", ") || "",
          appointment_types: vp.appointment_types?.join(", ") || "",
          whatsapp_number:   vp.whatsapp_number || "",
          did_number:        vp.did_number || "",
          dialect_region:    vp.dialect_region || "neutral",
          auto_whatsapp_new_leads: vp.auto_whatsapp_new_leads ?? true,
          auto_call_new_leads:     vp.auto_call_new_leads ?? false,
          skip_dnd_for_instant_leads: vp.skip_dnd_for_instant_leads ?? false,
        });
      }
    });
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const toggleDay = (day: string) => {
    setForm(f => ({
      ...f,
      open_days: f.open_days.includes(day)
        ? f.open_days.filter(d => d !== day)
        : [...f.open_days, day],
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError("");
    const sb = createClient();

    const payload = {
      tenant_id:         tenantId,
      profile_sku:       form.profile_sku,
      business_name:     form.business_name,
      display_name:      form.display_name || null,
      fallback_message:  form.fallback_message || null,
      open_time:         form.open_time,
      close_time:        form.close_time,
      open_days:         form.open_days,
      services:          form.services.split(",").map(s => s.trim()).filter(Boolean),
      appointment_types: form.appointment_types.split(",").map(s => s.trim()).filter(Boolean),
      whatsapp_number:   form.whatsapp_number || null,
      // did_number is NOT written here. It means "the HeyNikki number
      // assigned to this business", an operator-owned fact; writing it from
      // a field the customer fills in made the onboarding job announce
      // "your number is live: <their own mobile>" minutes after signup and
      // permanently consumed the send-once row for the real announcement.
      dialect_region:    form.dialect_region || "neutral",
      // An empty object means "do not negotiate", which is what the agent
      // falls back to — the safe default, chosen rather than inherited.
      negotiation: neg.enabled ? {
        enabled: true,
        floor_note: neg.floor_note.trim() || null,
        max_discount_pct: neg.max_discount_pct === "" ? null : Math.max(0, Math.min(100, Number(neg.max_discount_pct))),
        offers: neg.offers.split(",").map((x: string) => x.trim()).filter(Boolean),
        close_line: neg.close_line.trim() || null,
      } : {},
      auto_whatsapp_new_leads: form.auto_whatsapp_new_leads,
      auto_call_new_leads:     form.auto_call_new_leads,
      skip_dnd_for_instant_leads: form.skip_dnd_for_instant_leads,
      status:            "active",
    };

    // The insert used to discard its result and never call setProfile, so
    // after a SUCCESSFUL first save the page still believed the tenant had
    // no profile: Test Call stayed disabled under "Save your profile first",
    // the script/menu card stayed dead, and the customer — reasonably —
    // pressed Save again, taking the insert branch a second time and
    // creating a duplicate profile the DID might then bind to.
    let err;
    if (profile) {
      const { data, error } = await sb.from("voice_profiles")
        .update(payload).eq("id", profile.id).select().single();
      err = error;
      if (data) setProfile(data);
    } else {
      const { data, error } = await sb.from("voice_profiles")
        .insert(payload).select().single();
      err = error;
      if (data) setProfile(data);
    }

    if (err) { setError(err.message); setSaving(false); return; }
    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 3000);
  };

  // This was a setTimeout that alerted "your phone will ring in 5 seconds"
  // and contacted nothing. A customer who pressed it waited for a call that
  // was never placed and concluded the product does not work. Until the
  // outbound test path is wired end to end, say what is actually true.
  // Your own mobile — the number the onboarding messages, the missed-call
  // ring group and the test call all use. It is captured at signup and
  // stored NULL if it fails validation, and until now there was no screen
  // anywhere in the product to supply it afterwards.
  const saveOwnerPhone = async () => {
    const digits = ownerPhone.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setPhoneMsg("Enter a 10-digit Indian mobile number.");
      return;
    }
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from("tenant_users")
      .update({ phone: digits }).eq("user_id", user?.id);
    setPhoneMsg(error ? error.message : "Saved.");
    setTimeout(() => setPhoneMsg(""), 3000);
  };

  const handleTestCall = async () => {
    setTestCalling(true);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/test-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json",
                   Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ profile_id: profile?.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) alert(j.message || "Calling you now — Nikki will answer.");
      else alert(j.error || "Could not place the test call right now.");
    } catch {
      alert("Could not place the test call right now.");
    } finally {
      setTestCalling(false);
    }
  };

  return (
    <Shell title="Voice Profile Setup">
      <form onSubmit={handleSave}>
        {error && (
          <div style={{ background: C.red + "22", border: "1px solid " + C.red + "44",
            borderRadius: 8, padding: "10px 14px", color: C.red, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Above the description box on purpose: a document the owner
            already has beats asking them to write a description of their own
            business from scratch. */}
        <BrochureUpload onApplied={loadProfile} />

        {/* Fills the form below from a plain description. Sits above the SKU
            picker because choosing a profile type is the first thing it
            answers for you. */}
        <AgentDraftBox onDraft={d => {
          // Writes to `form`, which is what the inputs are bound to. `profile`
          // is the row as loaded from the database and setting it changes
          // nothing on screen.
          //
          // services and appointment_types are comma-joined strings here and
          // split again on save, so the arrays from the draft have to be
          // joined to match — handing the array straight over renders
          // "cleaning,root canal" with no spaces and then re-splits fine, but
          // reads like a bug to whoever opens the page.
          setForm(f => ({
            ...f,
            profile_sku:       d.profile_sku,
            business_name:     d.business_name,
            open_time:         d.open_time,
            close_time:        d.close_time,
            open_days:         d.open_days,
            services:          d.services.join(", "),
            appointment_types: d.appointment_types.join(", "),
            display_name:      d.display_name,
            fallback_message:  d.fallback_message,
          }));
          setSaved(false);
        }} />

        {/* Voice Profile SKU selector */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ color: C.gbr, fontSize: 13, fontWeight: 800, marginBottom: 14 }}>
            Voice Profile
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {PROFILE_SKUS.map(sku => {
              const isSelected = form.profile_sku === sku.id;
              const isPlaying  = playingSku === sku.id;
              const hasSample  = !!sampleUrl(sku.voice);
              return (
                <div key={sku.id} onClick={() => setForm(f => ({ ...f, profile_sku: sku.id }))}
                  style={{
                    padding: 14, borderRadius: 8, cursor: "pointer", position: "relative",
                    background: isSelected ? C.glow + "22" : C.hi,
                    border: "1px solid " + (isSelected ? C.glow : C.bord),
                    transition: "all 0.15s",
                  }}>
                  <div style={{ marginBottom: 6 }}><sku.icon size={20} /></div>
                  <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>{sku.name}</div>
                  <div style={{ color: C.dim, fontSize: 11, marginTop: 3 }}>{sku.desc}</div>

                  {/* Voice preview button (stops click from also picking the card) */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); togglePreview(sku); }}
                    disabled={!hasSample}
                    title={hasSample ? "Preview voice sample" : "Sample not available yet"}
                    style={{
                      position: "absolute", top: 10, right: 10,
                      width: 30, height: 30, borderRadius: "50%",
                      background: isPlaying ? C.glow : C.bord,
                      color: isPlaying ? "#fff" : C.txt,
                      border: "none", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: 12,
                      cursor: hasSample ? "pointer" : "not-allowed",
                      opacity: hasSample ? 1 : 0.4,
                    }}>
                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Shared audio element used by all preview buttons */}
          <audio
            ref={audioRef}
            onEnded={() => setPlayingSku(null)}
            onError={() => setPlayingSku(null)}
            preload="none"
          />
        </Card>

        {/* Business details */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ color: C.gbr, fontSize: 13, fontWeight: 800, marginBottom: 14 }}>
            Business Details
          </div>

          <FieldGroup>
            <Label>Business Name *</Label>
            <input value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
              placeholder="Ravi Clinic, Banjara Hills" required />
          </FieldGroup>

          {/* Both are saved by the form already; neither had an input, so the
              two fields an owner is least able to write for themselves were
              also the two they could never change. */}
          <FieldGroup>
            <Label>What Nikki calls herself</Label>
            <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              placeholder="నిక్కి" />
          </FieldGroup>

          <FieldGroup>
            <Label>Out-of-hours message (Telugu)</Label>
            <textarea value={form.fallback_message} rows={2}
              onChange={e => setForm(f => ({ ...f, fallback_message: e.target.value }))}
              placeholder="ధన్యవాదాలు. మా team ఇప్పుడు busy గా ఉన్నారు."
              style={{ resize: "vertical" }} />
          </FieldGroup>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <FieldGroup>
              <Label>Opening Time</Label>
              <input type="time" value={form.open_time}
                onChange={e => setForm(f => ({ ...f, open_time: e.target.value }))} />
            </FieldGroup>
            <FieldGroup>
              <Label>Closing Time</Label>
              <input type="time" value={form.close_time}
                onChange={e => setForm(f => ({ ...f, close_time: e.target.value }))} />
            </FieldGroup>
          </div>

          <FieldGroup>
            <Label>Open Days</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DAYS.map(day => (
                <button key={day} type="button" onClick={() => toggleDay(day)} style={{
                  padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                  border: "1px solid " + (form.open_days.includes(day) ? C.glow : C.bord),
                  background: form.open_days.includes(day) ? C.glow + "33" : C.hi,
                  color: form.open_days.includes(day) ? C.gbr : C.mid,
                }}>{day}</button>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup>
            <Label>Services (comma-separated)</Label>
            <input value={form.services}
              onChange={e => setForm(f => ({ ...f, services: e.target.value }))}
              placeholder="General Consultation, Blood Test, ECG" />
          </FieldGroup>

          <FieldGroup>
            <Label>Appointment Types (comma-separated)</Label>
            <input value={form.appointment_types}
              onChange={e => setForm(f => ({ ...f, appointment_types: e.target.value }))}
              placeholder="New Patient, Follow-up, Emergency" />
          </FieldGroup>
        </Card>

        {/* ── Telugu register ──
            Regional variation is one of the few things a US-built voice
            product will never model, so it's worth surfacing prominently
            rather than burying in advanced settings. Wrong verb endings are
            noticed by a local caller within one sentence. */}
        <Card style={{ marginBottom: 20 }}>
          <div style={{ color: C.gbr, fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
            Telugu Region
          </div>
          <div style={{ color: C.mid, fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
            Telugu isn&apos;t the same everywhere. Pick the region your callers are from
            and Nikki will use the right words and verb endings — a Warangal caller
            and a Guntur caller expect different Telugu.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {[
              { id: "neutral",     t: "Standard",    d: "Understood everywhere" },
              { id: "andhra",      t: "Coastal Andhra", d: "Guntur, Vijayawada, Godavari" },
              { id: "telangana",   t: "Telangana",   d: "Hyderabad, Warangal" },
              { id: "rayalaseema", t: "Rayalaseema", d: "Kurnool, Tirupati, Kadapa" },
            ].map(r => (
              <button key={r.id} type="button"
                onClick={() => setForm(f => ({ ...f, dialect_region: r.id }))}
                style={{
                  background: form.dialect_region === r.id ? C.glow + "22" : C.hi,
                  border: `1px solid ${form.dialect_region === r.id ? C.glow : C.bord}`,
                  borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                  textAlign: "left", fontFamily: "inherit",
                }}>
                <div style={{
                  color: form.dialect_region === r.id ? C.glow : C.txt,
                  fontSize: 14, fontWeight: 700,
                }}>{r.t}</div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>{r.d}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Instant Lead Capture ──
            "Before they close their browser" — a website form, Facebook
            Lead Ad, or Google Form posts to this URL and Nikki can WhatsApp
            an instant ack and/or call them back within ~30 seconds. */}
        <Card style={{ marginBottom: 20 }}>
          <div style={{ color: C.gbr, fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
            Instant Lead Capture
          </div>
          <div style={{ color: C.mid, fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
            Connect your website form, Facebook Lead Ads, or Google Form to this
            link. The moment someone submits it, they become a lead — and Nikki
            can follow up automatically.
          </div>

          {profile?.capture_token && (
            <div style={{ marginBottom: 16 }}>
              <Label>Your capture link</Label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly
                  value={`${API_URL}/webhooks/lead-capture/${profile.capture_token}`}
                  style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                  onClick={e => (e.target as HTMLInputElement).select()} />
                <button type="button" onClick={() => {
                  navigator.clipboard.writeText(
                    `${API_URL}/webhooks/lead-capture/${profile.capture_token}`);
                }} style={{
                  background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8,
                  padding: "0 16px", color: C.txt, cursor: "pointer", fontSize: 13,
                }}>Copy</button>
              </div>
              <div style={{ color: C.dim, fontSize: 11, marginTop: 6 }}>
                POST <code>name</code>/<code>full_name</code>, <code>phone</code>/<code>phone_number</code>,
                and optionally <code>message</code>. Works with a plain HTML form, Zapier,
                Make, or any tool that can send a webhook.
              </div>
            </div>
          )}

          <FieldGroup>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={form.auto_whatsapp_new_leads}
                onChange={e => setForm(f => ({ ...f, auto_whatsapp_new_leads: e.target.checked }))} />
              <div>
                <div style={{ color: C.txt, fontSize: 14, fontWeight: 600 }}>
                  Send an instant WhatsApp reply
                </div>
                <div style={{ color: C.dim, fontSize: 11 }}>
                  &ldquo;We got your enquiry, we&apos;ll call you shortly&rdquo; — sent the moment they submit.
                </div>
              </div>
            </label>
          </FieldGroup>

          <FieldGroup>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={form.auto_call_new_leads}
                onChange={e => setForm(f => ({ ...f, auto_call_new_leads: e.target.checked }))} />
              <div>
                <div style={{ color: C.txt, fontSize: 14, fontWeight: 600 }}>
                  Call new leads automatically
                </div>
                <div style={{ color: C.dim, fontSize: 11 }}>
                  Nikki calls back within ~30 seconds of a form submission.
                </div>
              </div>
            </label>
          </FieldGroup>

          {form.auto_call_new_leads && (
            <div style={{
              background: C.gold + "0D", border: `1px solid ${C.gold}33`,
              borderRadius: 10, padding: 14, marginTop: 4,
            }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={form.skip_dnd_for_instant_leads}
                  onChange={e => setForm(f => ({ ...f, skip_dnd_for_instant_leads: e.target.checked }))}
                  style={{ marginTop: 3 }} />
                <div style={{ fontSize: 12, color: C.mid, lineHeight: 1.6 }}>
                  <strong style={{ color: C.gold }}>Treat form submissions as consented.</strong>{" "}
                  Someone who fills out your own enquiry form is commonly understood
                  to have consented to that follow-up call — different from cold-calling
                  a purchased list. We&apos;re not lawyers; if TRAI DND compliance matters
                  for your business, check with someone who is before enabling this.
                  Leave unchecked and Nikki will hold callbacks until proper DND
                  scrubbing is configured.
                </div>
              </label>
            </div>
          )}
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <div style={{ color: C.gbr, fontSize: 13, fontWeight: 800, marginBottom: 14 }}>
            Phone &amp; WhatsApp
          </div>

          {/* This field used to be labelled "Your Business Phone Number" and
              wrote voice_profiles.did_number — the column meaning "the
              HeyNikki number assigned to this business". A customer typing
              their own mobile here got told, by WhatsApp, that it was now
              their live HeyNikki number. It is their own mobile, it saves to
              their membership row, and the assigned number is shown
              read-only beside it. */}
          <FieldGroup>
            <Label>Your Mobile Number</Label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={ownerPhone}
                onChange={e => setOwnerPhone(e.target.value)}
                placeholder="98765 43210" style={{ flex: 1 }} />
              <button type="button" onClick={saveOwnerPhone}
                style={{ padding: "0 16px", borderRadius: 8, border: `1px solid ${C.bord}`,
                  background: "transparent", color: C.txt, fontWeight: 700, cursor: "pointer" }}>
                Save
              </button>
            </div>
            <div style={{ color: phoneMsg === "Saved." ? C.grn : C.dim, fontSize: 11, marginTop: 4 }}>
              {phoneMsg || "Where we send your setup updates, and the number your test call rings."}
            </div>
          </FieldGroup>

          <FieldGroup>
            <Label>Your HeyNikki Number</Label>
            <input value={form.did_number || ""} readOnly disabled
              placeholder="Assigned after KYC approval" />
            <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>
              We assign this once your KYC is approved — you'll get a WhatsApp the moment it's live.
            </div>
          </FieldGroup>

          <FieldGroup>
            <Label>Your WhatsApp for daily summaries</Label>
            <input value={form.whatsapp_number}
              onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))}
              placeholder="+91 98765 43210" />
            <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>Where we send your nightly business summary. This is NOT the number your customers see — that's set on the Verification page once your KYC is approved.</div>
          </FieldGroup>
        </Card>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12 }}>
          <button type="submit" disabled={saving} style={{
            flex: 1, background: C.glow, color: "#fff", border: "none",
            borderRadius: 8, padding: "12px 0", fontSize: 14, fontWeight: 700,
            opacity: saving ? 0.7 : 1,
          }}>
            {saving ? "Saving..." : saved ? (<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Check size={14} /> Saved!</span>) : "Save & Go Live"}
          </button>

          {/* Both preconditions, checked here rather than discovered by a
              failed request: a test call needs a profile AND the mobile to
              ring. The button used to be enabled with a phone missing, so
              pressing it returned 409 and printed a console error while the
              field that fixes it sat higher up the same page. */}
          {/* What she may agree to. Without this she either refuses to
              discuss price — which sounds like a form, not a receptionist —
              or improvises a discount nobody authorised. */}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.bord}` }}>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 800, marginBottom: 3 }}>
              Bargaining
            </div>
            <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 10, lineHeight: 1.55 }}>
              Callers haggle. Tell Nikki exactly what she may agree to, and she will
              never go past it — or leave this off and she will politely say the owner
              decides pricing.
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center",
              fontSize: 13.5, color: C.txt, cursor: "pointer" }}>
              <input type="checkbox" checked={neg.enabled}
                onChange={e => setNeg((n: any) => ({ ...n, enabled: e.target.checked }))} />
              Let Nikki negotiate on price
            </label>

            {neg.enabled && (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <div>
                  <Label>The lowest you will ever accept</Label>
                  <input value={neg.floor_note}
                    onChange={e => setNeg((n: any) => ({ ...n, floor_note: e.target.value }))}
                    placeholder="e.g. ₹3,500 for a root canal — never less" />
                  <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>
                    In your own words. She never says this number aloud and never goes under it.
                  </div>
                </div>
                <div>
                  <Label>Most she may come down (%)</Label>
                  <input type="number" min={0} max={100} value={neg.max_discount_pct}
                    onChange={e => setNeg((n: any) => ({ ...n, max_discount_pct: e.target.value }))}
                    placeholder="10" style={{ maxWidth: 120 }} />
                </div>
                <div>
                  <Label>What she can offer instead of a discount</Label>
                  <input value={neg.offers}
                    onChange={e => setNeg((n: any) => ({ ...n, offers: e.target.value }))}
                    placeholder="free first consultation, home delivery, 3-month EMI" />
                  <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>
                    Comma separated. Most bargaining settles on one of these rather than money.
                  </div>
                </div>
                <div>
                  <Label>What she says when they agree</Label>
                  <input value={neg.close_line}
                    onChange={e => setNeg((n: any) => ({ ...n, close_line: e.target.value }))}
                    placeholder="అలాగే సార్, అదే rate కి fix చేస్తున్నాను." />
                </div>
              </div>
            )}
          </div>

          <div style={{ height: 16 }} />
          <button type="button" onClick={handleTestCall}
            disabled={testCalling || !profile || !ownerPhone.trim()} style={{
            padding: "12px 20px", background: "transparent", color: C.gbr,
            border: "1px solid " + C.glow + "66", borderRadius: 8,
            fontSize: 13, fontWeight: 700,
            opacity: (!profile || testCalling || !ownerPhone.trim()) ? 0.5 : 1,
          }}>
            {testCalling ? "Calling..." : (<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Phone size={13} /> Test Call</span>)}
          </button>
        </div>

        {(!profile || !ownerPhone.trim()) && (
          <div style={{ color: C.dim, fontSize: 11, marginTop: 8, textAlign: "center" }}>
            {!profile
              ? "Save your profile first to enable test calls"
              : "Add your mobile number above — that's the phone we'll ring"}
          </div>
        )}
      </form>
      <TeamCard />


      {/* Below the form on purpose. Wording the greeting is a refinement of
          an agent that already knows the business — putting it first would
          ask an owner to script a conversation before they have said what
          they do. */}
      <div style={{ marginTop: 34 }}>
        <ScriptAndMenu tenantId={tenantId} profileId={profile?.id ?? null} />
      </div>

      {/* Missed Call Guard section — only shown once a profile exists */}
      {profile && tenantId && (
        <MissedCallGuardCard profileId={profile.id} tenantId={tenantId} />
      )}
    </Shell>
  );
}


// ── MISSED CALL GUARD CONFIG ──────────────────────────────────
// Lets the tenant configure per-profile missed-call behaviour without
// touching the Super Admin. The guard is triggered server-side by
// FreeSWITCH ESL when a call shorter than guard_seconds is detected.

function MissedCallGuardCard({ profileId, tenantId }: { profileId: string; tenantId: string }) {
  const C2 = C; // same palette
  const [guardEnabled,  setGuardEnabled]  = useState(true);
  const [guardSeconds,  setGuardSeconds]  = useState(20);
  const [waFallback,    setWaFallback]    = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    const sb = createClient();
    sb.from("voice_profiles")
      .select("missed_call_guard_enabled, missed_call_guard_seconds, fallback_wa_enabled")
      .eq("id", profileId)
      .single()
      .then(({ data }) => {
        if (data) {
          setGuardEnabled(data.missed_call_guard_enabled ?? true);
          setGuardSeconds(data.missed_call_guard_seconds ?? 20);
          setWaFallback(data.fallback_wa_enabled ?? true);
        }
        setLoading(false);
      });
  }, [profileId]);

  const save = async () => {
    setSaving(true);
    const sb = createClient();
    await sb.from("voice_profiles").update({
      missed_call_guard_enabled:  guardEnabled,
      missed_call_guard_seconds:  guardSeconds,
      fallback_wa_enabled:        waFallback,
    }).eq("id", profileId);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const inputStyle: React.CSSProperties = {
    background: C2.hi, border: "1px solid " + C2.bord,
    borderRadius: 7, padding: "8px 12px",
    color: C2.txt, fontSize: 13,
  };

  const Toggle = ({ on, onChange, label, desc }: {
    on: boolean; onChange: (v: boolean) => void; label: string; desc: string;
  }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "14px 0", borderBottom: "1px solid " + C2.bord + "44" }}>
      <div>
        <div style={{ color: C2.txt, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{label}</div>
        <div style={{ color: C2.dim, fontSize: 11 }}>{desc}</div>
      </div>
      <button type="button" onClick={() => onChange(!on)} style={{
        width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
        background: on ? C2.grn : C2.bord, position: "relative", flexShrink: 0,
        transition: "background 0.2s",
      }}>
        <span style={{
          position: "absolute", top: 2, left: on ? 22 : 2, width: 20, height: 20,
          borderRadius: "50%", background: "#fff",
          transition: "left 0.2s", boxShadow: "0 1px 4px #0004",
        }} />
      </button>
    </div>
  );

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ color: C2.txt, fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><PhoneOff size={15} /> Missed Call Guard</span>
      </div>
      <div style={{ color: C2.mid, fontSize: 12, marginBottom: 16 }}>
        When a caller hangs up before Nikki can answer — within {guardSeconds} seconds — the guard
        automatically fires a WhatsApp follow-up so you never lose the lead.
      </div>

      <Card>
        {loading ? (
          <div style={{ color: C2.dim, textAlign: "center", padding: 20 }}>Loading...</div>
        ) : (
          <>
            <Toggle
              on={guardEnabled}
              onChange={setGuardEnabled}
              label="Enable Missed Call Guard"
              desc="Detect and handle calls shorter than the timeout threshold"
            />

            {guardEnabled && (
              <>
                <div style={{ padding: "14px 0", borderBottom: "1px solid " + C2.bord + "44",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ color: C2.txt, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Guard Timeout</div>
                    <div style={{ color: C2.dim, fontSize: 11 }}>
                      Calls shorter than this are flagged as missed
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="range" min={5} max={60} step={5}
                      value={guardSeconds}
                      onChange={e => setGuardSeconds(parseInt(e.target.value))}
                      style={{ width: 100, accentColor: C2.glow }}
                    />
                    <div style={{ ...inputStyle, width: 54, textAlign: "center", padding: "6px 8px" }}>
                      {guardSeconds}s
                    </div>
                  </div>
                </div>

                <Toggle
                  on={waFallback}
                  onChange={setWaFallback}
                  label="WhatsApp Follow-up"
                  desc="Send approved missed-call template to the caller via WhatsApp automatically"
                />
              </>
            )}

            {/* Info box */}
            <div style={{ background: C2.glow + "11", border: "1px solid " + C2.glow + "33",
              borderRadius: 8, padding: "10px 14px", marginTop: 16, fontSize: 12 }}>
              <div style={{ color: C2.gbr, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}><Settings size={13} /> How it works</div>
              <div style={{ color: C2.mid, lineHeight: 1.6 }}>
                Every call raises a hang-up event. If the call lasted under{" "}
                <strong style={{ color: C2.txt }}>{guardSeconds}s</strong>, we treat it as
                missed and automatically send that caller a WhatsApp follow-up.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center" }}>
              <button type="button" onClick={save} disabled={saving} style={{
                background: saving ? C2.bord : C2.glow,
                color: "#fff", border: "none", borderRadius: 8,
                padding: "10px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                opacity: saving ? 0.7 : 1,
              }}>
                {saving ? "Saving..." : "Save Guard Settings"}
              </button>
              {saved && <span style={{ color: C2.grn, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={12} /> Saved!</span>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
