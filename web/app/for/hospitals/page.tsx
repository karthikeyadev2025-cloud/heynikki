import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Front Desk for Hospitals — OP Appointments by Phone | HeyNikki",
  description:
    "Your hospital's OP line answered in Telugu, Hindi or English. Nikki books "
    + "consultations by department, gives OP timings, sends callers with an emergency "
    + "to 108 and your staff, and shares nothing about patients.",
  alternates: { canonical: "https://www.heynikki.in/for/hospitals" },
};

export default function Page() {
  return (
    <ContentPage
      h1="The OP line answered, without tying up the front desk"
      lede="A hospital's front desk is answering the phone, the queue in front of it and the billing counter at once. Nikki takes the phone: OP bookings by department, timings, and callbacks for reports and billing — and she knows the difference between a booking and an emergency."
    >
      <h2>Most calls are the same three questions</h2>
      <p>
        Is the cardiologist in tomorrow, what are the OP timings, can I get an
        appointment. Each one takes a minute of a person who has a patient standing in
        front of them. When the line is busy the caller does not wait; they ring the next
        hospital on the list.
      </p>

      <h2>What she handles</h2>
      <ul>
        <li><strong>OP consultations</strong>, booked with the department or doctor the caller asks for, confirmed on WhatsApp and reminded the day before.</li>
        <li><strong>OP timings and open days</strong> for the hospital, stated plainly, including the days you are closed.</li>
        <li><strong>Reports, billing, insurance and admission queries</strong>: she takes the details and your desk calls back, instead of the caller holding.</li>
        <li><strong>Several callers at once</strong>, up to six on the Business plan, with more than one number for different desks.</li>
      </ul>

      <h2>An emergency is not a booking</h2>
      <p>
        A caller who says chest pain, breathlessness, heavy bleeding or an accident is
        told to call 108 immediately and is passed to your staff. She does not offer them
        next Tuesday.
      </p>

      <h2>What she will not do</h2>
      <p>
        She gives no diagnosis, no medical advice and no test results, and she does not
        choose a speciality from a caller&apos;s symptoms — she offers the general OP or a
        callback from the desk. She does not say whether a doctor is in the building
        right now, quote a bill, or confirm a bed. And she shares nothing about an
        admitted patient: a relative asking how someone in the ICU is doing gets a
        callback from the ward desk, not an answer from the phone.
      </p>

      <h2>Follow-ups and health camps</h2>
      <p>
        On the Team plan and above she can also ring patients: a follow-up visit that is
        due, a health camp, a check-up package. If anyone other than the patient picks
        up, she says only that she is calling from the hospital and asks when to reach
        them — never the doctor, the department or the reason.
      </p>

      <h2>Privacy</h2>
      <p>
        Recordings are encrypted before they are stored and only your account can play
        them. Retention follows your plan and old audio is deleted automatically. Full
        detail in the <a href="/privacy">privacy policy</a>. A single-doctor practice is
        better served by the <a href="/for/clinics">clinic desk</a>.
      </p>

      <Faq items={[
        { q: "What happens when someone calls with an emergency?",
          a: "She tells them to call 108 immediately and transfers the call to your staff. Chest pain, breathlessness, heavy bleeding, an accident or an unconscious person are never treated as an appointment request." },
        { q: "Will it tell a caller which doctor to see for their symptoms?",
          a: "No. Choosing a speciality from symptoms is a clinical judgement. She books the department the caller names, or offers the general OP or a callback from the desk." },
        { q: "Can a relative ask about an admitted patient?",
          a: "She does not confirm or share anything about a patient on the phone. She takes the caller's name and has the ward desk call them." },
        { q: "Can it remind patients about follow-up visits?",
          a: "Yes, on the Team plan and above. If someone other than the patient answers, she gives no medical detail and only asks when the patient can be reached." },
        { q: "How many calls can it take at the same time?",
          a: "Two on Shop, four on Team and six on Business. Larger volumes or several branches are quoted individually." },
      ]} />
    </ContentPage>
  );
}
