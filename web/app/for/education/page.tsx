import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Admissions Desk for Schools, Colleges and Coaching Institutes | HeyNikki",
  description:
    "Every admission enquiry answered in Telugu, Hindi or English, even in results "
    + "week. Nikki answers course questions, books campus visits and counselling, and "
    + "calls enquiries back. From ₹3,999/month, 100 free minutes.",
  alternates: { canonical: "https://www.heynikki.in/for/education" },
};

export default function Page() {
  return (
    <ContentPage
      h1="Every admission enquiry answered, even in results week"
      lede="Admissions arrive in a rush: the week results come out, the phone rings all day and the office can answer one call at a time. Nikki answers the rest — courses, batches, timings — and books the campus visit, so a parent who rang you does not end up enrolling at the college that picked up."
    >
      <h2>The season is short and the phone is one line</h2>
      <p>
        A parent choosing a college rings three or four in an afternoon. The one that
        answers and fixes a visit is usually the one that gets the admission. In the two
        or three weeks that matter, your office staff are also handling walk-ins, forms
        and fee counters, and the calls that ring out are the enquiries you paid to
        advertise for.
      </p>

      <h2>What she handles on the admissions line</h2>
      <ul>
        <li><strong>Course and batch questions</strong>, answered from your own prospectus. Upload the brochure and she reads it herself.</li>
        <li><strong>Campus visits and counselling sessions</strong>, booked with the parent&apos;s name and a day and time, and confirmed on WhatsApp.</li>
        <li><strong>Who is asking and for what</strong>: which course or class, for which year, for the caller or their child. It reaches your team as a lead, not a missed call.</li>
        <li><strong>Several calls at once.</strong> Two callers on Shop, four on Team, six on Business, so results day does not mean an engaged tone.</li>
      </ul>

      <h2>Calling your enquiries back</h2>
      <p>
        Most institutes are sitting on a list of people who enquired and never visited.
        On the Team plan and above, upload that list and Nikki rings each one, asks
        whether they are still looking, and invites them for a campus visit or the open
        day. Ready-made scripts for an enquiry follow-up and an entrance-test invitation
        are in the campaign form; anyone who asks not to be called is not called again.
      </p>

      <h2>What she will not say</h2>
      <p>
        She does not promise a seat, quote a fee or scholarship she was not given, or
        talk about cut-offs, results or placements she was not told. Asked for a seat
        guarantee she says the admissions team will confirm, and offers the visit. A
        parent asking for their child&apos;s attendance, marks or fee dues is told the office
        will call back, because she cannot see student records and should not guess.
      </p>

      <h2>Getting started</h2>
      <p>
        Choose <strong>Education</strong> in Setup, upload your prospectus, and forward
        the admissions number or use the one we give you. Start with{" "}
        <strong>100 free minutes</strong> before deciding anything. Plans and what each
        includes are on the <a href="/pricing">pricing page</a>; the calling side is
        described under <a href="/ai-telecaller">AI telecaller</a>.
      </p>

      <Faq items={[
        { q: "Can it tell parents our fees?",
          a: "Only if you have given them to her. Upload a fee sheet and she quotes from it; without one she says the admissions team will confirm, and offers a campus visit or a callback." },
        { q: "Will it promise an admission or a seat?",
          a: "No. She is told never to promise a seat, a scholarship, a result or a placement. She books the visit and leaves the decision to your admissions team." },
        { q: "Can it call the people who enquired last month?",
          a: "Yes, on the Team plan and above. Upload the list, pick the enquiry follow-up script, and she calls each number, asks whether they are still looking and invites them for a visit." },
        { q: "Which languages does it speak?",
          a: "Telugu, Hindi and English, and she follows the caller if they switch between them." },
        { q: "Can a parent ask about their child's attendance or marks?",
          a: "She cannot see student records, so she takes the student's name and class and has the office call back, rather than guessing." },
      ]} />
    </ContentPage>
  );
}
