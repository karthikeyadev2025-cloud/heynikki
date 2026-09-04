// app/whatsapp/page.tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import WhatsAppSender from "../../components/WhatsAppSender";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Check, X, Send, MessageCircle, ClipboardList, ScrollText } from "lucide-react";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan, org: NIKKI.terracotta,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

function Card({ children, title, style }: { children: React.ReactNode; title?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.surf, border: "1px solid " + C.bord,
      borderRadius: 10, padding: 16, ...style }}>
      {title && <div style={{ color: C.txt, fontSize: 13, fontWeight: 800, marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ background: color + "22", color, border: "1px solid " + color + "44",
      borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700, textTransform: "capitalize" as const }}>
      {label}
    </span>
  );
}

export default function WhatsAppPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [dispatch, setDispatch]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState<string | null>(null);
  const [modal, setModal]         = useState<{ template: any } | null>(null);
  const [toNumber, setToNumber]   = useState("");
  const [vars, setVars]           = useState<Record<string, string>>({});
  const [inbox, setInbox]   = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [toast, setToast]         = useState<string | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;

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
        sb.from("wa_dispatch_log").select("*")
          .eq("tenant_id", tu.tenant_id)
          .order("sent_at", { ascending: false }).limit(50),
      ]);
      if (tmpl.error) { setToast(tmpl.error); setTimeout(() => setToast(null), 6000); }
      setTemplates((tmpl.templates || []).map((t: any) => ({ ...t, id: `${t.name}:${t.language}` })));
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
    loadInbox();
  };

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

  // 24h service window — messages where customer replied in last 24h
  const within24h = dispatch.filter(d => {
    if (!d.sent_at) return false;
    return Date.now() - new Date(d.sent_at).getTime() < 86400000;
  }).length;

  const statusColor = (s: string) =>
    s === "delivered" ? C.grn : s === "read" ? C.cyn : s === "failed" ? C.red : C.gold;

  return (
    <Shell title="WhatsApp">
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: C.surf, border: "1px solid " + C.bord, borderRadius: 10,
          padding: "12px 20px", color: C.txt, fontSize: 13, fontWeight: 700,
          boxShadow: "0 8px 32px #0008" }}>
          {toast}
        </div>
      )}

      {/* Send modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.surf, border: "1px solid " + C.bord,
            borderRadius: 12, padding: 28, width: 420, boxShadow: "0 20px 60px #0008" }}>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Send size={15} /> Send Template</span>
            </div>
            <div style={{ color: C.mid, fontSize: 12, marginBottom: 16 }}>
              Template: <span style={{ color: C.gbr }}>{modal.template.name}</span>
            </div>



            {/* Template preview */}
            <div style={{ background: C.hi, borderRadius: 8, padding: 12, marginBottom: 16,
              border: "1px solid " + C.bord + "88" }}>
              <div style={{ color: C.dim, fontSize: 10, marginBottom: 4 }}>PREVIEW</div>
              <div style={{ color: C.txt, fontSize: 12, lineHeight: 1.5 }}>
                {modal.template.body_text}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: C.mid, fontSize: 11, fontWeight: 600, display: "block", marginBottom: 6 }}>
                To Number (WhatsApp)
              </label>
              <input value={toNumber} onChange={e => setToNumber(e.target.value)}
                placeholder="+917XXXXXXXXX or 97XXXXXXXX"
                style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                  borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: 13 }} />
            </div>

            {(modal.template.variables || []).map((label: string, i: number) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <label style={{ color: C.mid, fontSize: 11, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  {`{{${i + 1}}}`} · {label}
                </label>
                <input value={vars[String(i + 1)] || ""}
                  onChange={e => setVars(p => ({ ...p, [String(i + 1)]: e.target.value }))}
                  placeholder={label}
                  style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                    borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: 13 }} />
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={sendMessage} disabled={!toNumber.trim() || sending === modal.template.id}
                style={{ flex: 1, background: C.grn, color: "#fff", border: "none", borderRadius: 8,
                  padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  opacity: !toNumber.trim() ? 0.6 : 1 }}>
                {sending === modal.template.id ? "Sending..." : "Send Message"}
              </button>
              <button onClick={() => setModal(null)}
                style={{ padding: "12px 16px", background: "none", color: C.mid, border: "1px solid " + C.bord,
                  borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
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
    {/* Which number the messages below actually go out from, and the
        buttons to make it the business's own. */}
    <WhatsAppSender />

    {/* THE INBOX. Replies used to arrive at the webhook, get printed to a
        container log, and vanish — a business could send a follow-up and
        never learn the customer said yes. */}
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h2 style={{ color: C.txt, fontSize: 17, fontWeight: 800, margin: 0 }}>Replies</h2>
        {unread > 0 && (
          <span style={{ background: C.grn, color: "#04120a", borderRadius: 20,
            padding: "2px 9px", fontSize: 11.5, fontWeight: 800 }}>{unread} new</span>
        )}
      </div>
      {inbox.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.6 }}>
          No replies yet. When someone answers one of your WhatsApp messages,
          it appears here and against their lead.
        </div>
      ) : inbox.map((m: any) => {
        const hours = (Date.now() - new Date(m.received_at).getTime()) / 3600000;
        const canReply = hours < 24;
        return (
          <div key={m.id} style={{ padding: "11px 0", borderBottom: `1px solid ${C.bord}44` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ color: C.txt, fontWeight: 800, fontSize: 13.5 }}>{m.from_number}</span>
              <span style={{ color: C.dim, fontSize: 11.5 }}>
                {new Date(m.received_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
              </span>
              {!m.read_at && <span style={{ color: C.grn, fontSize: 11, fontWeight: 800 }}>NEW</span>}
            </div>
            <div style={{ color: C.mid, fontSize: 14, margin: "5px 0 8px", lineHeight: 1.5 }}>{m.body}</div>
            {canReply ? (
              <div style={{ display: "flex", gap: 7 }}>
                <input
                  value={replyDraft[m.id] || ""}
                  onChange={e => setReplyDraft(d => ({ ...d, [m.id]: e.target.value }))}
                  placeholder="Reply…"
                  style={{ flex: 1, padding: "7px 11px", borderRadius: 7, fontSize: 13,
                    background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
                <button type="button"
                  disabled={!(replyDraft[m.id] || "").trim()}
                  onClick={() => { replyTo(m.from_number, replyDraft[m.id]); setReplyDraft(d => ({ ...d, [m.id]: "" })); }}
                  style={{ padding: "7px 14px", borderRadius: 7, border: "none", fontSize: 12.5,
                    fontWeight: 800, background: C.grn, color: "#04120a", cursor: "pointer" }}>
                  Send
                </button>
              </div>
            ) : (
              <div style={{ color: C.dim, fontSize: 11.5 }}>
                Over 24 hours old — WhatsApp only allows a template now, not a free reply.
              </div>
            )}
          </div>
        );
      })}
    </div>
          {/* KPI Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Messages Sent",     value: total,    color: C.gbr  },
              { label: "Delivered",          value: delivered, color: C.grn  },
              { label: "Read",               value: read,      color: C.cyn  },
              { label: "Failed",             value: failed,    color: C.red  },
              { label: "24h Active Window",  value: within24h, color: C.gold },
            ].map(s => (
              <Card key={s.label}>
                <div style={{ color: C.mid, fontSize: 10, textTransform: "uppercase",
                  letterSpacing: "0.1em", marginBottom: 6 }}>{s.label}</div>
                <div style={{ color: s.color, fontSize: 26, fontWeight: 900 }}>{s.value}</div>
              </Card>
            ))}
          </div>

          {/* 24h Window Info */}
          <div style={{ background: C.grn + "11", border: "1px solid " + C.grn + "33",
            borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.grn, marginBottom: 20 }}>
            <MessageCircle size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /><strong>24-Hour Service Window</strong> — You can only send free-form messages to customers who messaged you first in the last 24 hours.
            Outside this window, only pre-approved utility templates can be sent.
          </div>

          {/* Template Library */}
          <div style={{ color: C.txt, fontSize: 14, fontWeight: 900, marginBottom: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ClipboardList size={14} /> Template Library</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            {templates.map(t => (
              <Card key={t.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>{t.name}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Pill label={t.category} color={t.category === "utility" ? C.grn : t.category === "marketing" ? C.org : C.gbr} />
                    <Pill label={t.language} color={C.cyn} />
                  </div>
                </div>
                <div style={{ color: C.mid, fontSize: 11, lineHeight: 1.6, marginBottom: 12,
                  display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as any, overflow: "hidden" }}>
                  {t.body_text}
                </div>
                <button onClick={() => { setModal({ template: t }); setVars({}); }}
                  style={{ width: "100%", background: C.glow + "22", color: C.gbr,
                    border: "1px solid " + C.glow + "44", borderRadius: 6, padding: "8px",
                    fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Send size={12} /> Send this template</span>
                </button>
              </Card>
            ))}
          </div>

          {/* Dispatch History */}
          <Card title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><ScrollText size={14} /> Dispatch History — Last 50 Messages</span>}>
            {dispatch.length === 0 ? (
              <div style={{ color: C.dim, textAlign: "center", padding: 24 }}>No messages sent yet</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Time", "To", "Template", "Type", "Status", ""].map(h => (
                    <th key={h} style={{ color: C.dim, fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", padding: "8px 10px", textAlign: "left",
                      borderBottom: "1px solid " + C.bord }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {dispatch.map((d: any) => (
                    <tr key={d.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.hi)}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "10px", color: C.dim, fontSize: 11 }}>
                        {new Date(d.sent_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td style={{ padding: "10px", color: C.txt, fontSize: 12, fontWeight: 600 }}>
                        {d.to_number}
                      </td>
                      <td style={{ padding: "10px", color: C.mid, fontSize: 11 }}>
                        {d.message_type || "—"}
                      </td>
                      <td style={{ padding: "10px" }}>
                        <Pill label={d.template_name || "custom"} color={C.gbr} />
                      </td>
                      <td style={{ padding: "10px" }}>
                        <Pill label={d.status || "sent"} color={statusColor(d.status)} />
                      </td>
                      <td style={{ padding: "10px" }}>
                        <button onClick={() => setToNumber(d.to_number)}
                          style={{ background: "none", color: C.dim, border: "1px solid " + C.bord + "66",
                            borderRadius: 5, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>
                          Resend
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </Shell>
  );
}
