// app/orders/page.tsx — Orders Nikki took on the phone
"use client";

/**
 * Orders taken on a call.
 *
 * A mess, a sweet shop or a pharmacy switches on order taking in Setup and
 * types its price list; Nikki reads from that list, totals the order, reads
 * it back and the pipeline files a row here after the call (supabase/047).
 * So this page is not a form anyone fills in — the only thing the shop does
 * here is move an order along, which is why the status buttons are the
 * loudest thing on the card.
 *
 * Reads Supabase directly with the user's JWT (RLS policy "orders_select"
 * scopes rows to the tenant) — same pattern as appointments and calls, no
 * shared browser secret.
 */

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { toast } from "../../components/Toast";
import { NIKKI } from "../../lib/brand";
import { ShoppingBag, Phone, MessageCircle, MapPin, Clock } from "lucide-react";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type OrderItem = { name?: string; qty?: number; unit_price?: number; notes?: string };

type Order = {
  id: string;
  call_id: string | null;
  reference: string;
  customer_phone: string;
  customer_name: string | null;
  items: OrderItem[] | null;
  total: number | string | null;
  currency: string;
  fulfilment: "pickup" | "delivery" | "dine_in" | "unknown";
  address: string | null;
  requested_time: string | null;
  notes: string | null;
  status: string;
  wa_confirmed: boolean;
  created_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  new: C.gold, confirmed: C.cyn, preparing: C.gbr,
  ready: C.grn, delivered: C.mid, cancelled: C.red,
};
const STATUS_LABELS: Record<string, string> = {
  new: "New", confirmed: "Confirmed", preparing: "Preparing",
  ready: "Ready", delivered: "Delivered", cancelled: "Cancelled",
};

const FULFILMENT_LABELS: Record<string, string> = {
  pickup: "Pickup", delivery: "Delivery", dine_in: "Dine-in",
  // The pipeline writes 'unknown' when the caller never said; saying so is
  // more use to the shop than a blank, because it is a thing to ring back about.
  unknown: "Not said on the call",
};

const DONE = ["delivered", "cancelled"];

// One step forward per status. The last hop is labelled by fulfilment —
// "Delivered" on an order nobody is delivering reads as a mistake.
function nextStep(o: Order): { status: string; label: string } | null {
  switch (o.status) {
    case "new":       return { status: "confirmed", label: "Confirm" };
    case "confirmed": return { status: "preparing", label: "Start preparing" };
    case "preparing": return { status: "ready",     label: "Mark ready" };
    case "ready":     return { status: "delivered",
      label: o.fulfilment === "delivery" ? "Delivered" : "Handed over" };
    default:          return null;
  }
}

function money(n: number | null, currency = "INR"): string {
  if (n == null || !isFinite(n)) return "—";
  const amount = n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return currency === "INR" ? `₹${amount}` : `${currency} ${amount}`;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(n) ? n : null;
}

function itemsOf(o: Order): OrderItem[] {
  return Array.isArray(o.items) ? o.items : [];
}

// total is null when a price was unknown on the call. Adding up the lines
// that DO have a price is still worth showing — the shop can see most of
// the order's value — but it is marked "about" so nobody quotes it as final.
function orderTotal(o: Order): { value: number | null; estimated: boolean } {
  const exact = num(o.total);
  if (exact != null) return { value: exact, estimated: false };
  let sum = 0, priced = false;
  for (const it of itemsOf(o)) {
    const p = num(it.unit_price);
    if (p == null) continue;
    priced = true;
    sum += p * (num(it.qty) ?? 1);
  }
  return { value: priced ? sum : null, estimated: true };
}

function fmtTime(ts: string): string {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function isToday(ts: string): boolean {
  const d = new Date(ts), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: "active",    label: "Active" },
  { id: "today",     label: "Today" },
  { id: "new",       label: "New" },
  { id: "preparing", label: "Preparing" },
  { id: "ready",     label: "Ready" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all",       label: "All" },
];

export default function OrdersPage() {
  const [orders, setOrders]   = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("active");
  const [busyId, setBusyId]   = useState<string | null>(null);

  const fetchOrders = useCallback(async (tid: string) => {
    const sb = createClient();
    const { data, error } = await sb.from("orders").select("*").eq("tenant_id", tid)
      .order("created_at", { ascending: false }).limit(200);
    if (error) {
      console.error("[orders] load failed:", error.message);
      toast.err("Couldn't load your orders. Please refresh.");
    } else {
      setOrders((data || []) as Order[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const sb = createClient();
    let cleanup: (() => void) | null = null;

    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) { setLoading(false); return; }
      await fetchOrders(tu.tenant_id);

      // orders IS in the supabase_realtime publication (047), unlike calls
      // and appointments — a kitchen with this page open on a tablet sees
      // the order while the caller is still on the line.
      const ch = sb.channel(`orders-live-${tu.tenant_id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "orders",
            filter: `tenant_id=eq.${tu.tenant_id}` },
          () => fetchOrders(tu.tenant_id))
        .subscribe();
      cleanup = () => { sb.removeChannel(ch); };
    });

    return () => { if (cleanup) cleanup(); };
  }, [fetchOrders]);

  async function setStatus(o: Order, status: string) {
    const before = o.status;
    setBusyId(o.id);
    setOrders(xs => xs.map(x => (x.id === o.id ? { ...x, status } : x)));
    const sb = createClient();
    const { error, count } = await sb.from("orders")
      .update({ status }, { count: "exact" }).eq("id", o.id);
    setBusyId(null);
    // RLS filters silently: a row the policy hides updates zero rows and
    // returns no error, which would otherwise read as a successful move.
    if (error || count === 0) {
      setOrders(xs => xs.map(x => (x.id === o.id ? { ...x, status: before } : x)));
      if (error) console.error("[orders] status update failed:", error.message);
      toast.err(`Couldn't update ${o.reference}. Please try again.`);
      return;
    }
    toast.ok(`${o.reference} — ${(STATUS_LABELS[status] || status).toLowerCase()}.`);
  }

  const shown = orders.filter(o => {
    if (filter === "all")    return true;
    if (filter === "active") return !DONE.includes(o.status);
    if (filter === "today")  return isToday(o.created_at);
    return o.status === filter;
  });

  const activeCount = orders.filter(o => !DONE.includes(o.status)).length;
  // Cancelled orders are money that never arrives, so they stay out of the
  // day's takings even though they are still listed.
  const revenueToday = orders
    .filter(o => isToday(o.created_at) && o.status !== "cancelled")
    .reduce((sum, o) => sum + (orderTotal(o).value ?? 0), 0);
  const ordersToday = orders.filter(o => isToday(o.created_at)).length;

  const chipStyle = (on: boolean): React.CSSProperties => ({
    background: on ? C.glow + "14" : C.surf,
    color: on ? C.glow : C.mid,
    border: `1px solid ${on ? C.glow + "55" : "#E4E9F0"}`,
    borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap",
  });

  return (
    <Shell title="Orders">
      <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>Orders</h1>
      <p style={{ color: C.mid, fontSize: 14, margin: "0 0 20px" }}>
        Orders Nikki took on the phone. Move each one along as you make it.
      </p>

      {/* Figures in ink, colour only on the edge — as on the dashboard. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Orders today",  value: String(ordersToday),  color: C.glow },
          { label: "Takings today", value: money(revenueToday),  color: C.grn },
          { label: "Still open",    value: String(activeCount),  color: activeCount > 0 ? C.gold : C.dim },
        ].map(k => (
          <div key={k.label} style={{ position: "relative", overflow: "hidden", background: C.surf,
            border: "1px solid #E4E9F0", borderRadius: 12, padding: "14px 16px 12px",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
            <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: k.color }} />
            <div style={{ color: C.mid, fontSize: 13, fontWeight: 600 }}>{k.label}</div>
            <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 28, fontWeight: 700,
              lineHeight: 1.1, marginTop: 6, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="nk-scroll" style={{ display: "flex", gap: 7, marginBottom: 16, paddingBottom: 2 }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={chipStyle(filter === f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: C.mid, padding: 32, textAlign: "center" }}>Loading orders…</div>
      ) : orders.length === 0 ? (
        <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12,
          padding: "40px 20px", textAlign: "center", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "center", color: C.dim }}>
            <ShoppingBag size={28} />
          </div>
          <h3 style={{ color: C.txt, margin: "0 0 8px", fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display), sans-serif" }}>No orders yet</h3>
          <p style={{ color: C.mid, fontSize: 13.5, margin: "0 auto", maxWidth: 460, lineHeight: 1.6 }}>
            Nikki can take orders on the phone: she reads out your price list, totals
            the order, repeats it back to the customer and sends a WhatsApp
            confirmation. Every order she takes lands here.
          </p>
          <a href="/setup" style={{ color: C.glow, fontSize: 13.5, fontWeight: 700,
            display: "inline-block", marginTop: 12 }}>
            Switch on order taking in Setup →
          </a>
        </div>
      ) : shown.length === 0 ? (
        <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12,
          padding: 32, textAlign: "center", color: C.mid, fontSize: 14 }}>
          No {FILTERS.find(f => f.id === filter)?.label.toLowerCase()} orders.
          <button onClick={() => setFilter("all")} style={{
            background: "none", border: "none", color: C.glow, fontSize: 13, cursor: "pointer",
            display: "block", margin: "8px auto 0", fontFamily: "inherit", fontWeight: 700,
          }}>Show all orders →</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shown.map(o => {
            const col   = STATUS_COLORS[o.status] || C.mid;
            const items = itemsOf(o);
            const { value: total, estimated } = orderTotal(o);
            const step  = nextStep(o);
            const busy  = busyId === o.id;
            return (
              <div key={o.id} style={{
                background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12,
                padding: "16px 18px", boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                opacity: DONE.includes(o.status) ? 0.75 : 1,
              }}>
                {/* Head: reference, status, when */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{
                    background: "#F1F4F8", color: C.mid,
                    fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                    fontFamily: "var(--font-mono), monospace",
                  }}>{o.reference}</span>
                  <span style={{
                    background: col + "14", color: col,
                    fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}><span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: col }} />
                    {STATUS_LABELS[o.status] || o.status}</span>
                  {o.wa_confirmed && (
                    <span title="Confirmation sent to the customer on WhatsApp" style={{
                      background: C.grn + "14", color: C.grn,
                      fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}><MessageCircle size={12} /> WhatsApp sent</span>
                  )}
                  <span style={{ color: C.dim, fontSize: 12.5, marginLeft: "auto" }}>
                    {fmtTime(o.created_at)}
                  </span>
                </div>

                {/* Customer */}
                <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ color: C.txt, fontSize: 16, fontWeight: 700 }}>
                    {o.customer_name || "Unknown customer"}
                  </span>
                  <a href={`tel:${o.customer_phone}`} style={{
                    color: C.glow, fontSize: 13, fontFamily: "var(--font-mono), monospace", textDecoration: "none",
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}><Phone size={11} /> {o.customer_phone}</a>
                  {o.call_id && (
                    <a href={`/calls?call=${o.call_id}`} style={{ color: C.glow, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                      Listen to the call →
                    </a>
                  )}
                </div>

                {/* Items */}
                <div style={{ marginTop: 12, background: "#F8FAFC", border: "1px solid #EEF2F6", borderRadius: 10, padding: "8px 12px" }}>
                  {items.length === 0 ? (
                    <div style={{ color: C.dim, fontSize: 12.5 }}>
                      No items were captured — check the call before you make anything.
                    </div>
                  ) : items.map((it, i) => {
                    const qty  = num(it.qty) ?? 1;
                    const unit = num(it.unit_price);
                    return (
                      <div key={i} style={{
                        display: "flex", gap: 8, alignItems: "baseline",
                        padding: "5px 0", fontSize: 14,
                        borderTop: i === 0 ? "none" : "1px solid #EEF2F6",
                      }}>
                        <span style={{ color: C.mid, fontWeight: 600, minWidth: 28, fontVariantNumeric: "tabular-nums" }}>{qty}×</span>
                        <span style={{ color: C.txt, flex: 1, minWidth: 0 }}>
                          {it.name || "Item"}
                          {it.notes && (
                            <span style={{ color: C.dim, fontStyle: "italic" }}> — {it.notes}</span>
                          )}
                        </span>
                        <span style={{ color: unit == null ? C.gold : C.mid, fontSize: 13, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                          {unit == null ? "price not said" : money(unit * qty, o.currency)}
                        </span>
                      </div>
                    );
                  })}
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    marginTop: 4, paddingTop: 8, borderTop: "1px solid #E4E9F0",
                  }}>
                    <span style={{ color: C.mid, fontSize: 13, fontWeight: 600 }}>
                      Total{estimated && total != null ? " (about)" : ""}
                    </span>
                    <span style={{ color: total == null ? C.gold : C.txt, fontFamily: "var(--font-display), sans-serif",
                      fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>
                      {total == null ? "Not priced" : money(total, o.currency)}
                    </span>
                  </div>
                </div>

                {/* How and when they want it */}
                <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap",
                  fontSize: 13, color: C.mid }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <MapPin size={12} />
                    <strong style={{ color: o.fulfilment === "unknown" ? C.gold : C.txt }}>
                      {FULFILMENT_LABELS[o.fulfilment] || o.fulfilment}
                    </strong>
                  </span>
                  {o.requested_time && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Clock size={12} /> {o.requested_time}
                    </span>
                  )}
                </div>
                {o.fulfilment === "delivery" && (
                  <div style={{ marginTop: 4, fontSize: 13, color: o.address ? C.txt : C.gold, lineHeight: 1.5 }}>
                    {o.address || "No address on the order — call the customer before you send it out."}
                  </div>
                )}
                {o.notes && (
                  <div style={{ marginTop: 6, fontSize: 13, color: C.mid, fontStyle: "italic", lineHeight: 1.5 }}>
                    {o.notes}
                  </div>
                )}

                {/* The working part: move it along, or drop it */}
                {!DONE.includes(o.status) && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #EEF2F6", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {step && (
                      <button disabled={busy} onClick={() => setStatus(o, step.status)} style={{
                        flex: "1 1 150px", background: C.glow, color: "#fff", border: "none",
                        borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600,
                        cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
                      }}>{step.label}</button>
                    )}
                    <button disabled={busy} onClick={() => setStatus(o, "cancelled")} style={{
                      background: C.surf, color: C.red, border: "1px solid #D8DFE8",
                      borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600,
                      cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
                    }}>Cancel</button>
                  </div>
                )}
                {/* A cancellation is the one move worth undoing — it is usually
                    a mis-tap, and the customer is still expecting the food. */}
                {o.status === "cancelled" && (
                  <div style={{ marginTop: 12 }}>
                    <button disabled={busy} onClick={() => setStatus(o, "new")} style={{
                      background: C.surf, color: C.txt, border: "1px solid #D8DFE8",
                      borderRadius: 8, padding: "8px 14px", fontSize: 13.5, fontWeight: 600,
                      cursor: busy ? "wait" : "pointer",
                    }}>Reopen</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
