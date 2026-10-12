// app/floor/page.tsx — the owner's view of the calling floor: who is on a
// call this minute, who is free, who has not come in, what each has done
// today, and the rules that run without anyone pressing a button.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ear, Phone, PhoneCall, Settings2, Users } from "lucide-react";
import Shell from "../../components/Shell";
import { NIKKI } from "../../lib/brand";
import { deskApi } from "../../lib/desk-api";
import { toast } from "../../components/Toast";

const C = { txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim, bord: NIKKI.border, surf: NIKKI.surface,
  hi: NIKKI.vault, teal: NIKKI.teal, red: NIKKI.red, grn: NIKKI.emerald, gold: NIKKI.gold };

type Person = { user_id: string; name: string; is_you: boolean; state: "on_call" | "free" | "away" | "out";
  checked_in_at: string | null; calls: number; conversations: number; booked: number; interested: number;
  no_outcome: number; target_calls: number;
  call: { id: string; number: string; name: string | null; since: string; talking: boolean } | null };
type Rules = { stale_days: number; stale_to: "pool" | "team"; team_report: boolean };

const STATE: Record<Person["state"], { label: string; color: string; hint: string }> = {
  on_call: { label: "On a call", color: NIKKI.emerald, hint: "" },
  free:    { label: "Free", color: NIKKI.teal, hint: "Checked in, phone ready" },
  away:    { label: "Away", color: NIKKI.gold, hint: "Checked in, but the Desk is not open on their computer" },
  out:     { label: "Not in", color: NIKKI.textDim, hint: "Has not checked in" },
};
const ORDER: Person["state"][] = ["on_call", "free", "away", "out"];
const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export default function FloorPage() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [canListen, setCanListen] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState("");
  const [saving, setSaving] = useState(false);
  const emails = useRef<Map<string, string> | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await deskApi("/api/desk/floor");
      // A seat with no display name is known by its email.
      if (j.people.some((p: Person) => p.name === "Team member") && !emails.current) {
        const t = await deskApi("/api/team").catch(() => ({ members: [] }));
        emails.current = new Map((t.members || []).map((m: any) => [m.user_id, String(m.email || "").split("@")[0]]));
      }
      for (const p of j.people as Person[]) if (p.name === "Team member") p.name = emails.current?.get(p.user_id) || p.name;
      setPeople(j.people); setCanListen(!!j.can_listen); setErr("");
      // Do not overwrite a rule the owner is in the middle of changing.
      setRules(r => r || j.rules);
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const listen = async (p: Person) => {
    if (!p.call) return;
    setBusy(p.call.id);
    try {
      toast.ok("Your browser phone is ringing. Answer it to listen.");
      await deskApi("/api/desk/floor/listen", { call_id: p.call.id });
    } catch (e: any) { toast.err(e.message); }
    setBusy("");
  };

  const save = async (next: Rules) => {
    setRules(next); setSaving(true);
    try { setRules((await deskApi("/api/desk/rules", next)).rules); toast.ok("Saved"); }
    catch (e: any) { toast.err(e.message); }
    setSaving(false);
  };

  const sorted = [...(people || [])].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.calls - a.calls);
  const count = (s: Person["state"]) => (people || []).filter(p => p.state === s).length;
  const totals = (people || []).reduce((t, p) => ({ calls: t.calls + p.calls, conv: t.conv + p.conversations, booked: t.booked + p.booked }), { calls: 0, conv: 0, booked: 0 });
  const card: React.CSSProperties = { background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 16 };
  const input: React.CSSProperties = { border: `1px solid ${C.bord}`, borderRadius: 8, padding: "7px 9px", fontSize: 14, background: C.surf, color: C.txt };

  return (
    <Shell title="Team Floor">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>Team Floor</h1>
        <p style={{ color: C.mid, fontSize: 14, margin: 0 }}>Who is on a call right now, what each person has done today, and the rules that run by themselves.</p>
      </div>

      {err && <div style={{ ...card, borderColor: C.red + "66", color: C.red, fontSize: 14, marginBottom: 14 }}>
        {/owner/i.test(err) ? "This page is for the account owner." : err}</div>}

      {people && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
            {[
              { label: "On a call", value: count("on_call"), color: C.grn },
              { label: "Free", value: count("free"), color: C.teal },
              { label: "Away or not in", value: count("away") + count("out"), color: C.gold },
              { label: "Calls today", value: totals.calls, color: C.txt },
              { label: "Conversations", value: totals.conv, color: C.txt },
              { label: "Booked", value: totals.booked, color: C.txt },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: k.color }} />
                <div style={{ fontSize: 13, color: C.mid, fontWeight: 600 }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: C.txt, fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display), sans-serif" }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 12, marginBottom: 18 }}>
            {sorted.map(p => {
              const st = STATE[p.state];
              const pct = p.target_calls ? Math.min(100, Math.round((p.calls / p.target_calls) * 100)) : 0;
              return (
                <div key={p.user_id} style={{ ...card, borderColor: p.state === "on_call" ? C.grn + "88" : C.bord }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <strong style={{ flex: 1, minWidth: 0, fontSize: 15, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}{p.is_you ? " (you)" : ""}</strong>
                    <span title={st.hint} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: st.color + "18", color: st.color,
                      borderRadius: 999, padding: "3px 9px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                      <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />{st.label}
                    </span>
                  </div>

                  {p.call ? (
                    <div style={{ background: C.grn + "10", borderRadius: 9, padding: "9px 10px", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, color: C.txt }}>
                        <PhoneCall size={14} color={C.grn} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                          {p.call.name || p.call.number.replace(/^(\d{5})(\d{5})$/, "$1 $2")}</span>
                        <span style={{ fontVariantNumeric: "tabular-nums", color: C.mid }}>{mmss(now - Date.parse(p.call.since))}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                        <span style={{ flex: 1, fontSize: 12, color: C.mid }}>{p.call.talking ? "Talking to the customer" : "Ringing the customer"}</span>
                        {!p.is_you && (
                          <button type="button" onClick={() => listen(p)} disabled={!canListen || busy === p.call.id}
                            title={canListen ? "Listen without being heard" : "Open the Desk and choose \"This computer\" first, so the call can ring here"}
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${C.bord}`, background: C.surf, borderRadius: 7,
                              padding: "5px 10px", fontSize: 12.5, fontWeight: 600, color: canListen ? C.teal : C.dim }}>
                            <Ear size={13} /> {busy === p.call.id ? "Ringing you…" : "Listen"}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: C.mid, marginBottom: 10, minHeight: 18 }}>
                      {p.checked_in_at ? `In since ${new Date(p.checked_in_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : st.hint}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, textAlign: "center" }}>
                    {[["Calls", p.calls], ["Talked", p.conversations], ["Booked", p.booked]].map(([l, v]) => (
                      <div key={l as string} style={{ background: C.hi, borderRadius: 8, padding: "7px 4px" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: C.txt, fontVariantNumeric: "tabular-nums" }}>{v}</div>
                        <div style={{ fontSize: 12, color: C.mid }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {p.target_calls > 0 && (
                    <div style={{ marginTop: 9 }}>
                      <div style={{ height: 6, borderRadius: 3, background: C.hi, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? C.grn : C.teal }} />
                      </div>
                      <div style={{ fontSize: 12, color: C.mid, marginTop: 4 }}>{p.calls} of {p.target_calls} calls today</div>
                    </div>
                  )}
                  {p.no_outcome > 0 && <div style={{ fontSize: 12, color: C.gold, marginTop: 6, fontWeight: 600 }}>{p.no_outcome} call{p.no_outcome === 1 ? "" : "s"} with no outcome saved</div>}
                </div>
              );
            })}
            {sorted.length === 0 && <div style={{ ...card, color: C.mid, fontSize: 14 }}><Users size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />Nobody is on the team yet. Invite telecallers from the Human Desk.</div>}
          </div>
        </>
      )}

      {rules && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Settings2 size={16} color={C.teal} /><strong style={{ fontSize: 15, color: C.txt }}>Rules that run by themselves</strong>
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, marginBottom: 6 }}>A lead nobody has called</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 14, color: C.txt }}>
                After
                <select value={rules.stale_days} disabled={saving} onChange={e => save({ ...rules, stale_days: Number(e.target.value) })} style={input} aria-label="Days without a call">
                  <option value={0}>— never —</option>
                  {[1, 2, 3, 5, 7, 14].map(d => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
                </select>
                without a call, move it
                <select value={rules.stale_to} disabled={saving || !rules.stale_days} onChange={e => save({ ...rules, stale_to: e.target.value as Rules["stale_to"] })} style={input} aria-label="Where it goes">
                  <option value="pool">back to unassigned</option>
                  <option value="team">to the other telecallers</option>
                </select>
              </div>
              <div style={{ fontSize: 12.5, color: C.mid, marginTop: 6, lineHeight: 1.5 }}>
                Leads with a callback still to come are left alone. Checked every 15 minutes; you get a phone alert when leads move.
              </div>
            </div>
            <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 14, color: C.txt, cursor: "pointer" }}>
              <input type="checkbox" checked={rules.team_report} disabled={saving} onChange={e => save({ ...rules, team_report: e.target.checked })} style={{ marginTop: 3 }} />
              <span><strong style={{ fontWeight: 600 }}>Evening report</strong><br />
                <span style={{ fontSize: 12.5, color: C.mid }}>Around 7 pm, an email and a phone alert with each telecaller&apos;s calls, conversations, bookings and who was short of target. Not sent on a day with no calls.</span></span>
            </label>
            <div style={{ fontSize: 12.5, color: C.mid, display: "flex", gap: 7, alignItems: "flex-start" }}>
              <Phone size={13} style={{ marginTop: 2, flex: "none" }} />
              Already running: a missed call gets a WhatsApp message and appears on Today&apos;s Board until someone rings back.
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
