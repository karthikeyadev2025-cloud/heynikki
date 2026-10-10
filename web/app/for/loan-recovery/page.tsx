import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Repayment Reminder Calls for Lenders and Collections Teams | HeyNikki",
  description:
    "Instalment reminders and promise-to-pay calls in Telugu, Hindi or English. "
    + "Nikki speaks to the borrower only, never threatens, calls between 8 am and 7 pm, "
    + "and hands disputes and hardship to your officer.",
  alternates: { canonical: "https://www.heynikki.in/for/loan-recovery" },
};

export default function Page() {
  return (
    <ContentPage
      h1="Repayment reminders that stay polite on the thousandth call"
      lede="Most overdue instalments are forgotten, not refused, and a calm reminder with a date agreed is enough. Nikki makes those calls — the same way every time, to the borrower only, with no threats — and leaves your officers the accounts that need a person."
    >
      <h2>Where collections go wrong on the phone</h2>
      <p>
        The risk in a collections call is rarely the borrower. It is the sentence a
        tired agent says on call two hundred: the loan mentioned to a wife or a
        colleague, a consequence that was made up, a raised voice. Each of those is a
        complaint waiting to be filed against the lender.
      </p>

      <h2>How she makes the call</h2>
      <ul>
        <li><strong>The borrower first.</strong> She asks whether she is speaking with the account holder, by name when the list has one. Until they say yes, she says nothing about a loan, dues or money. If someone else answers, she asks only for a good time to reach them.</li>
        <li><strong>One clear ask.</strong> She says the instalment is pending and asks which date they can pay, then says the date back to confirm it.</li>
        <li><strong>Hardship and disputes go to a person.</strong> Already paid, not my loan, lost my job, a death in the family: she does not question it. She says an accounts officer will call, and ends the call.</li>
        <li><strong>The answer on record.</strong> Every call has a recording, a transcript and a written summary, so the date a borrower promised is there to read.</li>
      </ul>

      <h2>What she never does</h2>
      <p>
        She does not threaten, shame or argue. She does not mention police, court, a
        legal notice, a visit to the home or workplace, or the borrower&apos;s family or
        employer. She does not invent an amount, a penalty or a deadline. She does not
        take a payment on the call and never asks for a card number, UPI PIN, OTP or
        password. A borrower who asks not to be called is told it is noted, and the
        call ends.
      </p>

      <h2>Calling hours</h2>
      <p>
        A loan recovery account dials only between 8 am and 7 pm, whatever calling
        window is typed into the campaign. Calls stop at seven, including the ones
        already queued.
      </p>

      <h2>What it does not do yet</h2>
      <p>
        She does not read out an outstanding amount for each borrower. She states a
        figure or a due date only when it is written in the campaign&apos;s script, so a
        reminder for one due date works well and a list with a different amount per
        person does not, today. Asked &quot;how much do I owe&quot;, she says an accounts
        officer will call with the details. Settlements, waivers and new instalment
        plans are always your officer&apos;s decision, never hers.
      </p>

      <h2>Borrowers who call back</h2>
      <p>
        Your own number is answered by the same desk. A borrower returning the call is
        asked who they are, can say when they will pay, and can ask for an officer.
        Anyone else ringing that number is told only that the office will contact the
        account holder.
      </p>

      <h2>Getting started</h2>
      <p>
        Calling campaigns are on the Team plan and above. Choose{" "}
        <strong>Loan recovery</strong> in Setup, upload the list with names, and start
        from the instalment-reminder or overdue script. You remain responsible for your
        own recovery policy and for the regulator&apos;s rules that apply to you; this desk is
        built to stay inside the conduct those rules expect. See{" "}
        <a href="/pricing">pricing</a> and the <a href="/ai-telecaller">AI telecaller</a>{" "}
        overview.
      </p>

      <Faq items={[
        { q: "What if a family member answers the borrower's phone?",
          a: "She says nothing about a loan, dues or money. She asks only for a good time to reach the account holder and ends the call." },
        { q: "Can it tell each borrower how much they owe?",
          a: "Not yet. She states an amount or due date only when it is written in the campaign script, which suits one reminder for one due date. Asked for a figure she does not have, she says an accounts officer will call." },
        { q: "What does it do when a borrower says they cannot pay?",
          a: "She does not argue or press. She says an accounts officer will call to talk it through, and ends the call. Disputes such as already paid or not my loan are handled the same way." },
        { q: "Does it call at night or early in the morning?",
          a: "No. A loan recovery account dials only between 8 am and 7 pm, whatever window is set on the campaign." },
        { q: "Does it collect payments on the call?",
          a: "No. She never takes a payment and never asks for a card number, UPI PIN, OTP or password. Payment happens only through the lender's own channels." },
      ]} />
    </ContentPage>
  );
}
