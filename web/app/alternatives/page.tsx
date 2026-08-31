import ContentPage, { Faq } from "../../components/ContentPage";

export const metadata = {
  title: "Missed Calls: Receptionist vs IVR vs Answering Service vs AI | HeyNikki",
  description:
    "An honest comparison of the four ways an Indian small business handles calls it "
    + "cannot take — a receptionist, an IVR menu, an answering service, or a Telugu AI "
    + "receptionist — with what each actually costs and where each fails.",
  alternates: { canonical: "https://www.heynikki.in/alternatives" },
};

export default function Page() {
  return (
    <ContentPage
      h1="Four ways to stop missing calls, honestly compared"
      lede="Every business that misses calls eventually tries one of four things. Each works for someone. Here is what each actually costs, and where each one breaks — including ours."
    >
      <h2>1. Hire a receptionist</h2>
      <p>
        <strong>Roughly ₹15,000 a month</strong> in Hyderabad, plus training and the time
        you spend managing them. A good one is better than any software: they know your
        regulars, they read tone, they handle the awkward call.
      </p>
      <p>
        <strong>Where it breaks:</strong> one shift, one call at a time. Evenings, Sundays
        and festivals are exactly when people ring a clinic or a property office, and
        that is precisely when the desk is empty. For a two-person business the maths
        rarely works at all.
      </p>

      <h2>2. An IVR menu</h2>
      <p>
        <strong>Cheap, often bundled free</strong> with a business line. Press 1 for sales,
        press 2 for support.
      </p>
      <p>
        <strong>Where it breaks:</strong> callers hang up. An IVR asks the customer to do
        the work of routing themselves, in a language and a structure they did not choose,
        and it cannot answer the one question they rang to ask. It converts a missed call
        into an abandoned call, which looks better in a report and is worth the same.
      </p>

      <h2>3. A call answering service</h2>
      <p>
        <strong>Per-call or per-seat pricing</strong>, with a human somewhere taking a
        message on your behalf.
      </p>
      <p>
        <strong>Where it breaks:</strong> they do not know your business. They can take a
        name and a number; they cannot tell a patient what a root canal costs or a buyer
        how many acres the project is. You still call everyone back, so it delays the
        work rather than removing it — and Telugu-speaking coverage at a small-business
        price is hard to find.
      </p>

      <h2>4. A Telugu AI receptionist</h2>
      <p>
        <strong>From ₹1,999 a month</strong>, answering every call at once, at any hour, in
        the language the caller chose. It knows your hours, services and prices because
        you uploaded your own brochure, books the appointment, and sends the WhatsApp
        confirmation.
      </p>
      <p>
        <strong>Where it breaks — and this matters:</strong> it is not a person. A caller
        who is upset, or whose question is genuinely unusual, needs a human, and the right
        behaviour is to transfer rather than to keep trying. It also cannot judge a
        situation the way someone who has worked your front desk for three years can. If
        your call volume already justifies a full-time receptionist, hire one — this is
        for the businesses where that was never realistic.
      </p>

      <h2>How to decide in one question</h2>
      <p>
        Count the calls you missed last week and multiply by what one customer is worth.
        If that number is smaller than ₹1,999, none of this is urgent. For most clinics
        and property offices it is not close — one recovered enquiry covers a year.
      </p>
      <p>
        The way to test the AI option is not a demo video. Call{" "}
        <strong>086335 02031</strong> and try to catch her out, then decide.
      </p>

      <Faq items={[
        { q: "Is an AI receptionist better than hiring a person?",
          a: "Not better — different. A person is better at judgement and at regulars; an AI answers every call at once, at any hour, for about an eighth of the cost. If your volume already justifies a full-time receptionist, hire one." },
        { q: "Why not just use an IVR menu?",
          a: "An IVR asks the caller to route themselves and cannot answer what they rang to ask, so it converts a missed call into an abandoned one. An AI receptionist answers the question instead of offering a menu." },
        { q: "How is this different from a call answering service?",
          a: "An answering service takes a message; it does not know your prices, your timings or your projects. HeyNikki answers from your own brochure and books the appointment, so there is nothing left to call back about." },
        { q: "What does an AI receptionist cost in India?",
          a: "HeyNikki starts at ₹1,999 a month for 200 minutes, with 100 free minutes to start. A receptionist in Hyderabad costs roughly ₹15,000 a month and works one shift." },
        { q: "When is HeyNikki the wrong choice?",
          a: "When your callers mostly need judgement rather than answers, or when your volume already justifies a full-time receptionist. She transfers to a human when asked, but she is not a replacement for one in every business." },
      ]} />
    </ContentPage>
  );
}
