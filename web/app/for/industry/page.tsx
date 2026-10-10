import ContentPage, { Faq } from "../../../components/ContentPage";

export const metadata = {
  title: "AI Front Office for Manufacturers and Large Enterprises | HeyNikki",
  description:
    "Sales enquiries, service complaints and supplier calls sorted and logged in "
    + "Telugu, Hindi or English. Nikki takes the details and routes them; your teams "
    + "confirm prices and dispatch. API access on Business.",
  alternates: { canonical: "https://www.heynikki.in/for/industry" },
};

export default function Page() {
  return (
    <ContentPage
      h1="One number, and every call reaches the right team with the details"
      lede="A company's board line gets a dealer asking for a quotation, a customer with a complaint, a transporter at the gate and a job applicant, all in the same hour. Nikki finds out which one it is, takes what that team will need, and passes it on — in Telugu, Hindi or English."
    >
      <h2>The board line is three different jobs</h2>
      <p>
        Sales wants the product, the quantity and the city. Service wants the invoice
        number and what went wrong. Purchase wants to know who is calling and why. A
        receptionist who is good at one of these is usually guessing at the other two,
        and after six in the evening nobody is answering at all.
      </p>

      <h2>How she sorts a call</h2>
      <ul>
        <li><strong>Sales and dealership enquiries:</strong> which product, roughly what quantity, for which city. Then a callback from your sales team, with the enquiry already written down.</li>
        <li><strong>Service requests and complaints:</strong> the product, what is wrong, and the invoice or order number if the caller has it. A complaint is noted calmly and never argued with.</li>
        <li><strong>Suppliers, transporters, applicants and visitors:</strong> name, company and purpose, then a transfer to the person they asked for or a callback.</li>
        <li><strong>An accident or safety incident at a site</strong> is passed to a person immediately.</li>
      </ul>

      <h2>What she leaves to your teams</h2>
      <p>
        She does not quote a price, a discount, stock, a dispatch date, a payment status
        or a warranty decision she was not given. A wrong delivery date said confidently
        on the phone is a commitment your plant then has to keep, so she says the
        concerned team will confirm, and makes sure they have what they need to do it.
      </p>

      <h2>Calling out</h2>
      <p>
        On the Team plan and above she rings your own lists: dealer and distributor
        enquiries that were never followed up, or customers after a delivery or a
        service visit to ask whether everything is working. A problem she hears is
        noted for service; a happy customer is thanked and left alone.
      </p>

      <h2>At a larger scale</h2>
      <p>
        The Business plan carries five numbers, eight team seats, six calls at once
        and API access, so calls and leads can flow into the systems you already run;
        the endpoints are public on the <a href="/developers">developers page</a>.
        Higher volumes and several plants or branches are quoted individually —{" "}
        <a href="/contact">talk to us</a>. Your own telecallers can work from the Desk,
        with every call recorded and summarised.
      </p>

      <h2>Getting started</h2>
      <p>
        Choose <strong>Industry</strong> in Setup, list your product lines, and forward
        the board number or use the one we give you. The first{" "}
        <strong>100 minutes are free</strong>; plans are on the{" "}
        <a href="/pricing">pricing page</a>.
      </p>

      <Faq items={[
        { q: "Can it give a dealer our price list over the phone?",
          a: "Only prices you have given her. Otherwise she takes the product, quantity and city and your sales team calls back with the quotation." },
        { q: "How does it handle an angry customer?",
          a: "She notes the product, the problem and the invoice or order number, does not argue, and has service call back. A caller who asks for a person is transferred." },
        { q: "Can it connect to our CRM or ERP?",
          a: "The Business plan includes API access for placing calls and receiving call results. The endpoints are documented on the developers page." },
        { q: "Does it answer after office hours?",
          a: "Yes. She answers at any hour, takes the details and tells the caller when your team will be back, so the enquiry is waiting in the morning." },
        { q: "We have several plants. Can each have its own number?",
          a: "The Business plan includes five numbers. More numbers, branches or higher call volumes are quoted individually." },
      ]} />
    </ContentPage>
  );
}
