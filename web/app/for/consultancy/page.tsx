import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Receptionist for Consultancies — Visa, Study Abroad, Jobs, Tax | HeyNikki",
  description:
    "Enquiries answered and consultations booked while your consultants are with "
    + "clients. Nikki captures what each caller needs, follows up old enquiries, and "
    + "never promises a visa, a job or an approval.",
  alternates: { canonical: "https://www.heynikki.in/for/consultancy" },
};

export default function Page() {
  return (
    <ContentPage
      h1="Enquiries booked into consultations while you are with a client"
      lede="A consultant in a session cannot pick up the phone, and the person ringing about a UK intake or a job abroad is also ringing two other consultancies. Nikki answers, finds out what they need, and books the consultation — so the first conversation they have is with you."
    >
      <h2>The enquiry does not wait</h2>
      <p>
        People ring a consultancy when they have just decided something: to study
        abroad, to change jobs, to register a company. That decision is fresh for a day
        or two. An enquiry returned next week is talking to someone who has already paid
        a registration fee elsewhere.
      </p>

      <h2>What she handles</h2>
      <ul>
        <li><strong>Consultations</strong>, booked with a day and time inside your working hours and confirmed on WhatsApp.</li>
        <li><strong>What the caller actually needs</strong>: the country and intake for study or visa work, the role for a job search, the kind of business for tax or legal work. Your consultant walks in knowing it.</li>
        <li><strong>Questions about your services</strong>, answered from what you have taught her or the brochure you uploaded.</li>
        <li><strong>A person, when they ask for one.</strong> She transfers the call rather than holding a caller who wants a human.</li>
      </ul>

      <h2>What she never promises</h2>
      <p>
        This is the part that matters in this business. She gives no opinion on a
        caller&apos;s case and never says a visa, an admission, a job, a loan or an approval
        will come through. Asked for a success rate she does not give one. Fees,
        timelines and document lists are quoted only if you gave them to her; otherwise
        the consultant covers them in the consultation. She does not ask for passport
        numbers, bank details or documents on a call.
      </p>

      <h2>Following up, without a telecaller chasing a list</h2>
      <p>
        On the Team plan and above she rings the people who enquired and never came in,
        and clients whose documents are still pending. If you have telecallers of your
        own, the Desk gives them a queue, a recording and a written summary of every
        call, and books the next call when a customer says they are interested.
      </p>

      <h2>Getting started</h2>
      <p>
        Choose <strong>Consultancy</strong> in Setup, list your services, and forward
        your number or use the one we give you. The first{" "}
        <strong>100 minutes are free</strong>. See <a href="/pricing">pricing</a> for
        what each plan includes.
      </p>

      <Faq items={[
        { q: "Will it tell a caller they will get their visa?",
          a: "No. She never says a visa, admission, job or approval will come through and gives no success rate. She books a consultation and leaves the assessment to your consultant." },
        { q: "Can it quote our fees?",
          a: "Only the ones you have given her. Without them she says the consultant covers fees in the consultation." },
        { q: "Does it collect documents or passport details on the call?",
          a: "No. She is told never to ask for a passport number, bank details or documents on a call." },
        { q: "Can it follow up old enquiries?",
          a: "Yes, on the Team plan and above. Upload the list and she calls each number, asks what they are planning and invites them for a consultation." },
        { q: "We already have telecallers. Is this still useful?",
          a: "Yes. Nikki answers what they cannot pick up, and the Desk gives your telecallers recordings, written summaries and follow-ups booked automatically." },
      ]} />
    </ContentPage>
  );
}
