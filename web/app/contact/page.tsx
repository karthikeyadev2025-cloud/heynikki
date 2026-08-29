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
          same agent we sell; ring her and ask what she can do.
        </li>
        <li><strong>Sales & general:</strong> <a href="mailto:hello@heynikki.in">hello@heynikki.in</a></li>
        <li><strong>Support:</strong> <a href="mailto:support@heynikki.in">support@heynikki.in</a></li>
        <li><strong>Billing & refunds:</strong> <a href="mailto:billing@heynikki.in">billing@heynikki.in</a></li>
        <li><strong>Privacy & DPDP grievance:</strong> <a href="mailto:privacy@heynikki.in">privacy@heynikki.in</a></li>
        <li><strong>Legal:</strong> <a href="mailto:legal@heynikki.in">legal@heynikki.in</a></li>
        <li><strong>Security disclosure:</strong> <a href="mailto:security@heynikki.in">security@heynikki.in</a></li>
      </ul>

      <h2>Registered office</h2>
      <p>
        <strong>Hey Nikki</strong><br />
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
        <a href="mailto:hello@heynikki.in"> hello@heynikki.in</a> with "Press" or "Partnership"
        in the subject line and we'll route it to the right person.
      </p>
    </LegalLayout>
  );
}
