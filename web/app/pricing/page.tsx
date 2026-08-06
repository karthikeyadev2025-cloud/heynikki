import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Pricing — Nikki" };

export default function Pricing() {
  return (
    <LegalLayout title="Pricing" lastUpdated="29 June 2026">
      <p>
        Simple INR pricing. All plans include the core Nikki Telugu AI receptionist, the
        dashboard, mobile app, and TRAI-compliant call disclosure. GST (18%) is added at
        checkout.
      </p>

      <h2>Starter — ₹1,999/month</h2>
      <ul>
        <li>200 call-minutes per month</li>
        <li>1 voice profile</li>
        <li>WhatsApp appointment confirmations</li>
        <li>Email support (24-hour response)</li>
      </ul>

      <h2>Growth — ₹4,999/month</h2>
      <ul>
        <li>600 call-minutes per month</li>
        <li>3 voice profiles</li>
        <li>Custom greetings &amp; appointment booking flows</li>
        <li>Outbound WhatsApp campaigns</li>
        <li>Priority email support (4-hour response)</li>
        <li>Analytics dashboard</li>
      </ul>

      <h2>Scale — ₹9,999/month</h2>
      <ul>
        <li>1,500 call-minutes per month</li>
        <li>10 voice profiles</li>
        <li>Multi-branch support</li>
        <li>API access for integrations</li>
        <li>Custom integrations (CRM, calendar systems)</li>
        <li>Dedicated customer success manager</li>
      </ul>

      <h2>Overage</h2>
      <p>
        Calls beyond your plan's monthly minutes are charged at <strong>₹3/minute</strong>.
        Overage is billed monthly with your subscription invoice. You can set monthly
        spend limits in Dashboard → Billing.
      </p>

      <h2>Add-ons</h2>
      <ul>
        <li><strong>Additional voice profile:</strong> ₹500/month per profile</li>
        <li><strong>Dedicated DID number:</strong> ₹200/month per number</li>
        <li><strong>Long-term call recording retention (1 year):</strong> ₹500/month</li>
      </ul>

      <h2>Free trial</h2>
      <p>
        Every new account gets <strong>14 days free</strong> on any plan — no card
        required. After the trial, choose a plan or your account becomes read-only.
      </p>

      <h2>Refunds</h2>
      <p>See our <a href="/refund-policy">Refund Policy</a> for full details.</p>

      <h2>Need a custom plan?</h2>
      <p>
        Volume discounts available for 10+ branches or 5,000+ minutes/month. Email
        <a href="mailto:hello@heynikki.in"> hello@heynikki.in</a> with your call volume and
        we'll send a quote.
      </p>
    </LegalLayout>
  );
}
