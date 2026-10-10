import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Calling for Insurance — Renewals, Enquiries and Claims Desk | HeyNikki",
  description:
    "Renewal and premium reminders, new-policy enquiries and a claims line answered "
    + "in Telugu, Hindi or English. Nikki never calls a return guaranteed and never "
    + "decides a claim; your advisors and claims team do.",
  alternates: { canonical: "https://www.heynikki.in/for/insurance" },
};

export default function Page() {
  return (
    <ContentPage
      h1="Renewals remembered, enquiries answered, claims taken down properly"
      lede="An insurance business runs on calls nobody has time to make: the renewal due next week, the premium that slipped, the enquiry from yesterday. Nikki makes them and answers the ones coming in — and she stops exactly where a licensed advisor or the claims team has to take over."
    >
      <h2>The policies you lose are the ones nobody rang about</h2>
      <p>
        A policy rarely lapses because the customer decided to leave. It lapses because
        the due date passed quietly. An advisor with four hundred customers cannot ring
        each one before every renewal, so the reminders that get made are the ones for
        the biggest premiums, and the rest are left to an SMS.
      </p>

      <h2>Calls she makes</h2>
      <ul>
        <li><strong>Renewal reminders</strong> and <strong>premium due reminders</strong>, with the date, and an advisor&apos;s callback for anyone who wants to renew or needs help.</li>
        <li><strong>Lapsed policies</strong>: she tells the policyholder it can be revived and asks whether an advisor should call.</li>
        <li><strong>Motor insurance expiring</strong> this month: has it been renewed, and would they like a quotation.</li>
        <li><strong>New enquiries</strong> followed up the next day, and existing customers told about another cover in one sentence.</li>
        <li><strong>Claim documents pending</strong>, <strong>service feedback</strong> after a claim or a purchase, and <strong>advisor recruitment</strong> follow-ups.</li>
      </ul>
      <p>
        Each of these is a ready script in the campaign form. Calling campaigns are on
        the Team plan and above; anyone who asks not to be called is not called again.
      </p>

      <h2>Calls she answers</h2>
      <ul>
        <li><strong>A new policy:</strong> which kind and for whom, then a meeting or a callback from an advisor.</li>
        <li><strong>A renewal or a premium:</strong> the policy number and when they plan to pay, then an advisor&apos;s callback.</li>
        <li><strong>A claim:</strong> the policy number, what happened and when, passed to your claims team. If someone is hurt or in hospital right now, she says to call 108 first.</li>
        <li><strong>A change on a policy</strong> — address, nominee, a statement, a copy — noted for the service team.</li>
      </ul>

      <h2>Where she stops</h2>
      <p>
        She never calls a return, a bonus or a benefit guaranteed. She does not
        recommend or compare plans; the advisor does that. She does not quote a
        premium, a sum assured, a maturity value or a tax saving she was not given. She
        does not say what a policy covers, and never says a claim is approved, payable
        or rejected — only the claims team can. She does not ask about medical history.
      </p>

      <h2>The policyholder only</h2>
      <p>
        On a call about a policy someone already holds, she first makes sure she is
        speaking to the policyholder, by name when your list has one. If a family member
        answers, she says only where she is calling from and asks when to reach them.
      </p>

      <h2>No payments, no OTPs</h2>
      <p>
        She never takes a payment on a call and never asks for a card number, UPI PIN,
        OTP or password. Customers have been taught to distrust insurance calls that ask
        for those, and they are right to.
      </p>

      <h2>What it does not do yet</h2>
      <p>
        She does not read out a different premium or due date for each customer. A
        figure or a date is said only when it is written in the campaign&apos;s script, so
        one campaign per renewal date works well, and a single list with a different
        amount on every row does not, today. She also does not carry out verification
        calls that have to follow a fixed regulatory wording. You remain responsible
        for the solicitation and calling-hours rules that apply to you.
      </p>

      <h2>Getting started</h2>
      <p>
        Choose <strong>Insurance</strong> in Setup, upload your product brochure, and
        forward your number or use the one we give you. The first{" "}
        <strong>100 minutes are free</strong>. Plans are on the{" "}
        <a href="/pricing">pricing page</a>; the calling side is described under{" "}
        <a href="/ai-telecaller">AI telecaller</a>.
      </p>

      <Faq items={[
        { q: "Will it promise returns to make a sale?",
          a: "No. She is told never to call a return, a bonus or a benefit guaranteed, and never to recommend or compare plans. She arranges the advisor's call and stops there." },
        { q: "Can it tell a customer whether their claim will be paid?",
          a: "No. She takes the policy number, what happened and when, and passes it to your claims team. She never says a claim is approved, payable or rejected." },
        { q: "Can it remind every customer of their own premium amount?",
          a: "Not yet. She states an amount or a date only when it is written in the campaign script, so run one campaign per due date. Asked for a figure she does not have, she says an advisor will call." },
        { q: "What if a family member answers a renewal call?",
          a: "She says only where she is calling from and asks when the policyholder can be reached. Nothing about the policy is discussed with anyone else." },
        { q: "Does it take premium payments over the phone?",
          a: "No. She never takes a payment and never asks for a card number, UPI PIN, OTP or password. Payment happens only through your own channels." },
      ]} />
    </ContentPage>
  );
}
