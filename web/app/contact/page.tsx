import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Contact — Hey Nikki" };

export default function Contact() {
  return (
    <LegalLayout title="Contact us" lastUpdated="29 June 2026">
      <p>
        We're a small team in Hyderabad. Email is the fastest way to reach us — we
        usually respond within one business day.
      </p>

      <h2>Reach us by topic</h2>
      <ul>
        <li>
          <strong>Phone:</strong>{" "}
          <a href="tel:+918633502031">+91 86335 02031</a>{" "}
          — answered by Nikki herself, in Telugu, Hindi or English. She is the
          same agent we sell; ring her and ask what she can do. She answers
          questions about the product and takes your number for anything she
          can&apos;t settle — a person calls you back within one business day.
          For an account or billing problem, email is faster.
        </li>
        <li><strong>Sales & general:</strong> <a href="mailto:hello@heynikki.in">hello@heynikki.in</a></li>
        <li><strong>Support:</strong> <a href="mailto:support@heynikki.in">support@heynikki.in</a></li>
        <li><strong>WhatsApp:</strong> <a href="https://wa.me/919440769495">+91 94407 69495</a> (priority support for Scale)</li>
        <li><strong>Billing & refunds:</strong> <a href="mailto:billing@heynikki.in">billing@heynikki.in</a></li>
        <li><strong>Privacy & DPDP grievance:</strong> <a href="mailto:privacy@heynikki.in">privacy@heynikki.in</a></li>
        <li><strong>Legal:</strong> <a href="mailto:legal@heynikki.in">legal@heynikki.in</a></li>
        <li><strong>Security disclosure:</strong> <a href="mailto:security@heynikki.in">security@heynikki.in</a></li>
      </ul>

      {/* Registered office and GSTIN, as Razorpay's merchant review expects
          them on the site. Supplied by the owner on 24 Sep 2026. */}
      <h2>Registered office</h2>
      <p>
        <strong>Nikki Technologies</strong><br />
        A unit of <strong>Adexos Global Technologies</strong><br />
        Bangalore, Karnataka, India<br />
        GSTIN: 37AVEPV3515A2ZR
      </p>
      <p>
        For any other business-registration detail, email{" "}
        <a href="mailto:legal@heynikki.in">legal@heynikki.in</a> and we will send it the
        same business day.
      </p>

      <h2>Cancellations, refunds and billing</h2>
      <p>
        To cancel a plan or ask about a charge, email{" "}
        <a href="mailto:billing@heynikki.in">billing@heynikki.in</a> from the address on
        your account, or call the number above. We action cancellations within one
        business day. See the <a href="/refund-policy">Refund Policy</a> for what is
        refundable and how long a refund takes.
      </p>

      <h2>Business hours</h2>
      <p>
        Monday – Friday, 10:00 – 19:00 IST.<br />
        The Nikki AI receptionist itself operates 24/7 — these hours are for human
        support and sales conversations.
      </p>

      <h2>Press & partnerships</h2>
      <p>
        Journalist? Investor? Distribution partner? Email
        <a href="mailto:hello@heynikki.in"> hello@heynikki.in</a> with "Press" or "Partnership"
        in the subject line and we'll route it to the right person.
      </p>
    </LegalLayout>
  );
}
