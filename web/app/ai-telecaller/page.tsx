import ContentPage, { Faq } from "../../components/ContentPage";

export const metadata = {
  title: "AI Telecaller in Telugu — Call Your Customer List Automatically | HeyNikki",
  description:
    "An AI telecaller that rings your customer list in Telugu, has a real conversation, "
    + "and tells you who was interested. No calling team, no scripts read badly. "
    + "Outbound campaigns from ₹4,999/month.",
  alternates: { canonical: "https://www.heynikki.in/ai-telecaller" },
};

export default function Page() {
  return (
    <ContentPage
      h1="An AI telecaller that actually holds a conversation"
      lede="Give Nikki a list and what to say. She rings each number in Telugu, answers what they ask back, and tells you who was interested — instead of a person reading a script badly for eight hours."
    >
      <h2>Why telecalling teams are hard</h2>
      <p>
        A telecaller costs a salary, needs training on your offer, has good days and bad
        days, and quits. Output is roughly a hundred dials a day, of which most go
        unanswered. The cost per conversation that actually goes somewhere is far higher
        than the salary suggests, and it is invisible until you measure it.
      </p>
      <p>
        The usual alternative — a recorded blast — is worse. People hang up on a recording
        within two seconds, and it cannot answer the one question that would have moved
        them.
      </p>

      <h2>What Nikki does differently</h2>
      <ul>
        <li><strong>She listens.</strong> If the person asks the price, she answers with your price. If they ask whether you deliver, she answers from what you have told her.</li>
        <li><strong>She can bargain</strong>, within limits you set — your lowest acceptable figure, the most she may come down, and what she can offer instead of a discount. She never goes below your number and never invents a scheme.</li>
        <li><strong>She books.</strong> An interested call becomes an appointment on your dashboard, confirmed on WhatsApp, without anyone typing it in.</li>
        <li><strong>She reports honestly</strong> — who was reached, who was interested, who asked not to be called again.</li>
      </ul>

      <h2>Who to call, and who not to</h2>
      <p>
        This is where most outbound goes wrong legally. Under TRAI rules you may not cold
        call people who have not consented, and &quot;we bought a list&quot; is not consent. Nikki
        is built around that rather than despite it: contacts who submitted their own
        enquiry are dialled normally, and anyone else is refused unless a scrubbing
        provider clears them.
      </p>
      <p>
        There is a do-not-call list you control. Anyone who says stop is added, and no
        campaign will ever dial them again — that request has to be honoured the moment you
        hear it, not when someone gets round to it.
      </p>

      <h2>What it looks like in practice</h2>
      <p>
        Upload a CSV, write two lines about what you want said, press start. Calls go out
        inside the hours you choose, at a pace you set. Each contact shows its own
        status — reached, interested, no answer, asked not to be called — and every
        conversation has a recording and a transcript.
      </p>

      <h2>What it costs</h2>
      <p>
        Outbound campaigns are on the <strong>Growth plan, ₹4,999 a month</strong>, which
        includes 600 minutes and five simultaneous calls. Inbound answering is included on
        every plan from ₹1,999. <a href="/pricing">See pricing</a>, or read about the{" "}
        <a href="/telugu-ai-receptionist">inbound receptionist</a>.
      </p>

      <Faq items={[
        { q: "Is AI telecalling legal in India?",
          a: "Calling people who have consented is legal; cold calling numbers from a bought list is not, under TRAI rules. HeyNikki dials contacts who submitted their own enquiry, refuses the rest unless a scrubbing provider clears them, and honours a do-not-call list you control." },
        { q: "Will people know it is an AI calling?",
          a: "Yes — the call opens with the disclosure TRAI requires, and if anyone asks directly she says she is an AI assistant. In practice most callers carry on regardless once they hear it answer their actual question." },
        { q: "Can it negotiate on price?",
          a: "Within limits you set. You give the lowest figure you will accept, the largest discount she may offer, and what she can offer instead of money. She concedes once, never goes below your floor, and never invents a discount." },
        { q: "How many calls can it make at once?",
          a: "Five simultaneous calls on Growth and fifteen on Scale. Unlike a team, that capacity does not need hiring, training or a shift roster." },
        { q: "What happens when someone asks not to be called again?",
          a: "Add them to the do-not-call list from your dashboard and no campaign will dial them again. Anyone on your team can do it — honouring that request should never wait for the owner." },
      ]} />
    </ContentPage>
  );
}
