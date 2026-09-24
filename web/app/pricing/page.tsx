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
      "Missed-call follow-up on WhatsApp",
      "Call quality scoring on every call",
      "Telecaller Desk: click-to-call, next-call queue, callbacks with reminders, call summaries",
    ],
  },
  {
    name: "Growth", price: "4,999", annual: "3,333", year: "39,999",
    line: "600 minutes · 3 numbers · 3 people · 5 calls at once",
    points: [
      "Everything in Starter",
      "Outbound campaigns",
      "A calling number for each telecaller",
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
      "Priority support on WhatsApp: +91 94407 69495",
    ],
  },
];

export default function Pricing() {
  return (
    <LegalLayout title="Pricing" lastUpdated="24 September 2026">
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
        {/* Say the whole of it. The dashboard's billing page quotes "₹15/extra
            minute" while this page previously said only "upgrade", so a
            customer comparing the two found two different stories. What the
            code does (usage.ts minutesGate): calls are REFUSED once the plan's
            minutes are gone unless bought credit remains — nothing is ever
            billed to them without a purchase. */}
        You are never billed automatically for going over. When your included minutes run
        out, calls stop until you upgrade to the next plan, which you can do at any time
        from the billing page. Nothing is ever charged to you that you did not buy.
      </p>
      <p>
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

      <h2>Numbers and seats</h2>
      <p>
        Business numbers and team seats come with your plan — one of each on Starter,
        three on Growth, ten on Scale. Numbers are assigned by our team once your KYC
        is approved; forward the number you already use to it, or hand out the new one.
      </p>

      <h2>Cancellation</h2>
      <p>
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
