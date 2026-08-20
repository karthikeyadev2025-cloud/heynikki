import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Terms of Service — Hey Nikki" };

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="29 June 2026">
      <p>
        These Terms govern your use of Nikki (the "<strong>Service</strong>"), provided by
        Hey Nikki ("<strong>Hey Nikki</strong>", "we", "us"). By creating an
        account, you agree to these Terms. If you don't agree, don't use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        Nikki is a Telugu-first AI receptionist that answers inbound calls on behalf of
        your business, books appointments, and sends WhatsApp confirmations. The Service
        includes a web dashboard, mobile app, and the underlying voice pipeline.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be 18 or older and authorised to bind your business to these Terms.</li>
        <li>You're responsible for keeping your password secure and for all activity under your account.</li>
        <li>Tell us immediately at <a href="mailto:support@heynikki.in">support@heynikki.in</a> if you suspect unauthorised access.</li>
        <li>One account per business entity. Resellers must contact us for partner terms.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You will <strong>not</strong>:</p>
      <ul>
        <li>Use Nikki for spam, robocalls, telemarketing without proper consent, or any activity violating TRAI regulations.</li>
        <li>Attempt to bypass usage limits, reverse-engineer the Service, or scrape our infrastructure.</li>
        <li>Use the Service to harass, defame, or harm any person.</li>
        <li>Use the Service for any unlawful purpose under Indian law.</li>
        <li>Misrepresent yourself or your business to callers in violation of TRAI's AI disclosure norms.</li>
      </ul>
      <p>We may suspend or terminate accounts that violate this section. Egregious violations may be reported to TRAI or law enforcement.</p>

      <h2>4. Billing</h2>
      <ul>
        <li>Plans are billed monthly via Razorpay. GST (18%) is added at checkout.</li>
        <li>The 14-day free trial requires no card. If you don't subscribe after the trial, your account becomes read-only and is deleted after 30 days.</li>
        <li>We may change pricing with 30 days' notice. Existing subscriptions are honoured at the old price until renewal.</li>
        <li>Failed payments lead to a 7-day grace period; service is paused after that until payment is settled.</li>
        <li>Refund eligibility is governed by our <a href="/refund-policy">Refund Policy</a>.</li>
      </ul>

      <h2>5. Your data and ours</h2>
      <p>
        You retain ownership of all data you upload and all caller data generated through
        your account ("<strong>Your Data</strong>"). You grant Nikki a limited licence to
        process Your Data solely to provide the Service. See our
        <a href="/privacy"> Privacy Policy</a> for details.
      </p>
      <p>
        Nikki retains ownership of the underlying software, AI models, and brand. You may
        not copy, modify, or distribute these.
      </p>

      <h2>6. Service availability</h2>
      <p>
        We target <strong>99.5% monthly uptime</strong> for inbound call handling.
        Scheduled maintenance is announced at least 48 hours in advance. If we fall below
        99.5% in any calendar month, Scale-plan customers are eligible for a 10% credit
        toward the next month's bill, claimable by emailing
        <a href="mailto:support@heynikki.in"> support@heynikki.in</a> within 30 days.
      </p>

      <h2>7. Third-party services</h2>
      <p>Nikki relies on third-party services to function:</p>
      <ul>
        <li>Sarvam AI (speech)</li>
        <li>Google Gemini (language understanding)</li>
        <li>Supabase (data storage)</li>
        <li>Razorpay (payments)</li>
        <li>Wati (WhatsApp Business API)</li>
        <li>Exotel (telephony)</li>
      </ul>
      <p>
        Their outages affect ours. We are not liable for failures caused by these
        providers but will work to restore service as quickly as possible.
      </p>

      <h2>8. Termination</h2>
      <ul>
        <li>You can cancel anytime from the dashboard. Cancellation takes effect at the end of the current billing cycle.</li>
        <li>We may terminate immediately for material breach of these Terms or non-payment beyond the grace period.</li>
        <li>Upon termination: you can export your data for 30 days, after which it's permanently deleted (except records we must retain by law).</li>
      </ul>

      <h2>9. Disclaimers</h2>
      <p>
        Nikki is provided "as is". The AI receptionist makes its best effort but is not a
        substitute for a human in life-threatening, medical-emergency, or other
        critical-decision contexts. You are responsible for configuring appropriate
        fallback numbers for situations requiring human handling.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Nikki's total aggregate liability for any
        claim arising out of or related to the Service is limited to the amount you paid
        us in the 12 months preceding the claim. We are not liable for indirect,
        incidental, consequential, or punitive damages.
      </p>
      <p>
        Nothing in these Terms limits liability for fraud, gross negligence, or any
        liability that cannot be limited under Indian law.
      </p>

      <h2>11. Indemnity</h2>
      <p>
        You will defend, indemnify, and hold harmless Nikki from third-party claims
        arising from (a) your breach of these Terms, (b) your violation of law, or (c) your
        Data infringing a third party's rights.
      </p>

      <h2>12. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of India. Any dispute will be resolved in
        the courts of <strong>Hyderabad, Telangana</strong>. The parties will first attempt
        good-faith resolution by email for 30 days before initiating proceedings.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update these Terms. Material changes will be emailed 30 days in advance.
        Continued use after the effective date means acceptance.
      </p>

      <h2>14. Contact</h2>
      <p>
        Email <a href="mailto:legal@heynikki.in">legal@heynikki.in</a> for legal notices.
        See our <a href="/contact">Contact page</a> for general support.
      </p>
    </LegalLayout>
  );
}
