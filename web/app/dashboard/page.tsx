// app/dashboard/page.tsx — Reception Log (main dashboard)
"use client";
import { useEffect, useState, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { CallRecord, Appointment } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import {
  Phone, Calendar, PhoneOff, Moon, Flame, Sparkles, PartyPopper,
  Smartphone, Check,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const PAID_PLANS = ["starter", "growth", "scale"];

// Legacy rows carry `wa_otp_<code>` in calls.intent — an internal marker
// for a WhatsApp verification call, not something a caller asked for.
function intentLabel(intent: string | null | undefined): string {
  if (!intent) return "unknown";
  if (intent.startsWith("wa_otp")) return "WhatsApp OTP";
  return intent;
}

const APPT_STATUS: Record<string, { label: string; color: string }> = {
  pending:     { label: "Needs confirmation", color: NIKKI.gold },
  confirmed:   { label: "Confirmed",          color: NIKKI.emerald },
  completed:   { label: "Done",               color: NIKKI.cyan },
  cancelled:   { label: "Cancelled",          color: NIKKI.red },
  no_show:     { label: "No-show",            color: NIKKI.gold },
  rescheduled: { label: "Rescheduled",        color: NIKKI.tealLight },
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.surf, border: "1px solid " + C.bord,
    borderRadius: 10, padding: 16, ...style }}>{children}</div>;
}

function IntentBadge({ intent }: { intent: string | null | undefined }) {
  const map: Record<string, [string, string]> = {
    appointment:    [C.grn + "22",  C.grn],
    enquiry:        [C.cyn + "22",  C.cyn],
    callback:       [C.gold + "22", C.gold],
    transfer:       [C.gbr + "22",  C.gbr],
    emergency:      [C.red + "22",  C.red],
    unknown:        [C.dim + "22",  C.dim],
    "WhatsApp OTP": [C.cyn + "22",  C.cyn],
  };
  const label = intentLabel(intent);
  const [bg, fg] = map[label] || map.unknown;
  return (
    <span style={{ background: bg, color: fg, border: "1px solid " + fg + "44",
      borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function StatCard({ icon: Icon, value, label, color }: { icon: React.ComponentType<{ size?: number }>; value: string | number; label: string; color: string }) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: C.mid, fontSize: 11, textTransform: "uppercase",
            letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
          <div style={{ color, fontSize: 26, fontWeight: 900 }}>{value}</div>
        </div>
        <Icon size={22} />
      </div>
    </Card>
  );
}

function formatDuration(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function timeAgo(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString("en-IN");
}

export default function DashboardPage() {
  const [activeCalls, setActiveCalls]       = useState<CallRecord[]>([]);
  const [recentCalls, setRecentCalls]       = useState<CallRecord[]>([]);
  const [missedCalls, setMissedCalls]       = useState<CallRecord[]>([]);
  const [appointments, setAppointments]     = useState<Appointment[]>([]);
  const [stats, setStats]                   = useState({ total: 0, appointments: 0, missed: 0, afterHours: 0 });
  const [credits, setCredits] = useState<number | null>(null);
  const [usage, setUsage]                   = useState<{ used: number; limit: number } | null>(null);
  const [hotLeads, setHotLeads]             = useState<any[]>([]);
  const [monthValue, setMonthValue]         = useState({ afterHours: 0, booked: 0 });
  const [loading, setLoading]               = useState(true);
  const [tenantId, setTenantId]             = useState<string | null>(null);
  const [updatedAt, setUpdatedAt]           = useState<Date | null>(null);

  const fetchData = useCallback(async (tid: string) => {
    const sb = createClient();
    const today = new Date().toISOString().split("T")[0];
    const monthStart = today.slice(0, 8) + "01";
    // slot_date is a business-local date, so "today" for the diary is the
    // IST calendar day, not the UTC one (they differ from 05:30 to midnight).
    const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    const [active, recent, missed, appts, todayStats,
           profile, minutes, tenantRow, leadsRes, monthCalls, pricing] = await Promise.all([
      sb.from("calls").select("*").eq("tenant_id", tid).eq("status", "active")
        .order("created_at", { ascending: false }),
      sb.from("calls").select("*").eq("tenant_id", tid).neq("status", "active")
        .order("created_at", { ascending: false }).limit(20),
      sb.from("calls").select("*").eq("tenant_id", tid).eq("status", "missed")
        .order("created_at", { ascending: false }).limit(10),
      // Today's diary. This used to be the ten most recent bookings of all
      // time under an empty state that said "No appointments yet today".
      sb.from("appointments").select("*").eq("tenant_id", tid)
        .eq("slot_date", todayIst)
        .order("slot_time", { ascending: true, nullsFirst: false }).limit(10),
      sb.from("calls").select("id, status, created_at, appointment_created")
        .eq("tenant_id", tid).gte("created_at", today + "T00:00:00"),
      // business hours — needed to work out which calls came in while closed
      sb.from("voice_profiles").select("open_time, close_time")
        .eq("tenant_id", tid).limit(1).maybeSingle(),
      // Usage is DERIVED from the calls themselves. call_minutes.used_seconds
      // is a counter no code path has ever incremented — this meter read
      // "0 minutes used" for every customer forever, including one with
      // 2,703 seconds of completed calls sitting in the same database.
      sb.from("calls").select("duration_seconds")
        .eq("tenant_id", tid).gte("created_at", monthStart + "T00:00:00"),
      // The balance that actually gates a trial tenant's calls, and which
      // the customer app never showed them anywhere.
      sb.from("tenants").select("credit_minutes, plan").eq("id", tid).maybeSingle(),
      // warm leads still sitting untouched — the follow-up worklist. This is
      // the one hot-leads list; a second component fetched a near-identical
      // set (score 60+) and rendered it directly above this one.
      sb.from("leads").select("id, name, phone, interest, score, intent")
        .eq("tenant_id", tid).not("stage", "in", '("won","lost")').gte("score", 50)
        .order("score", { ascending: false }).limit(5),
      // whole month, for the value banner
      sb.from("calls").select("created_at, appointment_created")
        .eq("tenant_id", tid).gte("created_at", monthStart + "T00:00:00"),
      // Plan allowances come from the plans table via the same catalogue
      // /billing renders, so the two pages cannot disagree. A hard-coded
      // starter/growth/scale map here lied the moment a plan row was edited.
      fetch(`${API_URL}/api/platform/pricing`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);

    setActiveCalls(active.data || []);
    setRecentCalls(recent.data || []);
    setMissedCalls(missed.data || []);
    setAppointments(appts.data || []);
    setHotLeads(leadsRes.data || []);

    const usedSeconds = (minutes.data || [])
      .reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0);
    const planName = String(tenantRow.data?.plan || "trial").toLowerCase();
    const credits  = Math.round(tenantRow.data?.credit_minutes ?? 0);
    const tier = (pricing?.tiers || []).find((t: any) => String(t.id).toLowerCase() === planName);
    // A trial tenant's allowance is their credit balance, not a plan tier —
    // showing "0 / 200 min" to someone whose real allowance is 100 free
    // credits was wrong in both numbers. If the catalogue is unreachable the
    // limit is 0 and the bar renders minutes used with no denominator.
    setUsage({
      used:  usedSeconds,
      limit: (Number(tier?.minutes) || 0) * 60,
    });
    setCredits(PAID_PLANS.includes(planName) ? null : credits);

    // ── After-hours value ──
    // The number an owner actually feels: calls that arrived when the shop
    // was shut and a human would have missed them. Compared in IST, since
    // open_time/close_time are local business hours.
    const openH  = parseInt((profile.data?.open_time  || "09:00").split(":")[0], 10);
    const closeH = parseInt((profile.data?.close_time || "21:00").split(":")[0], 10);
    const isAfterHours = (iso: string) => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return false;
      const istHour = Number(d.toLocaleString("en-GB", {
        timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).slice(0, 2));
      return istHour < openH || istHour >= closeH;
    };

    const mc = monthCalls.data || [];
    setMonthValue({
      afterHours: mc.filter(c => isAfterHours(c.created_at)).length,
      booked:     mc.filter(c => c.appointment_created).length,
    });

    const d = todayStats.data || [];
    setStats({
      total:        d.length,
      appointments: d.filter(c => c.appointment_created).length,
      missed:       d.filter(c => c.status === "missed").length,
      // was "WhatsApp Sent", which was always 0 — nothing ever sets wa_sent,
      // so it occupied a prime dashboard slot showing a permanent zero.
      afterHours:   d.filter(c => isAfterHours(c.created_at)).length,
    });
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    const sb = createClient();
    let cleanupChannels: (() => void) | null = null;

    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;

      setTenantId(tu.tenant_id);
      await fetchData(tu.tenant_id);

      // Realtime subscriptions on calls and appointments. These only fire
      // if the tables are in the supabase_realtime publication, which they
      // are not today — so nothing arrives here and the 30-second poll
      // below is what actually refreshes the page. Left wired so enabling
      // the publication makes updates instant without a deploy; nothing in
      // the UI promises "live".
      const callsChannel = sb.channel(`calls-live-${tu.tenant_id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "calls",
            filter: `tenant_id=eq.${tu.tenant_id}` },
          () => fetchData(tu.tenant_id))
        .subscribe();

      const apptsChannel = sb.channel(`appts-live-${tu.tenant_id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "appointments",
            filter: `tenant_id=eq.${tu.tenant_id}` },
          () => fetchData(tu.tenant_id))
        .subscribe();

      cleanupChannels = () => {
        sb.removeChannel(callsChannel);
        sb.removeChannel(apptsChannel);
      };
    });

    return () => { if (cleanupChannels) cleanupChannels(); };
  }, [fetchData]);

  // The refresh mechanism. Every 30 seconds; the timestamp in the header
  // tells the owner how stale what they are looking at can be.
  useEffect(() => {
    if (!tenantId) return;
    const t = setInterval(() => fetchData(tenantId), 30000);
    return () => clearInterval(t);
  }, [tenantId, fetchData]);

  return (
    <Shell title="Reception Log">
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: C.mid }}>
          <div style={{ fontSize: 24, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</div>
          <div style={{ marginTop: 8 }}>Loading reception log...</div>
        </div>
      ) : (
        <>
          {/* Same idiom as /desk: inline styles cannot carry a media query,
              so the two-column blocks get a class and collapse here. */}
          <style>{`
            @media (max-width: 900px) {
              .dash-grid  { grid-template-columns: 1fr !important; }
              .dash-stats { grid-template-columns: 1fr 1fr !important; }
            }
          `}</style>

          {updatedAt && (
            <div style={{ color: C.dim, fontSize: 11.5, marginBottom: 10, textAlign: "right" }}>
              Updated {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
            </div>
          )}

          {/* Stats row */}
          <div className="dash-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <StatCard icon={Phone}    value={stats.total}        label="Calls Today"          color={C.gbr}  />
            <StatCard icon={Calendar} value={stats.appointments} label="Appointments Booked"  color={C.grn}  />
            <StatCard icon={PhoneOff} value={stats.missed}       label="Missed (handled)"     color={C.gold} />
            <StatCard icon={Moon}     value={stats.afterHours}   label="After-Hours Caught"   color={C.cyn}  />
          </div>

          {/* ── Value banner ──
              "47 calls" means nothing to a shop owner. "Nikki caught 12 calls
              after you closed" is the number they feel, and it is the honest
              case for the subscription. Only rendered once there is something
              real to show. */}
          {(monthValue.afterHours > 0 || monthValue.booked > 0) && (
            <Card style={{
              marginBottom: 20,
              background: `linear-gradient(135deg, ${C.glow}14, ${C.cyn}0D)`,
              border: `1px solid ${C.glow}44`,
            }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <Sparkles size={28} />
                <div style={{ flex: "1 1 260px" }}>
                  <div style={{ color: C.txt, fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                    This month, Hey Nikki caught{" "}
                    <span style={{ color: C.cyn }}>{monthValue.afterHours} calls</span>
                    {" "}outside your business hours
                    {monthValue.booked > 0 && <>
                      {" "}and booked{" "}
                      <span style={{ color: C.grn }}>{monthValue.booked} appointments</span>
                    </>}.
                  </div>
                  <div style={{ color: C.mid, fontSize: 13 }}>
                    Calls a closed shop would have missed entirely.
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ── Plan usage ──
              On a minute-capped plan, hitting the limit silently means calls
              stop and the customer blames the product. A visible bar (amber at
              80%, red at 95%) prevents that surprise and prompts an upgrade
              before service degrades. */}
          {/* Trial tenants are gated by credits, not a plan tier — and this
              balance was never shown anywhere in the customer app, so the
              only number that decides whether their calls connect was
              invisible to them. */}
          {credits !== null && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 12.5, color: C.mid, marginBottom: 5 }}>
                <span>Free minutes remaining</span>
                <span style={{ color: credits <= 20 ? C.gold : C.txt, fontWeight: 800 }}>
                  {credits} min
                </span>
              </div>
              <div style={{ height: 7, borderRadius: 4, background: C.hi, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (credits / 100) * 100)}%`,
                  background: credits <= 20 ? C.gold : C.grn }} />
              </div>
              {credits <= 20 && (
                <div style={{ color: C.dim, fontSize: 11.5, marginTop: 5 }}>
                  Calls stop when this reaches zero — add a plan to keep Nikki answering.
                </div>
              )}
            </div>
          )}

          {usage && credits === null && (() => {
            // limit is 0 when the pricing catalogue could not be reached:
            // show the minutes talked without inventing a denominator.
            const hasLimit = usage.limit > 0;
            const pct = hasLimit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
            const barColor = !hasLimit ? C.gbr : pct >= 95 ? C.red : pct >= 80 ? C.gold : C.grn;
            const usedMin = Math.ceil(usage.used / 60);
            const limitMin = Math.round(usage.limit / 60);
            return (
              <Card style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>
                    Call minutes this month
                  </span>
                  <span style={{ color: barColor, fontSize: 13, fontWeight: 700,
                    fontFamily: "monospace" }}>
                    {hasLimit ? `${usedMin} / ${limitMin} min` : `${usedMin} min used`}
                  </span>
                </div>
                {hasLimit && (
                  <div style={{ height: 8, background: C.hi, borderRadius: 20, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: barColor,
                      borderRadius: 20, transition: "width .4s ease" }} />
                  </div>
                )}
                {hasLimit && pct >= 80 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: barColor }}>
                    {pct >= 95
                      ? "You're almost out of minutes — calls will stop when you hit the limit."
                      : "You've used most of this month's minutes."}
                    {" "}
                    <a href="/billing" style={{ color: C.gbr, fontWeight: 700 }}>Upgrade →</a>
                  </div>
                )}
              </Card>
            );
          })()}

          {/* ── Follow-up queue ──
              Turns the dashboard from a report into a worklist: warm callers
              (score 50+) who are still sitting untouched in "new". This is
              the only hot-leads list — a second "Hot Leads — Top Prospects"
              card used to render the same people directly above it. */}
          {hotLeads.length > 0 && (
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 14 }}>
                <span style={{ color: C.txt, fontSize: 15, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Flame size={15} color={C.gold} /> Worth calling back
                </span>
                <a href="/leads" style={{ color: C.gbr, fontSize: 13,
                  textDecoration: "none", fontWeight: 600 }}>All leads →</a>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {hotLeads.map((l: any) => (
                  <div key={l.id} style={{
                    display: "flex", gap: 12, alignItems: "center",
                    background: C.hi, borderRadius: 10, padding: "10px 12px", flexWrap: "wrap",
                  }}>
                    <span style={{
                      background: (l.score >= 80 ? C.grn : C.gold) + "22",
                      color: l.score >= 80 ? C.grn : C.gold,
                      fontSize: 12, fontWeight: 800, padding: "3px 9px", borderRadius: 20,
                    }}>{l.score}</span>
                    <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <div style={{ color: C.txt, fontSize: 14, fontWeight: 600 }}>
                        {l.name || "Unknown caller"}
                      </div>
                      {l.interest && (
                        <div style={{ color: C.mid, fontSize: 12 }}>{l.interest}</div>
                      )}
                    </div>
                    {l.intent && <IntentBadge intent={l.intent} />}
                    <a href={`tel:${l.phone}`} style={{
                      color: C.gbr, fontSize: 13, fontFamily: "monospace",
                      textDecoration: "none", fontWeight: 600,
                    }}>{l.phone}</a>
                    <a href="/leads" style={{ background: C.grn + "22", color: C.grn,
                      border: "1px solid " + C.grn + "44", borderRadius: 5,
                      padding: "4px 10px", fontSize: 10, fontWeight: 700,
                      textDecoration: "none", flexShrink: 0 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Phone size={13} /> Call</span>
                    </a>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* First-run empty state — shown only when no data at all exists */}
          {stats.total === 0 && activeCalls.length === 0 && recentCalls.length === 0 &&
           missedCalls.length === 0 && appointments.length === 0 && (
            <Card style={{ marginBottom: 20, padding: 32, textAlign: "center",
                           background: `linear-gradient(135deg, ${C.glow}10 0%, ${C.cyn}10 100%)`,
                           borderColor: C.glow + "44" }}>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><PartyPopper size={40} /></div>
              <div style={{ color: C.txt, fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
                Welcome to Hey Nikki
              </div>
              <div style={{ color: C.mid, fontSize: 13, lineHeight: 1.6, maxWidth: 480, margin: "0 auto 20px" }}>
                Your AI receptionist isn't taking calls yet. Two quick steps to go live:
              </div>
              <div className="dash-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 560, margin: "0 auto" }}>
                <a href="/setup" style={{
                  display: "block", padding: 16, background: C.surf,
                  border: "1px solid " + C.bord, borderRadius: 10,
                  textDecoration: "none", color: C.txt, textAlign: "left",
                }}>
                  <div style={{ color: C.glow, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>STEP 1</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Pick a voice profile</div>
                  <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Choose Standard / Clinic / Real Estate / Premium →</div>
                </a>
                <a href="/setup" style={{
                  display: "block", padding: 16, background: C.surf,
                  border: "1px solid " + C.bord, borderRadius: 10,
                  textDecoration: "none", color: C.txt, textAlign: "left",
                }}>
                  <div style={{ color: C.grn, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>STEP 2</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Forward your number</div>
                  <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Add the Nikki DID to your business line →</div>
                </a>
              </div>
              <div style={{ color: C.dim, fontSize: 11, marginTop: 20 }}>
                Stuck? Email <a href="mailto:support@heynikki.in" style={{ color: C.grn }}>support@heynikki.in</a>
              </div>
            </Card>
          )}

          {/* Active calls live ticker */}
          {activeCalls.length > 0 && (
            <Card style={{ marginBottom: 20, borderColor: C.grn + "44", background: C.grn + "08" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.grn,
                  boxShadow: "0 0 8px " + C.grn, animation: "pulse 2s infinite" }} />
                <span style={{ color: C.grn, fontSize: 13, fontWeight: 800 }}>
                  {activeCalls.length} Active Call{activeCalls.length > 1 ? "s" : ""}
                </span>
              </div>
              {activeCalls.map(call => (
                <div key={call.id} style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", padding: "10px 12px", background: C.surf,
                  borderRadius: 8, marginBottom: 8, border: "1px solid " + C.bord }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <Smartphone size={18} />
                    <div>
                      <div style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>
                        {call.caller_number}
                      </div>
                      <div style={{ color: C.dim, fontSize: 11 }}>
                        {call.direction} · {timeAgo(call.created_at)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <IntentBadge intent={call.intent} />
                    <span style={{ color: C.grn, fontSize: 11, fontWeight: 700 }}>IN PROGRESS</span>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <div className="dash-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

            {/* Today's appointments — query is slot_date = today (IST) */}
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ color: C.gbr, fontSize: 13, fontWeight: 800 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Calendar size={15} /> Today&apos;s Appointments</span>
                </div>
                <a href="/appointments" style={{ color: C.glow, fontSize: 12 }}>All bookings →</a>
              </div>
              {appointments.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 12, textAlign: "center", padding: 20 }}>
                  Nothing booked for today
                </div>
              ) : appointments.map(a => (
                <div key={a.id} style={{ padding: "8px 0", borderBottom: "1px solid " + C.bord + "44" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
                        {a.booking_ref && <span style={{ color: C.cyn, fontFamily: "monospace", marginRight: 6 }}>{a.booking_ref}</span>}
                        {a.caller_name || a.caller_number}
                      </div>
                      <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>
                        {a.service || "General"} · {a.slot_time || "time not set"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {a.wa_confirmed && (
                        <span style={{ color: C.grn, fontSize: 10, display: "inline-flex", alignItems: "center", gap: 2 }}><Check size={10} /> WA</span>
                      )}
                      {/* Derived from the row — this was hard-coded green, so a
                          cancelled or no-show booking wore a success chip. */}
                      {(() => {
                        const s = APPT_STATUS[a.status] || { label: a.status, color: C.dim };
                        return (
                          <span style={{ background: s.color + "22", color: s.color, fontSize: 10,
                            padding: "2px 6px", borderRadius: 4, fontWeight: 700, whiteSpace: "nowrap" }}>
                            {s.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </Card>

            {/* Missed calls */}
            <Card>
              <div style={{ color: C.gold, fontSize: 13, fontWeight: 800, marginBottom: 12 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><PhoneOff size={15} /> Missed Calls — AI Handled</span>
              </div>
              {missedCalls.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 12, textAlign: "center", padding: 20 }}>
                  No missed calls
                </div>
              ) : missedCalls.map(call => (
                <div key={call.id} style={{ padding: "8px 0", borderBottom: "1px solid " + C.bord + "44" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
                        {call.caller_number}
                      </div>
                      <div style={{ color: C.dim, fontSize: 11 }}>{timeAgo(call.created_at)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {call.wa_sent && (
                        <span style={{ color: C.cyn, fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 2 }}>WA <Check size={10} /></span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          </div>

          {/* Recent calls feed */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 800 }}>Recent Calls</div>
              <a href="/calls" style={{ color: C.glow, fontSize: 12 }}>View all →</a>
            </div>
            <div className="nk-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Caller", "Direction", "Duration", "Intent", "WA", "Time"].map(h => (
                    <th key={h} style={{ color: C.dim, fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      padding: "6px 8px", textAlign: "left",
                      borderBottom: "1px solid " + C.bord }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentCalls.slice(0, 10).map(call => (
                  <tr key={call.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.hi)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ padding: "8px 8px", color: C.txt, fontSize: 12 }}>
                      {call.caller_number}
                    </td>
                    <td style={{ padding: "8px 8px" }}>
                      <span style={{ color: call.direction === "inbound" ? C.grn : C.gold,
                        fontSize: 11, fontWeight: 600 }}>
                        {call.direction === "inbound" ? "↙ In" : "↗ Out"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 8px", color: C.mid, fontSize: 12 }}>
                      {formatDuration(call.duration_seconds)}
                    </td>
                    <td style={{ padding: "8px 8px" }}>
                      <IntentBadge intent={call.intent} />
                    </td>
                    <td style={{ padding: "8px 8px", color: call.wa_sent ? C.grn : C.dim,
                      fontSize: 12 }}>
                      {call.wa_sent ? (<span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Check size={10} /> Sent</span>) : "—"}
                    </td>
                    <td style={{ padding: "8px 8px", color: C.dim, fontSize: 11 }}>
                      {timeAgo(call.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        </>
      )}
    </Shell>
  );
}
