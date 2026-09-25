// app/whatsapp/page.tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import WhatsAppSender from "../../components/WhatsAppSender";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Send, MessageCircle, ClipboardList, ScrollText, Inbox, ChevronDown, ChevronUp, UserRound } from "lucide-react";

function timeAgo(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan, org: NIKKI.terracotta,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

function Card({ children, title, style }: { children: React.ReactNode; title?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, padding: 18,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)", ...style }}>
      {title && <div style={{ color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ background: color + "14", color, borderRadius: 999, padding: "3px 9px",
      fontSize: 11.5, fontWeight: 600, textTransform: "capitalize" as const, whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function SectionTitle({ icon, children, right }: { icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 17, fontWeight: 700,
        letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: 8 }}>
        {icon} {children}
      </div>
      {right}
    </div>
  );
}

// Every value the API writes to wa_dispatch_log.status: "sent" at send time
// (Meta accepted it), "failed" when Meta refused, then the delivery webhook
// moves it to "delivered" / "read" / "failed".
const DISPATCH_STATUS: Record<string, { label: string; color: string }> = {
  sent:      { label: "sent",      color: C.gold },
  delivered: { label: "delivered", color: C.grn },
  read:      { label: "read",      color: C.cyn },
  failed:    { label: "failed",    color: C.red },
};

// message_type is descriptive, not an enum (migration 030 dropped the CHECK):
// the automated kinds plus whatever a person sends from this page.
const MESSAGE_TYPE_LABEL: Record<string, string> = {
  confirmation:       "Booking confirmation",
  reminder:           "Reminder",
  reminder_today:     "Same-day reminder",
  booking_incomplete: "Unfinished booking",
  missed_call:        "Missed-call follow-up",
  callback:           "Callback",
  brochure:           "Brochure",
  survey:             "Survey",
  daily_summary:      "Daily summary (to you)",
  custom:             "Message",
  manual_reply:       "Your reply",
  manual_template:    "Template",
  lead_capture_ack:   "Enquiry acknowledgement",
};
// onboarding_* rows are HeyNikki's messages to the business owner, not to
// their customers; label them as such rather than as a bare slug.

const typeLabel = (t: string | null) => {
  if (!t) return "Message";
  if (MESSAGE_TYPE_LABEL[t]) return MESSAGE_TYPE_LABEL[t];
  if (t.startsWith("onboarding_")) return "HeyNikki (to you)";
  return t.replace(/_/g, " ").replace(/^\w/, ch => ch.toUpperCase());
};

// ── TEMPLATES, IN WORDS ───────────────────────────────────────
// Meta names templates for Meta: "booking_incomplete_callback". It numbers
// their blanks {{1}}, {{2}}. Neither is something a shop owner has ever
// agreed to read, and this page used to print both — a slug as the card
// title, and the body with the numbers still in it.
//
// So: a written name per template, and a preview with the blanks FILLED IN,
// using the owner's own business name and a real-looking date and time, so
// the card shows the message as the customer will receive it.
const TEMPLATE_TITLE: Record<string, string> = {
  appointment_confirmed:       "Appointment confirmed",
  appointment_confirmed_slot:  "Appointment confirmed, with the date and time",
  appointment_reminder:        "Appointment reminder",
  appointment_reminder_today:  "Reminder on the day",
  booking_incomplete_callback: "They rang to book but no time was fixed",
  lead_brochure_details:       "Sending your brochure",
  interested_lead_brochure:    "Sending your brochure",
  lead_capture_ack:            "Thanks for your enquiry",
  missed_call_followup:        "We missed your call",
  order_confirmed:             "Order confirmed",
};
/** Meta files templates under a language CODE; owners read languages. */
const LANGUAGE_NAME: Record<string, string> = {
  te: "Telugu", te_IN: "Telugu",
  hi: "Hindi",  hi_IN: "Hindi",
  en: "English", en_US: "English", en_GB: "English", en_IN: "English",
};
const languageName = (code: string) =>
  LANGUAGE_NAME[code] || LANGUAGE_NAME[String(code).split(/[_-]/)[0]] || code;

/** A written name for a template, never the slug Meta filed it under. */
const templateTitle = (name: string) =>
  TEMPLATE_TITLE[name] ||
  name.replace(/_/g, " ").replace(/^\w/, ch => ch.toUpperCase());

/**
 * Example values for the blanks, in Meta's {{1}}, {{2}}… order. Driven off
 * the variable LABELS the API sends (META_TPL_VARS in api-server), not off
 * the template name, so a template this build has never heard of still
 * previews with something sensible rather than "{{1}}".
 */
function exampleFor(label: string, business: string): string {
  const l = label.toLowerCase();
  const d = new Date(Date.now() + 86400000);
  if (l.includes("business") || l.includes("service")) return business;
  if (l.includes("date"))  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  if (l.includes("time"))  return "11:30 AM";
  if (l.includes("order")) return "1042";
  if (l.includes("name"))  return business;
  return "…";
}

/**
 * The template body with its blanks filled. `values` are what the owner has
 * typed into the send dialog so far, keyed "1", "2", …; anything they have
 * not typed falls back to the example, so the preview is never a number in
 * curly braces.
 */
function fillTemplate(
  body: string,
  variables: string[],
  business: string,
  values?: Record<string, string>,
): string {
  return String(body || "").replace(/\{\{(\d+)\}\}/g, (_m, n: string) => {
    const i = parseInt(n, 10) - 1;
    const typed = (values?.[n] || "").trim();
    return typed || exampleFor(variables[i] || "", business);
  });
}

/** manual_template rows store `template:<name>` in message_body. */
const templateOf = (d: { message_type?: string | null; message_body?: string | null }) =>
  d.message_type === "manual_template" && d.message_body?.startsWith("template:")
    ? d.message_body.slice("template:".length) : null;

export default function WhatsAppPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [dispatch, setDispatch]   = useState<any[]>([]);
  const [dispatchErr, setDispatchErr] = useState("");
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState<string | null>(null);
  const [modal, setModal]         = useState<{ template: any } | null>(null);
  const [toNumber, setToNumber]   = useState("");
  const [vars, setVars]           = useState<Record<string, string>>({});
  const [inbox, setInbox]   = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [openThreads, setOpenThreads] = useState<Record<string, boolean>>({});
  const [toast, setToast]         = useState<string | null>(null);
  // The name Nikki says on the phone — what fills {{1}} in nearly every
  // template, and so what the previews below use as their example.
  const [business, setBusiness]   = useState("your business");

  const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;

      sb.from("voice_profiles").select("business_name")
        .eq("tenant_id", tu.tenant_id).limit(1).maybeSingle()
        .then(({ data: vp }) => { if (vp?.business_name) setBusiness(vp.business_name); });

      // Templates come from WhatsApp itself, not the wa_templates table:
      // that table was a seed that drifted (wrong languages, a template
      // that never existed, wrong variable counts) and every send from it
      // was refused by Meta.
      const { data: { session } } = await sb.auth.getSession();
      const [tmpl, disp] = await Promise.all([
        fetch(`${API}/api/whatsapp/templates`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } })
          .then(async r => { const j = await r.json().catch(() => ({})); return r.ok ? j : { error: j.error }; })
          .catch(e => ({ error: e.message })),
        sb.from("wa_dispatch_log")
          .select("id, message_type, to_number, message_body, status, sent_at, call_id, appointment_id")
          .eq("tenant_id", tu.tenant_id)
          .order("sent_at", { ascending: false }).limit(50),
      ]);
      if (tmpl.error) { setToast(tmpl.error); setTimeout(() => setToast(null), 6000); }
      setTemplates((tmpl.templates || []).map((t: any) => ({ ...t, id: `${t.name}:${t.language}` })));
      if (disp.error) setDispatchErr(disp.error.message);
      setDispatch(disp.data || []);
      setLoading(false);
    });
  }, []);

  const loadInbox = useCallback(async () => {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/api/whatsapp/inbox?limit=60`,
      { headers: { Authorization: `Bearer ${session?.access_token}` } });
    if (r.ok) {
      const j = await r.json();
      setInbox(j.messages || []);
      setUnread(j.unread || 0);
      // Seen is seen. Without this the unread badge never cleared and every
      // reply stayed "NEW" forever.
      const fresh = (j.messages || []).filter((m: any) => !m.read_at).map((m: any) => m.id);
      if (fresh.length) {
        fetch(`${API}/api/whatsapp/inbox/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ids: fresh }),
        }).catch(() => {});
      }
    }
  }, []);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  // /whatsapp?to=<10 digits> — a lead's drawer sends people here when the
  // 24-hour window is closed and only a template will reach them. Prefill
  // the number and bring the template library into view.
  useEffect(() => {
    try {
      const to = new URLSearchParams(window.location.search).get("to");
      if (to && /^[6-9]\d{9}$/.test(to)) {
        setToNumber(to);
        setTimeout(() => document.getElementById("wa-templates")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
      }
    } catch { /* no window */ }
  }, []);

  // Free text only reaches a person inside Meta's 24-hour window; outside it
  // Meta accepts the call and silently drops the message, which is worse
  // than refusing. Say which one applies before the customer types.
  const replyTo = async (number: string, text: string) => {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    // /api/whatsapp/send is behind verifyInternal — a shared secret a browser
    // can never hold — so this 401'd on every press.
    const r = await fetch(`${API}/api/whatsapp/send-as-tenant`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to_number: number, message: text }),
    });
    const rj = await r.json().catch(() => ({}));
    setToast(r.ok ? "Reply sent!" : (rj.error || "Could not send the reply"));
    setTimeout(() => setToast(""), 2500);
    // Show it in the thread now rather than after a reload.
    if (r.ok) setDispatch(d => [{ id: "tmp-" + Date.now(), message_type: "manual_reply", to_number: number,
      message_body: text, status: "sent", sent_at: new Date().toISOString() }, ...d]);
    loadInbox();
  };

  // One thread per person, newest first. Their messages come from the inbox;
  // ours from the dispatch log (templates Nikki sent, plus manual replies) so
  // the conversation reads in order instead of as a flat list of replies with
  // a composer under every line. The 24-hour window is per person, from
  // their last message, which is exactly what Meta counts.
  const last10 = (n: unknown) => String(n || "").replace(/\D/g, "").slice(-10);
  type Msg = { id: string; dir: "in" | "out"; body: string; at: string; status?: string; label?: string; read?: boolean };
  const threads = (() => {
    const map = new Map<string, Msg[]>();
    for (const m of inbox) {
      const n = last10(m.from_number); if (!n) continue;
      (map.get(n) || map.set(n, []).get(n)!).push({
        id: "in:" + m.id, dir: "in", body: m.body || (m.msg_type ? `[${m.msg_type}]` : ""), at: m.received_at, read: !!m.read_at });
    }
    for (const d of dispatch) {
      const n = last10(d.to_number); if (!map.has(n)) continue;   // only people who have written back
      map.get(n)!.push({
        id: "out:" + d.id, dir: "out",
        // A manual template send logs "template:<name>" as the body; the
        // text itself lives with Meta. Show the template's written name,
        // not the slug with its underscores opened up.
        body: /^template:/.test(d.message_body || "")
          ? "📋 " + templateTitle(d.message_body.slice(9))
          : d.message_body || (MESSAGE_TYPE_LABEL[d.message_type] || d.message_type),
        at: d.sent_at, status: d.status, label: d.message_type === "manual_reply" ? "you" : (MESSAGE_TYPE_LABEL[d.message_type] || d.message_type) });
    }
    return Array.from(map.entries()).map(([number, msgs]) => {
      msgs.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const lastIn = [...msgs].reverse().find(m => m.dir === "in")!;
      const hours = (Date.now() - new Date(lastIn.at).getTime()) / 3600000;
      return { number, msgs, last: msgs[msgs.length - 1].at, hours, canReply: hours < 24,
               unread: msgs.filter(m => m.dir === "in" && !m.read).length };
    }).sort((a, b) => new Date(b.last).getTime() - new Date(a.last).getTime());
  })();

  const sendMessage = async () => {
    if (!modal || !toNumber.trim()) return;
    setSending(modal.template.id);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();

      // Same 401, plus a body the server does not parse — and the result was
      // never checked, so it toasted "Message sent!" over every failure.
      const r = await fetch(`${API}/api/whatsapp/send-template`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          template_name: modal.template.name,
          to_number:     toNumber,
          variables:     vars,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setToast(j.error || "Could not send");
        setSending(null);
        return;
      }

      setToast("Message sent!");
      setModal(null);
      setToNumber("");
      setVars({});
      // Show the row we just wrote without a reload.
      setDispatch(d => [{
        id: `local-${Date.now()}`, message_type: "manual_template", to_number: toNumber,
        message_body: `template:${modal.template.name}`, status: "sent", sent_at: new Date().toISOString(),
      }, ...d]);
    } catch {
      setToast("Send failed — check API connection");
    }
    setSending(null);
    setTimeout(() => setToast(null), 3000);
  };

  // KPIs
  const total     = dispatch.length;
  const delivered = dispatch.filter(d => d.status === "delivered").length;
  const read      = dispatch.filter(d => d.status === "read").length;
  const failed    = dispatch.filter(d => d.status === "failed").length;

  // 24-hour service window: people who messaged US in the last 24 h are the
  // ones a free-form reply can still reach. It used to count our own
  // outbound sends, which is not what the window means.
  const openChats = new Set(inbox
    .filter((m: any) => m.received_at && Date.now() - new Date(m.received_at).getTime() < 86400000)
    .map((m: any) => m.from_number)).size;

  // "Resend" only when this page can honestly do it: a template this account
  // sent by hand, and the template is still approved. Automated messages are
  // sent by Nikki on an event, and a free-text reply outside the window would
  // be accepted by Meta and silently dropped.
  const resendTarget = (d: any) => {
    const name = templateOf(d);
    return name ? templates.find(t => t.name === name) || null : null;
  };

  return (
    <Shell title="WhatsApp">
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: C.surf, border: "1px solid " + C.bord, borderRadius: 10,
          padding: "12px 20px", color: C.txt, fontSize: 13, fontWeight: 600,
          boxShadow: "0 12px 32px rgba(15,23,42,0.14)" }}>
          {toast}
        </div>
      )}

      {/* Send modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.surf, border: "1px solid " + C.bord,
            borderRadius: 14, padding: 28, width: 440, maxWidth: "calc(100vw - 32px)",
            boxShadow: "0 24px 64px rgba(15,23,42,0.24)" }}>
            <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 19, fontWeight: 700,
              letterSpacing: "-0.01em", marginBottom: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Send size={15} /> Send this message</span>
            </div>
            <div style={{ color: C.mid, fontSize: 12, marginBottom: 16 }}>
              {templateTitle(modal.template.name)}
            </div>

            {/* What will actually be sent. Updates as the boxes below are
                filled; anything still blank shows its example instead of a
                number in curly braces. */}
            <div style={{ background: "#F1F4F8", borderRadius: 10, padding: 14, marginBottom: 18,
              borderLeft: "3px solid " + C.grn }}>
              <div style={{ color: C.mid, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>What they will see</div>
              <div style={{ color: C.txt, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {fillTemplate(modal.template.body_text, modal.template.variables || [], business, vars)}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: C.mid, fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 6 }}>
                To Number (WhatsApp)
              </label>
              <input value={toNumber} onChange={e => setToNumber(e.target.value)}
                placeholder="+917XXXXXXXXX or 97XXXXXXXX"
                style={{ background: C.surf, border: "1px solid #D8DFE8", color: C.txt,
                  borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: 14 }} />
            </div>

            {(modal.template.variables || []).map((label: string, i: number) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <label style={{ color: C.mid, fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  {label}
                </label>
                <input value={vars[String(i + 1)] || ""}
                  onChange={e => setVars(p => ({ ...p, [String(i + 1)]: e.target.value }))}
                  placeholder={exampleFor(label, business)}
                  style={{ background: C.surf, border: "1px solid #D8DFE8", color: C.txt,
                    borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: 14 }} />
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={sendMessage} disabled={!toNumber.trim() || sending === modal.template.id}
                style={{ flex: 1, background: C.grn, color: "#fff", border: "none", borderRadius: 8,
                  padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  opacity: !toNumber.trim() ? 0.6 : 1 }}>
                {sending === modal.template.id ? "Sending…" : "Send message"}
              </button>
              <button onClick={() => setModal(null)}
                style={{ padding: "12px 16px", background: "none", color: C.mid, border: "1px solid " + C.bord,
                  borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.mid }}>Loading WhatsApp...</div>
      ) : (
        <>
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>WhatsApp</h1>
      <p style={{ color: C.mid, fontSize: 14, margin: 0 }}>
        Replies from customers, ready-made messages to send, and what Nikki has sent for you.
      </p>
    </div>
    {/* Which number the messages below actually go out from, and the
        buttons to make it the business's own. */}
    <WhatsAppSender />

    {/* THE INBOX. Replies used to arrive at the webhook, get printed to a
        container log, and vanish — a business could send a follow-up and
        never learn the customer said yes. */}
    <div style={{ marginBottom: 24 }}>
      <SectionTitle icon={<Inbox size={14} />}
        right={unread > 0 && (
          <span style={{ background: C.grn, color: "#fff", borderRadius: 999,
            padding: "2px 9px", fontSize: 12, fontWeight: 600 }}>{unread} new</span>
        )}>
        Replies
      </SectionTitle>
      <Card style={{ padding: "4px 18px" }}>
      {inbox.length === 0 ? (
        <div style={{ color: C.mid, fontSize: 14, textAlign: "center", padding: "28px 16px", lineHeight: 1.6 }}>
          No replies yet. When someone answers one of your WhatsApp messages, it appears here
          and you can reply for 24 hours.
        </div>
      ) : threads.map((t, ti) => {
        const open = !!openThreads[t.number];
        const shown = open ? t.msgs : t.msgs.slice(-3);
        const hidden = t.msgs.length - shown.length;
        return (
          <div key={t.number} style={{ padding: "16px 0",
            borderBottom: ti === threads.length - 1 ? "none" : `1px solid ${C.bord}` }}>
            {/* who */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ width: 30, height: 30, borderRadius: "50%", background: C.grn + "14", color: C.grn,
                display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <UserRound size={15} />
              </span>
              <div style={{ minWidth: 0 }}>
                <a href={`/leads?phone=${t.number}`} style={{ color: C.txt, fontWeight: 700, fontSize: 14, fontFamily: "var(--font-mono), monospace", textDecoration: "none" }}>
                  {t.number}
                </a>
                <div style={{ color: C.dim, fontSize: 11.5 }}>
                  {t.msgs.length} message{t.msgs.length === 1 ? "" : "s"} · last {timeAgo(t.last)}
                </div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                background: t.canReply ? C.grn + "14" : "#F1F4F8", color: t.canReply ? C.grn : C.mid }}>
                {t.canReply ? `Open · ${Math.max(1, Math.round(24 - t.hours))}h left` : "Window closed"}
              </span>
              {t.unread > 0 && <span style={{ background: C.grn, color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 11.5, fontWeight: 600 }}>{t.unread} new</span>}
            </div>

            {/* the conversation */}
            {hidden > 0 && (
              <button type="button" onClick={() => setOpenThreads(o => ({ ...o, [t.number]: true }))}
                style={{ background: "none", border: "none", color: C.glow, fontSize: 12, fontWeight: 700,
                  padding: "2px 0 8px 40px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ChevronDown size={13} /> Show {hidden} earlier
              </button>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 40 }}>
              {shown.map(m => (
                <div key={m.id} style={{ alignSelf: m.dir === "in" ? "flex-start" : "flex-end", maxWidth: "85%" }}>
                  <div style={{
                    padding: "8px 12px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
                    borderBottomLeftRadius: m.dir === "in" ? 4 : 12, borderBottomRightRadius: m.dir === "in" ? 12 : 4,
                    background: m.dir === "in" ? "#F1F4F8" : "#DCF8C6",
                    color: C.txt, border: `1px solid ${m.dir === "in" ? "#E4E9F0" : "#C5E8AE"}`,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>{m.body}</div>
                  <div style={{ color: C.dim, fontSize: 10.5, marginTop: 2, textAlign: m.dir === "in" ? "left" : "right" }}>
                    {m.dir === "out" ? (m.label ? m.label + " · " : "you · ") : ""}
                    {new Date(m.at).toLocaleString("en-IN", {
                      day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                      timeZone: "Asia/Kolkata" })}
                    {m.dir === "out" && m.status === "failed" && <span style={{ color: C.red, fontWeight: 800 }}> · failed</span>}
                  </div>
                </div>
              ))}
            </div>
            {open && t.msgs.length > 3 && (
              <button type="button" onClick={() => setOpenThreads(o => ({ ...o, [t.number]: false }))}
                style={{ background: "none", border: "none", color: C.dim, fontSize: 12, fontWeight: 700,
                  padding: "8px 0 0 40px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ChevronUp size={13} /> Collapse
              </button>
            )}

            {/* one composer per person */}
            <div style={{ paddingLeft: 40, marginTop: 10 }}>
            {t.canReply ? (
              <form style={{ display: "flex", gap: 7 }}
                onSubmit={e => { e.preventDefault(); const txt = (replyDraft[t.number] || "").trim(); if (!txt) return;
                  replyTo(t.number, txt); setReplyDraft(d => ({ ...d, [t.number]: "" })); }}>
                <input
                  value={replyDraft[t.number] || ""}
                  onChange={e => setReplyDraft(d => ({ ...d, [t.number]: e.target.value }))}
                  placeholder={`Reply to ${t.number}…`}
                  style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 8, fontSize: 14,
                    background: C.surf, color: C.txt, border: "1px solid #D8DFE8" }} />
                <button type="submit"
                  disabled={!(replyDraft[t.number] || "").trim()}
                  style={{ padding: "9px 16px", borderRadius: 8, border: "none", fontSize: 13.5,
                    fontWeight: 600, background: C.grn, color: "#fff", cursor: "pointer",
                    opacity: (replyDraft[t.number] || "").trim() ? 1 : 0.5 }}>
                  Send
                </button>
              </form>
            ) : (
              <div style={{ color: C.dim, fontSize: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>Their last message is over 24 hours old — only a template reaches them now.</span>
                <button type="button"
                  onClick={() => { setToNumber(t.number); document.getElementById("wa-templates")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                  style={{ background: "none", border: "none", color: C.glow, fontWeight: 600, fontSize: 12.5, padding: 0, cursor: "pointer" }}>
                  Pick a template →
                </button>
              </div>
            )}
            </div>
          </div>
        );
      })}
      </Card>
    </div>
          {/* KPI Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Messages (last 50)", value: total,     color: C.gbr  },
              { label: "Delivered",         value: delivered, color: C.grn  },
              { label: "Read",              value: read,      color: C.cyn  },
              { label: "Failed",            value: failed,    color: C.red  },
              { label: "Open chats (24h)",  value: openChats, color: C.gold },
            ].map(s => (
              // Figure in ink, colour only on the edge — as on the dashboard.
              <Card key={s.label} style={{ position: "relative", overflow: "hidden", padding: "14px 16px 12px" }}>
                <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.color }} />
                <div style={{ color: C.mid, fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 28, fontWeight: 700,
                  lineHeight: 1.1, marginTop: 6, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              </Card>
            ))}
          </div>

          {/* 24h Window Info */}
          <div style={{ background: C.grn + "11", border: "1px solid " + C.grn + "33",
            borderRadius: 10, padding: "12px 14px", fontSize: 13, lineHeight: 1.55, color: C.txt, marginBottom: 24 }}>
            <MessageCircle size={14} color={C.grn} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} /><strong>The 24-hour window</strong> — you can only send free-form messages to customers who messaged you first in the last 24 hours.
            Outside this window, only pre-approved utility templates can be sent.
          </div>

          {/* Template Library */}
          <div id="wa-templates" />
          <SectionTitle icon={<ClipboardList size={14} />}>Ready-made messages</SectionTitle>
          {templates.length === 0 && (
            <Card style={{ marginBottom: 24 }}>
              <div style={{ color: C.mid, fontSize: 14, textAlign: "center", padding: "20px 16px", lineHeight: 1.6 }}>
                No ready-made messages yet. WhatsApp has to approve each one before it can
                be sent — they appear here once it has. Contact support if you need one added.
              </div>
            </Card>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 24 }}>
            {templates.map(t => (
              <Card key={t.id} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
                  <div style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>{templateTitle(t.name)}</div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Pill label={t.category} color={t.category === "utility" ? C.grn : t.category === "marketing" ? C.org : C.gbr} />
                    <Pill label={languageName(t.language)} color={C.cyn} />
                  </div>
                </div>
                {/* The message as the customer receives it — the blanks filled
                    in with this shop's name and an example date and time, not
                    "{{1}}". */}
                <div style={{ color: C.mid, fontSize: 13, lineHeight: 1.6, marginBottom: 10,
                  background: "#F1F4F8", borderRadius: 10, padding: "10px 12px", whiteSpace: "pre-wrap",
                  display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" as any, overflow: "hidden" }}>
                  {fillTemplate(t.body_text, t.variables || [], business)}
                </div>
                <div style={{ color: C.dim, fontSize: 12, marginBottom: 14, marginTop: "auto" }}>
                  Example — the real name, date and time are filled in when you send it.
                </div>
                <button onClick={() => { setModal({ template: t }); setVars({}); }}
                  style={{ width: "100%", background: C.surf, color: C.txt,
                    border: "1px solid #D8DFE8", borderRadius: 8, padding: "9px",
                    fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Send size={14} color={C.grn} /> Send this message</span>
                </button>
              </Card>
            ))}
          </div>

          {/* Dispatch History */}
          <SectionTitle icon={<ScrollText size={14} />}>Sent messages</SectionTitle>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {dispatchErr ? (
              <div style={{ color: C.red, fontSize: 14, textAlign: "center", padding: "28px 16px" }}>
                Couldn&apos;t load your message history: {dispatchErr}
              </div>
            ) : dispatch.length === 0 ? (
              <div style={{ color: C.mid, fontSize: 14, textAlign: "center", padding: "28px 16px", lineHeight: 1.6 }}>
                Nothing sent yet. Confirmations, reminders and follow-ups Nikki sends — and any
                template you send from here — will be listed with their delivery status.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>{["Time", "To", "Type", "Message", "Status", ""].map(h => (
                    <th key={h} style={{ color: C.mid, fontSize: 11.5, fontWeight: 600,
                      padding: "10px 14px", textAlign: "left", whiteSpace: "nowrap",
                      borderBottom: "1px solid #E4E9F0" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {dispatch.map((d: any) => {
                    const st  = DISPATCH_STATUS[d.status] || { label: d.status || "sent", color: C.gold };
                    const tpl = resendTarget(d);
                    const tplName = templateOf(d);
                    return (
                      <tr key={d.id} style={{ borderBottom: "1px solid #EEF2F6" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <td style={{ padding: "11px 14px", color: C.mid, fontSize: 13, whiteSpace: "nowrap" }}>
                          {d.sent_at ? new Date(d.sent_at).toLocaleString("en-IN", {
                            day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                            timeZone: "Asia/Kolkata" }) : "—"}
                        </td>
                        <td style={{ padding: "11px 14px", color: C.txt, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", fontFamily: "var(--font-mono), monospace" }}>
                          {d.to_number}
                        </td>
                        <td style={{ padding: "11px 14px", color: C.mid, fontSize: 13, whiteSpace: "nowrap" }}>
                          {typeLabel(d.message_type)}
                        </td>
                        <td style={{ padding: "11px 14px", color: C.txt, fontSize: 13, maxWidth: 340,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={tplName ? templateTitle(tplName) : (d.message_body || "")}>
                          {tplName ? templateTitle(tplName) : (d.message_body || "—")}
                        </td>
                        <td style={{ padding: "11px 14px" }}>
                          <Pill label={st.label} color={st.color} />
                        </td>
                        <td style={{ padding: "11px 14px", textAlign: "right" }}>
                          {tpl && (
                            <button onClick={() => { setToNumber(d.to_number); setVars({}); setModal({ template: tpl }); }}
                              style={{ background: C.surf, color: C.txt, border: "1px solid #D8DFE8",
                                borderRadius: 7, padding: "4px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                              Resend
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
