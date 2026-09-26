import LegalLayout from "../../components/LegalLayout";
import { Phone, Mail, MessageCircle, Building2, Clock } from "lucide-react";

export const metadata = { title: "Contact — Hey Nikki" };

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E4E9F0", borderRadius: 14, padding: 22,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
};
const iconBox: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 10, background: "rgba(18,69,122,0.08)", color: "#12457A",
  display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
};
const big: React.CSSProperties = {
  display: "inline-block", fontFamily: "var(--font-display), sans-serif", fontSize: 21, fontWeight: 700,
  color: "#0F172A", letterSpacing: "-0.01em", textDecoration: "none", margin: "2px 0 8px",
};

// Every address that reaches a person, by what it is for.
const TOPICS: [string, string][] = [
  ["Sales & general", "hello@heynikki.in"],
  ["Support", "support@heynikki.in"],
  ["Billing & refunds", "billing@heynikki.in"],
  ["Privacy & DPDP grievance", "privacy@heynikki.in"],
  ["Legal", "legal@heynikki.in"],
  ["Security disclosure", "security@heynikki.in"],
];

export default function Contact() {
  return (
    <LegalLayout
      title="Contact us"
      eyebrow="Contact"
      wide
      lede="We're a small team in Hyderabad. Email is the fastest way to reach us — we usually respond within one business day."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
        gap: 18, marginBottom: 18 }}>
        <div style={card}>
          <span style={iconBox}><Phone size={18} /></span>
          <h3 style={{ margin: "0 0 2px" }}>Call Nikki</h3>
          <a href="tel:+918633502031" style={big}>+91 86335 02031</a>
          <p style={{ margin: 0, fontSize: 14.5 }}>
            Answered by Nikki herself, in Telugu, Hindi or English. She is the same agent
            we sell; ring her and ask what she can do. She answers questions about the
            product and takes your number for anything she can&apos;t settle — a person
            calls you back within one business day. For an account or billing problem,
            email is faster.
          </p>
        </div>

        <div style={card}>
          <span style={iconBox}><Mail size={18} /></span>
          <h3 style={{ margin: "0 0 2px" }}>Email us</h3>
          <a href="mailto:hello@heynikki.in" style={big}>hello@heynikki.in</a>
          <p style={{ margin: 0, fontSize: 14.5 }}>
            Sales and general questions. Already a customer? Write to{" "}
            <a href="mailto:support@heynikki.in">support@heynikki.in</a> from the address on
            your account.
          </p>
        </div>

        <div style={card}>
          <span style={{ ...iconBox, background: "rgba(34,197,94,0.1)", color: "#16A34A" }}><MessageCircle size={18} /></span>
          <h3 style={{ margin: "0 0 2px" }}>WhatsApp</h3>
          <a href="https://wa.me/919440769495" style={big}>+91 94407 69495</a>
          <p style={{ margin: 0, fontSize: 14.5 }}>Priority support for accounts on the Business plan.</p>
        </div>
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #EEF2F6", color: "#0F172A",
          fontWeight: 700, fontSize: 16 }}>Reach us by topic</div>
        {TOPICS.map(([label, addr], i) => (
          <div key={addr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: 12, flexWrap: "wrap", padding: "13px 22px", borderTop: i ? "1px solid #EEF2F6" : "none" }}>
            <span style={{ color: "#0F172A", fontWeight: 500 }}>{label}</span>
            <a href={`mailto:${addr}`} style={{ fontFamily: "var(--font-mono), monospace", fontSize: 14 }}>{addr}</a>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
        gap: 18, marginBottom: 12 }}>
        {/* Registered office and GSTIN, as Razorpay's merchant review expects
            them on the site. Supplied by the owner on 24 Sep 2026. */}
        <div style={card}>
          <span style={iconBox}><Building2 size={18} /></span>
          <h3 style={{ margin: "0 0 8px" }}>Registered office</h3>
          <p style={{ margin: "0 0 10px" }}>
            <strong>Nikki Technologies</strong><br />
            A unit of <strong>Adexos Global Technologies</strong><br />
            Bangalore, Karnataka, India<br />
            GSTIN: <span style={{ fontFamily: "var(--font-mono), monospace", color: "#0F172A" }}>37AVEPV3515A2ZR</span>
          </p>
          <p style={{ margin: 0, fontSize: 14.5 }}>
            For any other business-registration detail, email{" "}
            <a href="mailto:legal@heynikki.in">legal@heynikki.in</a> and we will send it the
            same business day.
          </p>
        </div>

        <div style={card}>
          <span style={iconBox}><Clock size={18} /></span>
          <h3 style={{ margin: "0 0 8px" }}>Business hours</h3>
          <p style={{ margin: "0 0 10px" }}>
            <strong>Monday – Friday, 10:00 – 19:00 IST</strong>
          </p>
          <p style={{ margin: 0, fontSize: 14.5 }}>
            The Nikki AI receptionist itself operates 24/7 — these hours are for human
            support and sales conversations.
          </p>
        </div>
      </div>

      <h2>Cancellations, refunds and billing</h2>
      <p>
        To cancel a plan or ask about a charge, email{" "}
        <a href="mailto:billing@heynikki.in">billing@heynikki.in</a> from the address on
        your account, or call the number above. We action cancellations within one
        business day. See the <a href="/refund-policy">Refund Policy</a> for what is
        refundable and how long a refund takes.
      </p>

      <h2>Press & partnerships</h2>
      <p>
        Journalist? Investor? Distribution partner? Email
        <a href="mailto:hello@heynikki.in"> hello@heynikki.in</a> with &quot;Press&quot; or &quot;Partnership&quot;
        in the subject line and we&apos;ll route it to the right person.
      </p>
    </LegalLayout>
  );
}
