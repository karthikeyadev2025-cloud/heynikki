import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Contact — Nikki" };

export default function Contact() {
  return (
    <LegalLayout title="Contact us" lastUpdated="29 June 2026">
      <p>
        We're a small team in Hyderabad. Email is the fastest way to reach us — we
        usually respond within one business day.
      </p>

      <h2>Reach us by topic</h2>
      <ul>
        <li><strong>Sales & general:</strong> <a href="mailto:hello@jovio.in">hello@jovio.in</a></li>
        <li><strong>Support:</strong> <a href="mailto:support@jovio.in">support@jovio.in</a></li>
        <li><strong>Billing & refunds:</strong> <a href="mailto:billing@jovio.in">billing@jovio.in</a></li>
        <li><strong>Privacy & DPDP grievance:</strong> <a href="mailto:privacy@jovio.in">privacy@jovio.in</a></li>
        <li><strong>Legal:</strong> <a href="mailto:legal@jovio.in">legal@jovio.in</a></li>
        <li><strong>Security disclosure:</strong> <a href="mailto:security@jovio.in">security@jovio.in</a></li>
      </ul>

      <h2>Registered office</h2>
      <p>
        <strong>Jovio Global Technologies</strong><br />
        Hyderabad, Telangana, India
      </p>
      <p style={{ fontSize: 13, color: "#9CA3AF" }}>
        Full registered address is shared with prospective enterprise customers under NDA
        and with regulatory authorities on request.
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
        <a href="mailto:hello@jovio.in"> hello@jovio.in</a> with "Press" or "Partnership"
        in the subject line and we'll route it to the right person.
      </p>
    </LegalLayout>
  );
}
