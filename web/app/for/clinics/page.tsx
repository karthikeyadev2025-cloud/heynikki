import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Receptionist for Clinics in Telugu — Never Miss a Patient Call | HeyNikki",
  description:
    "Your clinic's phone answered in Telugu while you are with a patient. Books "
    + "appointments, quotes your treatment prices, sends WhatsApp confirmations and "
    + "reminders. From ₹1,999/month, 100 free minutes.",
  alternates: { canonical: "https://www.heynikki.in/for/clinics" },
};

export default function Page() {
  return (
    <ContentPage
      h1="Your clinic's phone, answered while you are with a patient"
      lede="A dentist cannot stop mid-root-canal to take a booking. Nikki answers in Telugu, tells the caller your timings and prices, books the slot, and sends the WhatsApp confirmation — so the phone stops being a choice between two patients."
    >
      <h2>The call you cannot take</h2>
      <p>
        Clinic calls arrive at exactly the wrong moment: mid-procedure, mid-consultation,
        or after you have locked up. The caller wants three things — are you open, do you
        do this treatment, how much — and if nobody answers, they call the clinic two
        streets away. There is no voicemail culture here to fall back on.
      </p>

      <h2>What she handles without you</h2>
      <ul>
        <li><strong>Timings and days</strong>, including the ones you are closed. Tell her &quot;we are shut next Monday&quot; by voice from your dashboard and she tells every caller from then on.</li>
        <li><strong>Treatment prices.</strong> Upload your price list and she quotes from it — <span className="te">రూట్ కెనాల్ నాలుగు వేల ఐదు వందలు, రెండు సిట్టింగ్స్</span> — rather than saying she does not know.</li>
        <li><strong>Appointments</strong>, with the patient's name and the slot, confirmed on WhatsApp and reminded the day before, which is where most no-shows are lost.</li>
        <li><strong>Emergencies.</strong> Someone in pain asking for the doctor is transferred to your staff, not booked for next week.</li>
      </ul>

      <h2>What it does not do</h2>
      <p>
        She does not give medical advice, and she should not. Asked whether a symptom is
        serious, she says the doctor will advise and offers the earliest slot or a
        callback. A receptionist who guesses at clinical questions is a liability, and an
        AI that does it is a worse one.
      </p>

      <h2>Patient privacy</h2>
      <p>
        Recordings are encrypted before they are stored and only your account can play
        them. Retention follows your plan — seven days on the free plan, ninety days on
        Starter, a year on Growth — and old audio is deleted automatically rather than
        accumulating indefinitely. Full detail in the <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Getting started</h2>
      <p>
        Upload your price list or brochure and she reads it herself — no forms to fill in.
        Forward your clinic number, or keep it and use the number we give you. Start with{" "}
        <strong>100 free minutes</strong>, around 25 patient calls, before deciding
        anything. See also the <a href="/telugu-ai-receptionist">Telugu AI receptionist</a>{" "}
        overview.
      </p>

      <Faq items={[
        { q: "Can it tell patients our treatment prices?",
          a: "Yes. Upload your price list and she quotes from it directly — including details like how many sittings a treatment takes — instead of saying she does not know." },
        { q: "What if a patient is in pain and needs the doctor now?",
          a: "She transfers the call to your staff rather than booking them for later. Urgency is exactly the case where a booking is the wrong answer." },
        { q: "Will it give medical advice?",
          a: "No, deliberately. Asked whether a symptom is serious she says the doctor will advise, and offers the earliest appointment or a callback." },
        { q: "Does it reduce no-shows?",
          a: "It sends a WhatsApp confirmation when the appointment is booked and a reminder the day before, which is where most no-shows are recovered." },
        { q: "Are patient call recordings private?",
          a: "They are encrypted before storage and only your account can play them. Retention follows your plan and old recordings are deleted automatically." },
      ]} />
    </ContentPage>
  );
}
