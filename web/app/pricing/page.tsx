import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Pricing — Hey Nikki" };

// ── Kept in step with the homepage on purpose ─────────────────
// This page previously described a completely different product: a
// minute-based ladder (Starter ₹1,999 / Growth ₹4,999 / Scale ₹9,999)
// with a dedicated number at ₹200/month, dated 29 June. The homepage,
// the Super Admin plans table and the v4.0 plan all use the current
// module pricing, with a dedicated number at ₹1,999 — nearly 10× the
// figure quoted here. Anyone clicking "Pricing" in the nav saw a
// contradiction, and the lower number is the one they'd hold us to.
// Aligned to the current model. If pricing changes, change it in both
// places or move both to read from the plans table.
export default function Pricing() {
  return (
    <LegalLayout title="Pricing" lastUpdated="20 August 2026">
      <p>
        Simple INR pricing, billed monthly. Every plan includes the Hey Nikki Telugu
        AI receptionist, the dashboard, the mobile app, and TRAI-compliant call
        disclosure. GST (18%) is added at checkout.
      </p>

      <p>
        Pricing is modular — most businesses start with the AI Telecaller alone and
        add the others when they need them.
      </p>

      <h2>AI Telecaller — ₹5,999/month</h2>
      <ul>
        <li>Unlimited inbound calls on one number</li>
        <li>Telugu, Hindi and English, switched mid-call</li>
        <li>Appointments written straight to your dashboard</li>
        <li>WhatsApp confirmation on every booking</li>
        <li>Call recordings and full transcripts</li>
        <li>Missed-call follow-up, sent automatically</li>
      </ul>

      <h2>Human CRM Seat — ₹1,999/month per seat</h2>
      <ul>
        <li>Click-to-call from your lead list</li>
        <li>Caller history on screen before your telecaller picks up</li>
        <li>Call disposition tagging and notes</li>
        <li>Shared pipeline across your team</li>
      </ul>

      <h2>Dedicated Business Number — ₹1,999/month per number</h2>
      <ul>
        <li>A new business number, yours to keep</li>
        <li>Or port the number you already use</li>
        <li>Masked outbound caller ID</li>
        <li>Automatic carrier failover</li>
      </ul>

      <h2>Free trial</h2>
      <p>
        Every new account gets <strong>100 free minutes</strong> — no card required, and no time limit. After
        the trial, choose a plan or your account becomes read-only. Nothing is deleted.
      </p>

      <h2>Cancellation</h2>
      <p>
        Cancel any month from Dashboard → Billing. You keep access until the end of the
        period you&apos;ve paid for, and your call recordings and transcripts stay
        exportable.
      </p>

      <h2>Refunds</h2>
      <p>See our <a href="/refund-policy">Refund Policy</a> for full details.</p>

      <h2>Need something different?</h2>
      <p>
        Multi-branch businesses, high call volumes and custom integrations (CRM,
        calendar systems) are quoted individually. Email
        <a href="mailto:hello@heynikki.in"> hello@heynikki.in</a> with your call volume
        and we&apos;ll come back with a price.
      </p>
    </LegalLayout>
  );
}
