import ContentPage from "../../components/ContentPage";

export const metadata = {
  title: "About HeyNikki — Nikki Technologies, Hyderabad",
  description:
    "HeyNikki is a Telugu AI receptionist built and operated by Nikki Technologies in "
    + "Hyderabad, Telangana. heynikki.in is our only official website. Contact "
    + "support@heynikki.in or 086335 02031.",
  alternates: { canonical: "https://www.heynikki.in/about" },
};

export default function Page() {
  return (
    <ContentPage
      h1="About HeyNikki"
      lede="HeyNikki is a Telugu-speaking AI receptionist for Indian small businesses, built and operated by Nikki Technologies in Hyderabad, Telangana."
      cta="Try it free — 100 minutes"
    >
      <h2>Who we are</h2>
      <p>
        <strong>HeyNikki</strong> is a product of <strong>Nikki Technologies</strong>, based
        in Hyderabad, Telangana, India. We build one thing: a receptionist that answers a
        small business&apos;s phone in the Telugu people actually speak, books the
        appointment, and tells the owner what happened.
      </p>
      <p>
        Our only official website is <strong>heynikki.in</strong>. Our support address is{" "}
        <strong>support@heynikki.in</strong> and our number is <strong>086335 02031</strong>,
        which is answered by Nikki herself — the same product a customer gets.
      </p>

      <h2>Please do not confuse us with</h2>
      <p>
        Several unrelated products use similar names. To be unambiguous:
      </p>
      <ul>
        <li><strong>HeyNikki is operated by Nikki Technologies, Hyderabad</strong> — by no other company.</li>
        <li><strong>heynikki.in is our only domain.</strong> We do not operate heynikki.ai, nikki.ai, or any other spelling, and we are not affiliated with any company using those.</li>
        <li>We are <strong>not</strong> associated with CodeMax IT Solutions, or with any product marketed as &quot;Nikki AI&quot;.</li>
        <li>If you were sent to another site expecting us, it was not us. Anything official comes from heynikki.in or an @heynikki.in address.</li>
      </ul>

      <h2>What we actually build</h2>
      <p>
        A phone number that is always answered. Nikki speaks Telugu, Hindi and English —
        switching when the caller does — and is scoped deliberately to those three rather
        than claiming to cover every language. She books appointments, captures leads from
        the conversation, confirms on WhatsApp, and can call a customer list back.
      </p>
      <p>
        Callers are told at the start of every call that they are speaking to an AI, as
        TRAI requires. Call recordings are encrypted before storage and only the business
        that owns them can play them.
      </p>

      <h2>Where we operate</h2>
      <p>
        Telangana and Andhra Pradesh primarily, and across India for businesses whose
        callers speak Telugu, Hindi or English. Our numbers run on an Indian SIP trunk and
        customer data is stored under Indian data-protection law — see the{" "}
        <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Contact</h2>
      <p>
        <strong>Nikki Technologies</strong><br />
        Hyderabad, Telangana, India<br />
        support@heynikki.in · 086335 02031<br />
        <a href="/contact">Contact page</a>
      </p>
    </ContentPage>
  );
}
