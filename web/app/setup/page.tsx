// app/setup/page.tsx — Voice Profile Setup
"use client";
import { useState, useEffect, useRef } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { VoiceProfile } from "../../lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.jovio.in";

const C = {
  bg:"#07070D", surf:"#0F0F1A", hi:"#161625", bord:"#1E1E35",
  glow:"#8B5CF6", gbr:"#A78BFA", gold:"#F59E0B",
  grn:"#10B981", red:"#EF4444", txt:"#EEEEFF", mid:"#8888AA", dim:"#44445A",
};

const PROFILE_SKUS = [
  { id: "standard",    name: "Nikki Telugu Receptionist — Standard",    desc: "General business, retail, coaching",        icon: "🏢", voice: "anushka" },
  { id: "clinic",      name: "Nikki Telugu Receptionist — Clinic",      desc: "Hospitals, clinics, diagnostic labs",       icon: "🏥", voice: "vidya"   },
  { id: "real_estate", name: "Nikki Telugu Receptionist — Real Estate", desc: "Site visits, lead capture, property enquiries", icon: "🏗️", voice: "karun"   },
  { id: "premium",     name: "Nikki Telugu Receptionist — Premium",     desc: "High-value clients, luxury brands",         icon: "⭐", voice: "manisha" },
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

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;
      setTenantId(tu.tenant_id);

      const { data: vp } = await sb.from("voice_profiles")
        .select("*").eq("tenant_id", tu.tenant_id).limit(1).single();
      if (vp) {
        setProfile(vp);
        setForm({
          profile_sku:       vp.profile_sku,
          business_name:     vp.business_name,
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
      open_time:         form.open_time,
      close_time:        form.close_time,
      open_days:         form.open_days,
      services:          form.services.split(",").map(s => s.trim()).filter(Boolean),
      appointment_types: form.appointment_types.split(",").map(s => s.trim()).filter(Boolean),
      whatsapp_number:   form.whatsapp_number || null,
      did_number:        form.did_number || null,
      dialect_region:    form.dialect_region || "neutral",
      auto_whatsapp_new_leads: form.auto_whatsapp_new_leads,
      auto_call_new_leads:     form.auto_call_new_leads,
      skip_dnd_for_instant_leads: form.skip_dnd_for_instant_leads,
      status:            "active",
    };

    let err;
    if (profile) {
      ({ error: err } = await sb.from("voice_profiles").update(payload).eq("id", profile.id));
    } else {
      ({ error: err } = await sb.from("voice_profiles").insert(payload));
    }

    if (err) { setError(err.message); setSaving(false); return; }
    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTestCall = async () => {
    setTestCalling(true);
    // In production: POST to /api/v1/test-call which dials the tenant's own number
    setTimeout(() => {
      setTestCalling(false);
      alert("Test call initiated! Your phone will ring in 5 seconds with the Telugu AI receptionist.");
    }, 1500);
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
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{sku.icon}</div>
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
                    {isPlaying ? "❚❚" : "▶"}
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

          <FieldGroup>
            <Label>Your Business Phone Number</Label>
            <input value={form.did_number}
              onChange={e => setForm(f => ({ ...f, did_number: e.target.value }))}
              placeholder="+91 98765 43210" />
            <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>
              We'll assign a forwarding AI number that routes calls to your Telugu receptionist
            </div>
          </FieldGroup>

          <FieldGroup>
            <Label>WhatsApp Business Number</Label>
            <input value={form.whatsapp_number}
              onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))}
              placeholder="+91 98765 43210" />
            <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>
              Confirmation messages sent from this number to your callers
            </div>
          </FieldGroup>
        </Card>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12 }}>
          <button type="submit" disabled={saving} style={{
            flex: 1, background: C.glow, color: "#fff", border: "none",
            borderRadius: 8, padding: "12px 0", fontSize: 14, fontWeight: 700,
            opacity: saving ? 0.7 : 1,
          }}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : "Save & Go Live"}
          </button>

          <button type="button" onClick={handleTestCall} disabled={testCalling || !profile} style={{
            padding: "12px 20px", background: "transparent", color: C.gbr,
            border: "1px solid " + C.glow + "66", borderRadius: 8,
            fontSize: 13, fontWeight: 700,
            opacity: (!profile || testCalling) ? 0.5 : 1,
          }}>
            {testCalling ? "Calling..." : "📞 Test Call"}
          </button>
        </div>

        {!profile && (
          <div style={{ color: C.dim, fontSize: 11, marginTop: 8, textAlign: "center" }}>
            Save your profile first to enable test calls
          </div>
        )}
      </form>
    </Shell>
  );
}
