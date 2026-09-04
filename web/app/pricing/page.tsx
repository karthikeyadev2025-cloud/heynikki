import LegalLayout from "../../components/LegalLayout";

export const metadata = {
  title: "Pricing — Hey Nikki",
  description:
    "Hey Nikki pricing: Starter ₹1,999, Growth ₹4,999, Scale ₹9,999 per month. "
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
    name: "Starter", price: "1,999", annual: "1,333", year: "15,999",
    line: "200 minutes · 1 number · 1 person · 2 calls at once",
    points: [
      "Telugu, Hindi or English — your pick for the line, Tenglish understood",
      "Inbound reception on your own number",
      "Appointments written straight to your dashboard",
      "WhatsApp confirmation on every booking",
      "Call recordings and transcripts, kept 3 months",
    ],
  },
  {
    name: "Growth", price: "4,999", annual: "3,333", year: "39,999",
    line: "600 minutes · 3 numbers · 3 people · 5 calls at once",
    points: [
      "Everything in Starter",
      "Outbound campaigns and missed-call follow-up",
      "Call quality scoring on every call",
      "Recordings kept 1 year",
    ],
  },
  {
    name: "Scale", price: "9,999", annual: "6,666", year: "79,999",
    line: "1,500 minutes · 10 numbers · 10 people · 10 calls at once",
    points: [
      "Everything in Growth",
      "API access",
      "Recordings kept 2 years",
      "Support on WhatsApp",
    ],
  },
];

export default function Pricing() {
  return (
    <LegalLayout title="Pricing" lastUpdated="4 September 2026">
      <p>
        Simple INR pricing, billed monthly. Every plan includes the Hey Nikki Telugu
        AI receptionist, the dashboard, call recordings and transcripts. Prices are
        exclusive of GST. Annual billing saves a third.
      </p>

      {TIERS.map(t => (
        <section key={t.name}>
          <h2>
            {t.name} — ₹{t.price}/month
          </h2>
          <p>
            <em>{t.line}</em> · ₹{t.year}/year billed annually (₹{t.annual}/month)
          </p>
          <ul>
            {t.points.map(p => <li key={p}>{p}</li>)}
          </ul>
        </section>
      ))}

      <h2>Free minutes</h2>
      <p>
        Every new account gets <strong>100 free minutes</strong> — no card required, and
        no time limit. After they run out, choose a plan or your account becomes
        read-only. Nothing is deleted.
      </p>

      <h2>If you go over your minutes</h2>
      <p>
        Need more minutes? Upgrade to the next plan any time.
      </p>

      <h2>Numbers and seats</h2>
      <p>
        Business numbers and team seats come with your plan — one of each on Starter,
        three on Growth, ten on Scale. Numbers are assigned by our team once your KYC
        is approved; forward the number you already use to it, or hand out the new one.
      </p>

      <h2>Cancellation</h2>
      <p>
        Cancel any month — message us on WhatsApp and it&apos;s done the same day. You keep access until the end of the
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
