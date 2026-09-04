import ContentPage, { Faq } from "../../components/ContentPage";

export const metadata = {
  title: "Telugu AI Receptionist — Answers Your Business Calls 24/7 | HeyNikki",
  description:
    "A Telugu-speaking AI receptionist for Indian small businesses. Answers your existing "
    + "business number in Telugu, Hindi or English, books appointments, captures leads and "
    + "follows up on WhatsApp. From ₹1,999/month. 100 free minutes.",
  alternates: { canonical: "https://www.heynikki.in/telugu-ai-receptionist" },
};

export default function Page() {
  return (
    <ContentPage
      h1="A Telugu AI receptionist that answers every call"
      lede="Nikki picks up your business phone in real Telugu — the Telugu people actually speak, with English words mixed in — takes the booking, and tells you. At nine at night, on Sunday, during a festival."
    >
      <h2>What a missed call actually costs</h2>
      <p>
        A clinic misses a call because the doctor is with a patient. A property office
        misses one because everyone is at a site visit. The caller does not leave a
        voicemail and does not try again — they ring the next number on the list. The
        business never learns it happened, which is what makes the loss so easy to live
        with and so expensive to keep.
      </p>
      <p>
        A receptionist solves it and costs around ₹15,000 a month, works one shift, takes
        leave, and cannot answer two calls at once. That maths does not work for a
        two-person clinic, which is why most small businesses simply accept the missed
        calls.
      </p>

      <h2>What Nikki does on a call</h2>
      <p>
        She answers as <strong>your</strong> business, not as a service. She knows your
        hours, your services, your prices, and whatever else you have told her — upload a
        brochure and she reads it herself.
      </p>
      <ul>
        <li><strong>Speaks real Telugu.</strong> Not English transliterated into Telugu letters. Pick Telugu, Hindi or English for your line; in Telugu she understands the English words callers mix in.</li>
        <li><strong>Books appointments</strong> and confirms them on WhatsApp, with a reminder the day before.</li>
        <li><strong>Captures the lead</strong> — name, number, what they asked about, and how serious they sounded.</li>
        <li><strong>Transfers to a person</strong> when the caller asks for one, instead of pretending to cope.</li>
        <li><strong>Records everything</strong>, with a written transcript, so &quot;but she said…&quot; takes ten seconds to settle.</li>
      </ul>

      <h2>Does it really sound Telugu?</h2>
      <p>
        This is the question every business owner asks first, and rightly — most &quot;Indian
        language&quot; voice products are English models wearing a costume. Nikki speaks the
        register a Hyderabad receptionist speaks: <span className="te">గారు</span> and{" "}
        <span className="te">అండి</span> where they belong, English words left in English
        where nobody would translate them, numbers said the way people say them —{" "}
        <span className="te">నాలుగున్నర వేలు</span>, not &quot;four thousand five hundred&quot;.
      </p>
      <p>
        The honest test is not a demo video. Call <strong>086335 02031</strong> and talk to
        her. Ask her something awkward.
      </p>

      <h2>You keep your number</h2>
      <p>
        Forward your existing business number to Nikki, or use the new number we give
        you. Your board, your visiting cards and your Google listing stay exactly as they
        are. Nothing about how customers reach you changes.
      </p>

      <h2>What it costs</h2>
      <p>
        Every new account starts with <strong>100 free minutes</strong> — about 25 real
        customer calls — with no card and no time limit. After that, plans start at{" "}
        <strong>₹1,999 a month</strong> for 200 minutes, one business number, appointments,
        leads and WhatsApp follow-ups. <a href="/pricing">Full pricing</a>.
      </p>

      <Faq items={[
        { q: "Is it really Telugu, or English with a Telugu accent?",
          a: "Really Telugu. The speech model is trained on Telugu rather than English spelled out phonetically, and it keeps the English words Hyderabad actually uses instead of translating them into words nobody says." },
        { q: "Do I have to change my business number?",
          a: "No. Forward your existing number to Nikki, or use the new number we give you. Your board, your cards and your listings stay exactly as they are." },
        { q: "What happens if the caller wants a human?",
          a: "The call transfers to your staff. Nikki never pretends to have understood, and if she cannot help she says so and takes a number for a callback." },
        { q: "Do callers know they are speaking to an AI?",
          a: "Yes. TRAI requires disclosure at the start of every automated call and Nikki gives it. Asked directly, she always says she is an AI assistant." },
        { q: "How much does a Telugu AI receptionist cost in India?",
          a: "HeyNikki starts at ₹1,999 a month for 200 minutes, with 100 free minutes to begin. A human receptionist costs roughly ₹15,000 a month and works one shift." },
      ]} />
    </ContentPage>
  );
}
