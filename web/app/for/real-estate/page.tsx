import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Receptionist for Real Estate Offices — Telugu Property Enquiries | HeyNikki",
  description:
    "Every property enquiry answered in Telugu, even during a site visit. Nikki quotes "
    + "from your project brochure, captures the lead with budget and intent, and books "
    + "site visits. From ₹1,999/month.",
  alternates: { canonical: "https://www.heynikki.in/for/real-estate" },
};

export default function Page() {
  return (
    <ContentPage
      h1="Property enquiries answered while you are at a site visit"
      lede="A missed property call is not a missed call — it is a buyer who rang the next builder. Nikki answers in Telugu, quotes from your project brochure, captures budget and intent, and books the site visit."
    >
      <h2>The economics are different here</h2>
      <p>
        In most businesses a missed call costs a small sale. In property it costs a
        conversation that might have been worth lakhs, and it happens precisely when your
        team is unavailable — at a site, with another buyer, driving between projects.
        One recovered enquiry a month pays for this many times over.
      </p>

      <h2>She knows the project</h2>
      <p>
        Upload the brochure and she reads it. Callers ask the same five things, and she
        answers them from your own document: how many acres, what approvals, price per
        yard, possession timeline, what is nearby.
      </p>
      <p>
        A live customer's brochure produced sixty facts she can quote — approvals, plot
        sizes, the project name and location — which is the difference between &quot;let me
        take your number&quot; and an answer that keeps the buyer talking.
      </p>

      <h2>Qualifying, not just answering</h2>
      <ul>
        <li><strong>Budget and intent</strong> captured in conversation, not from a form nobody fills in.</li>
        <li><strong>Lead scoring</strong> so a serious buyer sits at the top of your callback list rather than fourth from the bottom.</li>
        <li><strong>Site visits booked</strong> with a WhatsApp confirmation and a reminder the day before.</li>
        <li><strong>Brochure sent</strong> on WhatsApp during the call, so they are reading it while you are still fresh in mind.</li>
      </ul>

      <h2>Calling old enquiries back</h2>
      <p>
        Most property offices sit on a spreadsheet of enquiries nobody has had time to
        call. Nikki can work through it in Telugu — new launch, price revision, a slot at
        the weekend — and report who was interested. She can also negotiate within a floor
        you set, which matters when the conversation turns to rate. See{" "}
        <a href="/ai-telecaller">AI telecalling</a>.
      </p>

      <h2>What it costs</h2>
      <p>
        From <strong>₹1,999 a month</strong> for answering; outbound campaigns are on
        Growth at ₹4,999. Start with <strong>100 free minutes</strong> — no card. Read the{" "}
        <a href="/telugu-ai-receptionist">receptionist overview</a> or{" "}
        <a href="/pricing">pricing</a>.
      </p>

      <Faq items={[
        { q: "Can it answer questions about a specific project?",
          a: "Yes. Upload the brochure and she reads it herself — approvals, plot sizes, price per yard, possession timeline. One live customer's brochure produced sixty facts she can quote on a call." },
        { q: "Does it capture the buyer's budget?",
          a: "It captures budget and intent from the conversation rather than a form, scores how serious the enquiry sounded, and puts the strongest leads at the top of your callback list." },
        { q: "Can it send the brochure to the caller?",
          a: "Yes, on WhatsApp during the call, so the buyer is reading it while the conversation is still fresh." },
        { q: "Can it call our old enquiry list?",
          a: "Yes, in Telugu, reporting who was interested. You declare consent for each contact when you upload the list — who gave it and when — and a number without it is never dialled, because TRAI rules do not allow cold calling a bought list." },
        { q: "Can it negotiate on rate?",
          a: "Within limits you set — the lowest figure you will accept and what she may offer instead of a discount. She never goes below your floor and never invents an offer." },
      ]} />
    </ContentPage>
  );
}
