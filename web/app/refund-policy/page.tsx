import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Refund Policy — Nikki" };

export default function Refund() {
  return (
    <LegalLayout title="Refund & Cancellation Policy" lastUpdated="29 June 2026">
      <p>
        This Refund Policy describes when and how Nikki Technologies issues refunds
        for subscription fees and related charges.
      </p>

      <h2>1. 14-day free trial</h2>
      <p>
        All new accounts get a 14-day free trial of any plan. No card is required. If you
        don't subscribe at the end of the trial, your account becomes read-only and is
        permanently deleted after 30 days. Nothing is charged — nothing to refund.
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
        <li>
          <strong>Service outage:</strong> if Nikki is unavailable for more than 8 hours in
          a single billing month, you can claim a 10% credit toward the next month's bill
          by emailing us within 30 days.
        </li>
      </ul>

      <h2>3. Annual subscriptions</h2>
      <p>
        Annual subscriptions can be cancelled within <strong>14 days</strong> of the
        initial purchase for a full refund. After 14 days, the subscription is
        non-refundable, but cancellation prevents future renewals.
      </p>

      <h2>4. Add-ons and overage charges</h2>
      <p>
        Per-minute overage charges (calls beyond your plan's included minutes) are
        non-refundable, since the underlying compute and telephony costs are already
        incurred.
      </p>

      <h2>5. Cancellation</h2>
      <p>
        You can cancel anytime from <strong>Dashboard → Billing → Cancel</strong> or by
        emailing <a href="mailto:support@heynikki.in">support@heynikki.in</a>. Cancellation takes
        effect at the end of the current billing cycle — you keep service until then.
      </p>

      <h2>6. How refunds are processed</h2>
      <ul>
        <li>Refunds are issued to the original payment method (UPI, card, netbanking) via Razorpay.</li>
        <li><strong>Timeline:</strong> 5–7 business days for UPI and netbanking; 7–14 business days for credit/debit cards (set by issuing bank).</li>
        <li>You'll receive a confirmation email when the refund is initiated.</li>
      </ul>

      <h2>7. Disputes</h2>
      <p>
        If you believe you've been charged in error, email
        <a href="mailto:billing@heynikki.in"> billing@heynikki.in</a> within 30 days of the
        charge with your invoice number. We respond within 3 business days. If we can't
        resolve it, you may approach Razorpay's grievance process or the appropriate
        consumer forum.
      </p>

      <h2>8. Contact</h2>
      <p>
        <strong>Refunds & billing:</strong> <a href="mailto:billing@heynikki.in">billing@heynikki.in</a><br />
        <strong>General support:</strong> <a href="mailto:support@heynikki.in">support@heynikki.in</a>
      </p>
    </LegalLayout>
  );
}
