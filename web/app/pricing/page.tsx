import LegalLayout from "../../components/LegalLayout";
import { Check } from "lucide-react";

export const metadata = {
  title: "Pricing — Hey Nikki",
  description:
    "Hey Nikki pricing: Shop ₹3,999, Team ₹9,999, Business ₹24,999 per month. "
    + "Every plan includes the Telugu AI receptionist, dashboard, recordings and "
    + "WhatsApp confirmations. 100 free minutes to start.",
};

// ── This page must agree with three other things ──────────────────────
// /api/platform/pricing (which now builds its tiers from the `plans` table),
// the homepage cards, and what /api/billing/create-subscription will accept.
//
// It did not. It sold a modular catalogue — "AI Telecaller ₹5,999/month,
// unlimited inbound" plus per-seat and per-number modules — while billing has
// only ever accepted starter/growth/scale, metered by minutes. The homepage
// carried that same ₹5,999 card once and it was removed with a note saying a
// prospect had been quoted it on the phone and would have seen metered tiers
// at signup. The homepage got fixed; the page in the nav labelled "Pricing"
// did not, so the contradiction simply moved.
//
// Figures are literals because this page is prerendered on Vercel and cannot
// reach the on-prem API at build time. They are a MIRROR of the plans table,
// never a source: change the plans row first, then this, then the homepage.
const TIERS = [
  {
    name: "Shop", price: "3,999", annual: "3,333", year: "39,990",
    line: "400 Nikki minutes · 300 telecaller minutes · 1 number · 1 person · 2 calls at once",
    points: [
      "Telugu, Hindi or English — your pick for the line, Tenglish understood",
      "Inbound reception on your own number",
      "Appointments and orders written straight to your dashboard",
      "WhatsApp confirmation on every booking",
      "Missed-call follow-up on WhatsApp",
      "Call recordings and transcripts, kept 3 months",
      "Call quality scoring on every call",
      "Telecaller Desk for one person: click-to-call, next-call queue, callbacks with reminders, call summaries",
    ],
  },
  {
    name: "Team", price: "9,999", annual: "8,333", year: "99,990",
    line: "1,000 Nikki minutes · 1,500 telecaller minutes · 2 numbers · 3 people · 4 calls at once",
    points: [
      "Everything in Shop",
      "Outbound campaigns, and new website leads called back automatically",
      "A calling number for each telecaller — callbacks ring them first",
      "3 voice profiles",
      "Recordings kept 1 year",
    ],
  },
  {
    name: "Business", price: "24,999", annual: "20,833", year: "2,49,990",
    line: "2,500 Nikki minutes · 3,500 telecaller minutes · 5 numbers · 8 people · 6 calls at once",
    points: [
      "Everything in Team",
      "API access and signed webhooks",
      "10 voice profiles",
      "Recordings kept 2 years",
      "Priority support on WhatsApp: +91 94407 69495",
    ],
  },
];

// The middle plan is the one most accounts choose; the homepage says the same.
const POPULAR = "Team";

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E4E9F0", borderRadius: 14, padding: 24,
  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
};

export default function Pricing() {
  return (
    <LegalLayout
      title="Pricing"
      eyebrow="Pricing"
      wide
      lede={<>Simple INR pricing, billed monthly. Every plan includes the Telugu AI
        receptionist, the dashboard, call recordings and transcripts. Prices are exclusive
        of GST. Pay yearly and get two months free.</>}
      updatedLabel="Prices as of"
      lastUpdated="26 September 2026"
    >
      {/* Free minutes first: it is the thing every visitor can use today. */}
      <div style={{ ...card, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap",
        borderLeft: "3px solid #22C55E", marginBottom: 24 }}>
        <div style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700,
          color: "#0F172A", letterSpacing: "-0.02em", lineHeight: 1 }}>100 min</div>
        <div style={{ flex: "1 1 320px", fontSize: 15, lineHeight: 1.55 }}>
          <strong>Free on every new account</strong> — no card required, and no time limit.
          After they run out, choose a plan or your account becomes read-only. Nothing is deleted.
        </div>
        <a href="/signup" style={{ background: "#12457A", color: "#fff", padding: "11px 20px", borderRadius: 999,
          fontWeight: 600, fontSize: 14.5, textDecoration: "none", whiteSpace: "nowrap" }}>Start free</a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 290px), 1fr))",
        gap: 18, alignItems: "stretch", marginBottom: 56 }}>
        {TIERS.map(t => {
          const pop = t.name === POPULAR;
          return (
            <section key={t.name} style={{
              ...card, position: "relative", display: "flex", flexDirection: "column",
              ...(pop ? { border: "1px solid #12457A", boxShadow: "0 0 0 3px rgba(18,69,122,0.12), 0 12px 32px rgba(15,23,42,0.08)" } : {}),
            }}>
              {pop && (
                <span style={{ position: "absolute", top: -12, left: 24, background: "#12457A", color: "#fff",
                  fontSize: 12, fontWeight: 600, padding: "3px 12px", borderRadius: 999 }}>
                  Most businesses start here
                </span>
              )}
              <h2 style={{ margin: "0 0 10px", fontSize: 18, color: "#0F172A" }}>{t.name}</h2>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 40, fontWeight: 700,
                  color: "#0F172A", letterSpacing: "-0.03em", lineHeight: 1 }}>₹{t.price}</span>
                <span style={{ fontSize: 14, color: "#475569" }}>/month</span>
              </div>
              <div style={{ fontSize: 13.5, color: "#64748B", margin: "6px 0 16px" }}>
                or ₹{t.annual}/month billed yearly (₹{t.year})
              </div>
              <div style={{ fontSize: 13.5, color: "#0F172A", background: "#F1F4F8", borderRadius: 8,
                padding: "8px 12px", marginBottom: 18, lineHeight: 1.5 }}>{t.line}</div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 22px", flex: 1 }}>
                {t.points.map(pt => (
                  <li key={pt} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                    fontSize: 14.5, lineHeight: 1.5, color: "#334155", marginBottom: 9 }}>
                    <Check size={16} color="#16A34A" style={{ flexShrink: 0, marginTop: 3 }} />{pt}
                  </li>
                ))}
              </ul>
              <a href="/signup" style={{
                display: "block", textAlign: "center", padding: "12px", borderRadius: 10,
                fontWeight: 600, fontSize: 15, textDecoration: "none",
                ...(pop ? { background: "#12457A", color: "#fff" }
                        : { background: "#fff", color: "#0F172A", border: "1px solid #D8DFE8" }),
              }}>Start with {t.name}</a>
            </section>
          );
        })}
      </div>

      <h2 style={{ fontSize: 26, margin: "0 0 18px" }}>How billing works</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18 }}>
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>If you go over your minutes</h3>
          <p>
            {/* Say the whole of it. The dashboard's billing page quotes "₹15/extra
                minute" while this page previously said only "upgrade", so a
                customer comparing the two found two different stories. What the
                code does (usage.ts minutesGate): calls are REFUSED once the plan's
                minutes are gone unless bought credit remains — nothing is ever
                billed to them without a purchase. */}
            Nikki&apos;s minutes and your telecallers&apos; minutes are counted separately, so a busy
            calling day never uses up the minutes that keep Nikki answering. You are never
            billed automatically for going over: when either runs out, those calls stop until
            you upgrade to the next plan, which you can do at any time from the billing page.
            Nothing is ever charged to you that you did not buy.
          </p>
          <p style={{ marginBottom: 0 }}>
            {/* Do NOT advertise buyable add-on minutes here. The Razorpay webhook
                can grant them (notes.type === "addon_minutes" → credit_ledger),
                but NOTHING in the product creates such an order: there is no
                endpoint and no button, so a customer cannot buy them today. The
                dashboard's billing page quoted "Overage: ₹15/extra minute" for
                the same unbuyable thing; that line is gone now and the page says
                calls stop instead.
                If a top-up flow ships, say so here and quote plan_overage_paise. */}
            If you need extra minutes before your next billing date and do not want to move
            up a plan, email <a href="mailto:billing@heynikki.in">billing@heynikki.in</a> and
            we will add them to your account and invoice you for them.
          </p>
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Numbers and seats</h3>
          <p style={{ marginBottom: 0 }}>
            Business numbers and team seats come with your plan — one number and one person
            on Shop, two numbers and three people on Team, five numbers and eight people on
            Business. Numbers are assigned by our team once your KYC is approved; forward the
            number you already use to it, or hand out the new one.
          </p>
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Cancellation and refunds</h3>
          <p style={{ marginBottom: 0 }}>
            {/* Was "message us on WhatsApp and it's done the same day" — but no
                WhatsApp support number is published anywhere on this site, and
                cancellation is a super-admin action, so "same day" was a promise
                nobody was on the hook for. Give the channels that actually exist. */}
            Cancel any month. Email <a href="mailto:billing@heynikki.in">billing@heynikki.in</a>{" "}
            from the address on your account or call <a href="tel:+918633502031">+91 86335 02031</a>,
            and we action it within one business day. You keep access until the end of the
            period you&apos;ve paid for, and your call recordings and transcripts stay
            exportable. See the <a href="/refund-policy">Refund Policy</a> for refunds.
          </p>
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Need something different?</h3>
          <p style={{ marginBottom: 0 }}>
            Multi-branch businesses, high call volumes and custom integrations (CRM,
            calendar systems) are quoted individually. Email
            <a href="mailto:hello@heynikki.in"> hello@heynikki.in</a> with your call volume
            and we&apos;ll come back with a price.
          </p>
        </div>
      </div>
    </LegalLayout>
  );
}
