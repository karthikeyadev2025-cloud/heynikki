import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Refund Policy — Hey Nikki" };

// The four answers most people come here for, each restated from the
// numbered clause it points to. If a clause changes, change its card too —
// this box must never promise more than the policy below it.
const GLANCE: { fig: string; label: string; href: string }[] = [
  { fig: "100 min", label: "Free on every new account — nothing charged, so nothing to refund", href: "#free-minutes-for-new-accounts" },
  { fig: "7 days",  label: "Full refund of your first monthly charge, once per customer", href: "#monthly-subscriptions" },
  { fig: "14 days", label: "Full refund of an annual plan from the day you buy it", href: "#annual-subscriptions" },
  { fig: "1 day",   label: "To action a cancellation — you keep service until the cycle ends", href: "#cancellation" },
];

export default function Refund() {
  return (
    <LegalLayout title="Refund & Cancellation Policy" lastUpdated="29 June 2026">
      <p>
        This Refund Policy describes when and how Hey Nikki issues refunds
        for subscription fees and related charges.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
        gap: 12, margin: "24px 0 8px" }}>
        {GLANCE.map(g => (
          <a key={g.fig} href={g.href} style={{ display: "block", textDecoration: "none", background: "#fff",
            border: "1px solid #E4E9F0", borderRadius: 12, padding: "16px 16px 14px",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
            <div style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 26, fontWeight: 700,
              color: "#0F172A", letterSpacing: "-0.02em", lineHeight: 1.1 }}>{g.fig}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.45, color: "#475569", marginTop: 6 }}>{g.label}</div>
          </a>
        ))}
      </div>

      <h2>1. Free minutes for new accounts</h2>
      <p>
        Every new account starts with <strong>100 free minutes</strong> of answered calls.
        No card is required and there is no time limit — the minutes are used as calls are
        answered, and when they run out your calls stop until you choose a plan. Nothing is
        charged for these minutes, so there is nothing to refund.
      </p>
      <p>
        {/* This used to say the account is "permanently deleted after 30 days",
            which contradicted the pricing page ("Nothing is deleted") and is not
            what the platform does — no job deletes an unconverted trial. Saying
            we delete data we in fact keep is the worse of the two errors. */}
        If you never subscribe, the account simply stops taking calls. Your recordings,
        transcripts and contacts stay exportable, and nothing is deleted unless you ask
        us to delete it.
      </p>

      <h2>2. Monthly subscriptions</h2>
      <p>
        Monthly subscriptions are non-refundable once charged, with two exceptions:
      </p>
      <ul>
        <li>
          <strong>Within 7 days of first paid subscription:</strong> if you signed up for a
          paid plan and find Nikki doesn't fit your needs, email
          <a href="mailto:support@heynikki.in"> support@heynikki.in</a> within 7 days of the first
          charge for a full refund. This applies only to the very first monthly charge
          and is available once per customer.
        </li>
        {/* This said "more than 8 hours in a billing month" for every customer,
            while Terms §6 promised a 99.5% target with the credit limited to
            Scale. Two different thresholds and two different eligibilities for
            the same credit. One number, stated once, in both places. */}
        <li>
          <strong>Service outage:</strong> if inbound call handling falls below the{" "}
          <strong>99.5% monthly uptime</strong> we target in{" "}
          <a href="/terms">clause 6 of our Terms</a>, you can claim a 10% credit toward
          the next month&apos;s bill by emailing us within 30 days of the end of that month.
        </li>
      </ul>

      <h2>3. Annual subscriptions</h2>
      <p>
        Annual subscriptions can be cancelled within <strong>14 days</strong> of the
        initial purchase for a full refund. After 14 days, the subscription is
        non-refundable, but cancellation prevents future renewals.
      </p>

      <h2>4. Add-on minutes</h2>
      <p>
        {/* There is no post-paid overage on this product. minutesGate() in
            api-server/src/usage.ts refuses further calls once the plan's
            minutes are gone; the only way past that is to upgrade or to buy
            add-on minutes UP FRONT. Describing a charge that is never raised
            invites a customer to expect a bill that never arrives — or worse,
            to believe one might. */}
        You are never billed automatically for going over your plan. When your included
        minutes run out, calls stop until you upgrade. If we add extra minutes to your
        account at your request and invoice you for them, those minutes are prepaid and
        non-refundable once any part of the balance has been used, since the telephony
        and compute behind them are already paid for. An entirely unused batch can be
        refunded within 7 days.
      </p>

      <h2>5. Cancellation</h2>
      <p>
        {/* There is no self-serve cancel control. The ONLY cancellation path in
            the codebase is POST /api/admin/tenants/:id/cancel, which is behind
            verifySuperAdmin — a member of our team has to run it. Pointing a
            customer at "Dashboard → Billing → Cancel", which does not exist,
            is the kind of thing Razorpay checks and a customer discovers at
            the worst possible moment. */}
        To cancel, email <a href="mailto:billing@heynikki.in">billing@heynikki.in</a> or{" "}
        <a href="mailto:support@heynikki.in">support@heynikki.in</a> from the address on
        your account, or call <a href="tel:+918633502031">+91 86335 02031</a>. We action
        cancellations within one business day and confirm by email. Cancellation takes
        effect at the end of the current billing cycle — you keep service until then, and
        your recordings, transcripts and contacts stay exportable.
      </p>

      <h2>6. How refunds are processed</h2>
      <p>
        Refunds are issued to the original payment method (UPI, card, netbanking) via
        Razorpay, and you&apos;ll receive a confirmation email when the refund is initiated.
      </p>
      <div style={{ border: "1px solid #E4E9F0", borderRadius: 12, overflow: "hidden", margin: "0 0 16px" }}>
        {[
          ["UPI and netbanking", "5–7 business days"],
          ["Credit and debit cards", "7–14 business days (set by the issuing bank)"],
        ].map(([how, when], i) => (
          <div key={how} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
            padding: "12px 16px", borderTop: i ? "1px solid #EEF2F6" : "none", background: i ? "#fff" : "#F8FAFC" }}>
            <strong>{how}</strong><span>{when}</span>
          </div>
        ))}
      </div>

      <h2>7. Disputes</h2>
      <p>
        If you believe you've been charged in error, email
        <a href="mailto:billing@heynikki.in"> billing@heynikki.in</a> within 30 days of the
        charge with your invoice number. We respond within 3 business days. If we can't
        resolve it, you may approach Razorpay's grievance process or the appropriate
        consumer forum.
      </p>

      <h2>8. Contact</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
        {[
          ["Refunds & billing", "billing@heynikki.in"],
          ["General support", "support@heynikki.in"],
        ].map(([k, v]) => (
          <div key={v} style={{ background: "#F8FAFC", border: "1px solid #EEF2F6", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 2 }}>{k}</div>
            <a href={`mailto:${v}`} style={{ fontWeight: 600 }}>{v}</a>
          </div>
        ))}
      </div>
    </LegalLayout>
  );
}
