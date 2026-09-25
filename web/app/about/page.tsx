import ContentPage from "../../components/ContentPage";

export const metadata = {
  title: "About HeyNikki — Nikki Technologies, Hyderabad",
  description:
    "HeyNikki is a Telugu AI receptionist built and operated by Nikki Technologies in "
    + "Hyderabad, Telangana, India. Serving small businesses across Telangana and "
    + "Andhra Pradesh. Contact support@heynikki.in or 086335 02031.",
  alternates: { canonical: "https://www.heynikki.in/about" },
};

export default function Page() {
  return (
    <ContentPage
      h1="About HeyNikki"
      eyebrow="About"
      lede="HeyNikki is a Telugu-speaking AI receptionist for Indian small businesses, built and operated by Nikki Technologies in Hyderabad, Telangana."
      cta="Try it free — 100 minutes"
    >
      <h2>Who we are</h2>
      <p>
        <strong>HeyNikki</strong> is a product of <strong>Nikki Technologies</strong>, a unit
        of <strong>Adexos Global Technologies</strong>, based in Hyderabad, Telangana, India. We build one thing: a receptionist that answers a
        small business&apos;s phone in the Telugu people actually speak, books the
        appointment, and tells the owner what happened.
      </p>

      {/* This section exists so a person can check they have the real
          HeyNikki. It said the same three facts in two paragraphs in a row;
          they are stated once now, where they can be read at a glance. */}
      <h2>Our official presence</h2>
      <p>
        Everything official comes from one place. We do not operate under any other
        domain or company name, and we will never contact you from an address that is
        not @heynikki.in.
      </p>
      <div style={{ border: "1px solid #E4E9F0", borderRadius: 14, overflow: "hidden", margin: "18px 0 20px",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        {[
          ["Website", <a key="w" href="https://www.heynikki.in">heynikki.in</a>],
          ["Support", <a key="e" href="mailto:support@heynikki.in">support@heynikki.in</a>],
          ["Phone", <><a key="p" href="tel:08633502031">086335 02031</a> <span style={{ color: "#64748B" }}>— answered by Nikki herself, the same product a customer gets</span></>],
        ].map(([k, v], i) => (
          <div key={String(k)} style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "14px 20px",
            borderTop: i ? "1px solid #EEF2F6" : "none", fontSize: 16 }}>
            <span style={{ width: 90, color: "#64748B", fontWeight: 600 }}>{k}</span>
            <span style={{ flex: 1, minWidth: 200, fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
      <p>
        If you reached a different site expecting HeyNikki, it was not us. If in
        doubt, call the number above — it is answered by the product itself.
      </p>

      <h2>What we actually build</h2>
      <p>
        A phone number that is always answered. Nikki speaks Telugu, Hindi and English —
        switching when the caller does — and is scoped deliberately to those three rather
        than claiming to cover every language. She books appointments, captures leads from
        the conversation, confirms on WhatsApp, and can call a customer list back.
      </p>
      <p>
        Nikki never pretends to be a person: ask her and she says plainly that she is an
        AI assistant, in whatever language the caller is speaking. Call recordings are
        encrypted before storage and only the business that owns them can play them.
      </p>

      <h2>Where we operate</h2>
      <p>
        Telangana and Andhra Pradesh primarily, and across India for businesses whose
        callers speak Telugu, Hindi or English. Our numbers run on an Indian SIP trunk and
        customer data is stored under Indian data-protection law — see the{" "}
        <a href="/privacy">privacy policy</a>.
      </p>

      <h2>Company</h2>
      <div style={{ background: "#F8FAFC", border: "1px solid #EEF2F6", borderRadius: 14, padding: "18px 20px",
        fontSize: 16, lineHeight: 1.7, color: "#475569" }}>
        <strong style={{ color: "#0F172A" }}>Nikki Technologies</strong><br />
        A unit of Adexos Global Technologies<br />
        Registered office: Bangalore, Karnataka, India<br />
        GSTIN <span style={{ fontFamily: "var(--font-mono), monospace", color: "#0F172A" }}>37AVEPV3515A2ZR</span><br />
        <a href="/contact">All the ways to reach us →</a>
      </div>
    </ContentPage>
  );
}
