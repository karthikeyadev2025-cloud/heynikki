import LegalLayout from "../../components/LegalLayout";

export const metadata = { title: "Privacy Policy — Nikki" };

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="29 June 2026">
      <p>
        Nikki Technologies ("<strong>Nikki</strong>", "we", "us", "our") respects
        your privacy and is committed to protecting your personal data. This Privacy Policy
        explains what data we collect, why, how we use it, and the rights you have over it
        under the <strong>Digital Personal Data Protection Act, 2023 (DPDP Act)</strong> of
        India.
      </p>

      <h2>1. Data we collect</h2>
      <h3>Account data</h3>
      <ul>
        <li><strong>From you:</strong> name, business name, email address, phone number, GSTIN (if provided).</li>
        <li><strong>From your use of Nikki:</strong> business hours, voice profile selection, billing plan.</li>
      </ul>

      <h3>Call data (from callers to your business)</h3>
      <ul>
        <li>Caller phone numbers, call timestamps, call duration.</li>
        <li>Call audio recordings (encrypted at rest with AES-256-GCM).</li>
        <li>Transcripts of caller-AI conversations.</li>
        <li>Appointment details captured by the AI receptionist.</li>
      </ul>

      <h3>Technical data</h3>
      <ul>
        <li>IP addresses, device type, browser, OS — for security and analytics.</li>
        <li>Crash reports and performance metrics.</li>
      </ul>

      <h2>2. How we use your data</h2>
      <ul>
        <li><strong>To provide the service:</strong> answer calls, book appointments, send confirmations, generate analytics.</li>
        <li><strong>To bill you:</strong> via Razorpay; we never see or store your full card number.</li>
        <li><strong>To improve our AI:</strong> aggregated, de-identified call patterns help us improve language understanding. We do <strong>not</strong> use individual call audio or transcripts to train models without your explicit opt-in.</li>
        <li><strong>To comply with law:</strong> TRAI disclosure requirements, lawful interception orders.</li>
      </ul>

      <h2>3. Where your data is stored</h2>
      <p>
        All caller data, account data, and call recordings are stored on servers in
        <strong> Mumbai, India</strong> (AWS Asia Pacific — ap-south-1 region, via Supabase).
        Backups are encrypted and retained for 30 days.
      </p>
      <p>
        Limited operational metadata (e.g. login emails, plan tier) may be processed by
        Vercel (USA) for web hosting and Resend (USA) for transactional emails. We have
        signed Data Processing Agreements with these vendors.
      </p>

      <h2>4. How long we keep your data</h2>
      <ul>
        <li><strong>Call recordings:</strong> 90 days, then permanently deleted. You can request shorter retention in your dashboard settings.</li>
        <li><strong>Transcripts:</strong> 2 years (for analytics and dispute resolution).</li>
        <li><strong>Billing records:</strong> 8 years (statutory requirement under Indian tax law).</li>
        <li><strong>Account data:</strong> until you delete your account, plus 30 days for backup expiry.</li>
      </ul>

      <h2>5. Your rights under DPDP Act</h2>
      <p>You have the right to:</p>
      <ul>
        <li><strong>Access</strong> the personal data we hold about you.</li>
        <li><strong>Correct</strong> inaccurate or incomplete data.</li>
        <li><strong>Erase</strong> data (subject to legal retention obligations like tax records).</li>
        <li><strong>Withdraw consent</strong> at any time — though this may end the service.</li>
        <li><strong>Nominate</strong> another person to exercise these rights on your behalf in the event of your death or incapacity.</li>
        <li><strong>Grievance redressal</strong> — file a complaint with our Grievance Officer (below).</li>
      </ul>
      <p>
        Email <a href="mailto:privacy@jovio.in">privacy@jovio.in</a> to exercise any of these
        rights. We respond within 30 days.
      </p>

      <h2>6. TRAI compliance for callers</h2>
      <p>
        Every inbound call answered by Nikki begins with a mandatory non-skippable
        disclosure stating that the caller is speaking to an automated AI system. Callers
        can request transfer to a human at any time by saying "human" or "operator", which
        will end the AI session and forward to the configured fallback number.
      </p>

      <h2>7. Cookies</h2>
      <p>
        We use essential cookies only — for authentication (Supabase session) and
        CSRF protection. We do <strong>not</strong> use third-party advertising cookies or
        behavioural tracking. See our cookie banner on first visit for the full list.
      </p>

      <h2>8. Children</h2>
      <p>
        Nikki is a B2B service intended for businesses. We do not knowingly collect data
        from children under 18. If you believe a minor has signed up, email us and we'll
        delete the account.
      </p>

      <h2>9. Security</h2>
      <ul>
        <li>All data in transit is encrypted via TLS 1.3.</li>
        <li>Call recordings are encrypted at rest with AES-256-GCM, per-tenant keys.</li>
        <li>Database access is limited to authorised personnel with audited credentials.</li>
        <li>We perform security reviews of every release before deployment.</li>
      </ul>
      <p>
        We will notify affected users and the Data Protection Board of India within 72
        hours of becoming aware of a personal data breach involving significant harm.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We'll email you 30 days before any material change. Continued use of Nikki after a
        change means you accept the updated policy.
      </p>

      <hr />

      <h2>Grievance Officer</h2>
      <p>
        <strong>Karthikeya</strong><br />
        Nikki Technologies<br />
        Hyderabad, Telangana, India<br />
        Email: <a href="mailto:privacy@jovio.in">privacy@jovio.in</a>
      </p>
      <p style={{ fontSize: 13, color: "#9CA3AF" }}>
        Designated as Grievance Officer per Section 13 of the DPDP Act, 2023.
      </p>
    </LegalLayout>
  );
}
