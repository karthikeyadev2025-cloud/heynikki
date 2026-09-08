import Link from "next/link";
import { NIKKI } from "../../lib/brand";

export const metadata = {
  title: "HeyNikki API — place calls and read orders from your own software",
  description:
    "REST API for the Telugu AI receptionist: ask Nikki to ring a customer with a "
    + "reminder, read the orders she took on the phone, and get a webhook when a "
    + "call finishes. Bearer-key auth, JSON, signed callbacks.",
  alternates: { canonical: "https://www.heynikki.in/developers" },
};

const C = {
  bg: NIKKI.bg, vault: NIKKI.vault, bord: NIKKI.border, bordHi: NIKKI.borderHi,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  teal: NIKKI.teal, terra: NIKKI.terracotta, green: NIKKI.emerald, gold: NIKKI.gold,
};

const mono = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

/** A fenced block. Wide payloads scroll inside themselves, never the page. */
function Code({ children }: { children: string }) {
  return (
    <pre style={{
      background: "#0F172A", color: "#E2E8F0", borderRadius: 10, padding: "14px 16px",
      overflowX: "auto", fontFamily: mono, fontSize: 12.5, lineHeight: 1.65,
      margin: "14px 0", border: "1px solid #1E293B",
    }}><code>{children}</code></pre>
  );
}

function Method({ verb, path }: { verb: string; path: string }) {
  const tone: Record<string, string> = {
    GET: C.teal, POST: C.green, PATCH: C.gold, DELETE: C.terra,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "34px 0 4px" }}>
      <span style={{
        background: tone[verb] || C.teal, color: "#fff", fontFamily: mono, fontSize: 11.5,
        fontWeight: 700, letterSpacing: ".04em", padding: "4px 9px", borderRadius: 6,
      }}>{verb}</span>
      <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 600, wordBreak: "break-all" }}>{path}</span>
    </div>
  );
}

function Params({ rows }: { rows: [string, string, string][] }) {
  return (
    <div style={{ overflowX: "auto", margin: "14px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 14 }}>
        <thead>
          <tr>
            {["Field", "Type", "Meaning"].map(h => (
              <th key={h} style={{
                textAlign: "left", padding: "8px 12px 8px 0", borderBottom: `1px solid ${C.bordHi}`,
                fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase", color: C.dim,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([f, t, d]) => (
            <tr key={f}>
              <td style={{ padding: "9px 12px 9px 0", borderBottom: `1px solid ${C.bord}`,
                fontFamily: mono, fontSize: 13, whiteSpace: "nowrap", verticalAlign: "top" }}>{f}</td>
              <td style={{ padding: "9px 12px 9px 0", borderBottom: `1px solid ${C.bord}`,
                fontFamily: mono, fontSize: 12.5, color: C.dim, whiteSpace: "nowrap", verticalAlign: "top" }}>{t}</td>
              <td style={{ padding: "9px 0", borderBottom: `1px solid ${C.bord}`,
                color: C.mid, lineHeight: 1.55 }}>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} style={{
      fontFamily: "var(--font-bricolage), sans-serif", fontWeight: 800, fontSize: 27,
      letterSpacing: "-.02em", margin: "60px 0 10px", scrollMarginTop: 24,
    }}>{children}</h2>
  );
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontSize: 15.5, lineHeight: 1.7, color: C.mid, margin: "0 0 14px", ...style }}>{children}</p>;
}

const TOC: [string, string][] = [
  ["auth", "Authentication"],
  ["outbound", "Place a call"],
  ["callbacks", "Call callbacks"],
  ["orders", "Orders"],
  ["order-webhook", "Order webhook"],
  ["read", "Reading calls & appointments"],
  ["errors", "Errors & limits"],
];

export default function DevelopersPage() {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.txt,
      fontFamily: "var(--font-manrope), system-ui, sans-serif" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 24px 100px" }}>

        <header style={{ padding: "28px 0 0" }}>
          <Link href="/" style={{ color: C.teal, textDecoration: "none", fontWeight: 800,
            fontSize: 17, letterSpacing: "-.02em" }}>HeyNikki</Link>
        </header>

        <h1 style={{ fontFamily: "var(--font-bricolage), sans-serif", fontWeight: 800,
          fontSize: "clamp(31px,5.4vw,46px)", lineHeight: 1.08, letterSpacing: "-.03em",
          margin: "44px 0 16px", textWrap: "balance" }}>
          The HeyNikki API
        </h1>
        <p style={{ fontSize: 19, lineHeight: 1.6, color: C.mid, margin: "0 0 12px" }}>
          Two things your software can do that a dashboard cannot: ask Nikki to ring a
          customer and say something in Telugu, and read the orders she took on the phone
          while nobody was free to answer it.
        </p>
        <p style={{ fontSize: 15, color: C.dim, margin: "0 0 34px", fontFamily: mono }}>
          Base URL: https://api.heynikki.in
        </p>

        <nav aria-label="Contents" style={{
          background: C.vault, border: `1px solid ${C.bord}`, borderRadius: 12,
          padding: "16px 18px", display: "flex", flexWrap: "wrap", gap: "8px 20px", marginBottom: 8,
        }}>
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} style={{ color: C.teal, fontSize: 14, fontWeight: 600,
              textDecoration: "none" }}>{label}</a>
          ))}
        </nav>

        {/* ── AUTH ─────────────────────────────────────────── */}
        <H2 id="auth">Authentication</H2>
        <P>
          Every request carries an API key as a bearer token. Issue one in the dashboard
          under <Link href="/api-keys" style={{ color: C.teal }}>API keys</Link>; the key
          is shown once, at issue, and never again. Keys are scoped, and a request that
          asks for something its key was not granted gets a <code style={{ fontFamily: mono }}>403</code>
          {" "}naming the missing scope.
        </P>
        <Code>{`curl https://api.heynikki.in/api/v1/usage \\
  -H "Authorization: Bearer jvk_live_xxxxxxxxxxxxxxxxxxxxxxxx"`}</Code>
        <Params rows={[
          ["calls.read", "scope", "Read call records, transcripts and the calls you placed over the API."],
          ["calls.write", "scope", "Place and withdraw outbound calls. Spends call credits."],
          ["appointments.read", "scope", "Read appointments Nikki booked."],
          ["orders.read", "scope", "Read orders taken on the phone."],
          ["orders.write", "scope", "Move an order through preparing / ready / delivered."],
        ]} />
        <P>
          Keys come in two modes. A <code style={{ fontFamily: mono }}>jvk_test_</code> key
          reads the same data as a live key; only a live key may place a call, because a
          call costs credits and rings a real phone.
        </P>

        {/* ── OUTBOUND ─────────────────────────────────────── */}
        <H2 id="outbound">Place a call</H2>
        <P>
          Nikki rings the customer, greets them by name as your business, says your
          message in their language, answers what she can from the business&apos;s own
          information, and hangs up. Typically under a minute. Use it for appointment
          reminders, &ldquo;your order is ready&rdquo;, payment reminders, delivery
          windows — anything the person is expecting to hear from you.
        </P>

        <Method verb="POST" path="/api/v1/calls/outbound" />
        <Params rows={[
          ["phone", "string, required", "Indian mobile. 10 digits, 91XXXXXXXXXX or +91XXXXXXXXXX — all accepted."],
          ["message", "string, required", "What Nikki should tell them, ≤500 characters. Write it as you would say it out loud; it is spoken in the first breath of the call."],
          ["consent", "boolean, required", "Must be true. Your attestation that this customer asked to be contacted by this business — it is what lets the call skip third-party DND scrubbing, and it is on the record per call."],
          ["name", "string", "The customer's name, so she can greet them with it."],
          ["purpose", "string", "reminder (default), follow_up or custom. Reported back to you unchanged."],
          ["language", "string", "te (default), en or hi."],
          ["not_before", "ISO-8601", "Do not dial before this moment. Within the next 30 days."],
          ["reference", "string", "Your own id for this call — your booking number. Returned everywhere and filterable."],
          ["callback_url", "https URL", "Where to POST the result when the call is over."],
          ["callback_secret", "string", "If set, every callback carries an HMAC signature you can verify."],
          ["metadata", "object", "Anything you want handed back to you, ≤2 KB."],
        ]} />
        <Code>{`curl -X POST https://api.heynikki.in/api/v1/calls/outbound \\
  -H "Authorization: Bearer jvk_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "9848012345",
    "name": "Ravi",
    "message": "మీ అపాయింట్‌మెంట్ రేపు ఉదయం పది గంటలకు ఉంది",
    "purpose": "reminder",
    "consent": true,
    "reference": "BK-4471",
    "callback_url": "https://your-app.example.com/hooks/nikki"
  }'`}</Code>
        <P>Returns <code style={{ fontFamily: mono }}>202 Accepted</code> — the call is queued, not yet placed:</P>
        <Code>{`{
  "id": "6f0c2b2e-9c1f-4a0e-8f2a-2b0e1c9d4a11",
  "reference": "BK-4471",
  "phone": "+919848012345",
  "name": "Ravi",
  "purpose": "reminder",
  "status": "queued",
  "outcome": null,
  "call_id": null,
  "duration_seconds": 0,
  "answered": false,
  "result": null,
  "attempts": 0,
  "requested_at": "2026-09-08T05:12:04.114Z",
  "calling_hours": "09:00–20:30 IST"
}`}</Code>
        <P>
          <strong>Calling hours.</strong> Calls are placed between 09:00 and 20:30 IST,
          which is what TRAI permits for commercial calls. A request made at midnight is
          accepted and dialled at nine. A number that has opted out of your calls is
          refused outright with <code style={{ fontFamily: mono }}>409 opted_out</code>,
          and the same request sent twice within ten minutes is refused as a duplicate
          rather than ringing the person twice.
        </P>
        <P>
          <strong>status</strong> moves <code style={{ fontFamily: mono }}>queued →
          calling → completed</code>, or ends at <code style={{ fontFamily: mono }}>failed</code>
          {" "}(the phone did not answer, the trunk refused) or{" "}
          <code style={{ fontFamily: mono }}>blocked</code> (DND, opted out).
        </P>

        <Method verb="GET" path="/api/v1/calls/outbound/:id" />
        <P>The same object, with whatever has happened since. Poll it, or take the callback.</P>

        <Method verb="GET" path="/api/v1/calls/outbound" />
        <P>
          Your API-placed calls, newest first.{" "}
          <code style={{ fontFamily: mono }}>?status=queued|calling|completed|failed|blocked</code>,{" "}
          <code style={{ fontFamily: mono }}>?reference=BK-4471</code>,{" "}
          <code style={{ fontFamily: mono }}>?limit=</code> (≤200) and{" "}
          <code style={{ fontFamily: mono }}>?cursor=</code> from the previous page&apos;s{" "}
          <code style={{ fontFamily: mono }}>next_cursor</code>.
        </P>

        <Method verb="DELETE" path="/api/v1/calls/outbound/:id" />
        <P>
          Withdraw a call that has not been dialled yet — the appointment was cancelled
          after you queued the reminder. Returns <code style={{ fontFamily: mono }}>409</code>
          {" "}once the phone is already ringing, because by then it cannot be unrung.
        </P>

        {/* ── CALLBACKS ────────────────────────────────────── */}
        <H2 id="callbacks">Call callbacks</H2>
        <P>
          When the call is over, we POST to your <code style={{ fontFamily: mono }}>callback_url</code>.
          Answer <code style={{ fontFamily: mono }}>2xx</code> and we stop; anything else is
          retried at 15 seconds, 1 minute and 5 minutes, except a 4xx, which we read as
          &ldquo;don&apos;t send this again&rdquo;.
        </P>
        <Code>{`POST /hooks/nikki
X-Nikki-Event: outbound_call.completed
X-Nikki-Delivery: 0d1c...        (unique per delivery attempt)
X-Nikki-Signature: sha256=9f86d0...

{
  "event": "outbound_call.completed",
  "id": "6f0c2b2e-9c1f-4a0e-8f2a-2b0e1c9d4a11",
  "reference": "BK-4471",
  "phone": "+919848012345",
  "name": "Ravi",
  "purpose": "reminder",
  "status": "completed",
  "outcome": "answered",
  "call_id": "b21f...",          
  "duration_seconds": 34,
  "answered": true,
  "result": {
    "delivered": true,
    "customer_response": "confirmed",
    "note": "Customer confirmed he will come at 10 AM.",
    "spoke_seconds": 34
  },
  "metadata": { "your": "fields" },
  "requested_at": "2026-09-08T05:12:04.114Z",
  "completed_at": "2026-09-08T05:14:41.900Z"
}`}</Code>
        <P>
          <strong>result</strong> is the part worth reading. A call that connected is not
          the same as a message that landed — voicemail, a wrong number and a person
          saying &ldquo;yes, got it&rdquo; all look identical from the duration alone. So
          the transcript is read back afterwards and judged:{" "}
          <code style={{ fontFamily: mono }}>customer_response</code> is one of{" "}
          <code style={{ fontFamily: mono }}>confirmed</code>,{" "}
          <code style={{ fontFamily: mono }}>reschedule</code>,{" "}
          <code style={{ fontFamily: mono }}>cancel</code>,{" "}
          <code style={{ fontFamily: mono }}>unclear</code> or{" "}
          <code style={{ fontFamily: mono }}>not_reached</code>. It is null when the call
          never connected. Use <code style={{ fontFamily: mono }}>call_id</code> with{" "}
          <code style={{ fontFamily: mono }}>GET /api/v1/calls/:id</code> for the full
          transcript and recording.
        </P>
        <P>
          <strong>Verifying the signature.</strong> With a{" "}
          <code style={{ fontFamily: mono }}>callback_secret</code> set, every delivery
          carries <code style={{ fontFamily: mono }}>X-Nikki-Signature</code>: the HMAC-SHA256
          of the exact raw body, hex, prefixed <code style={{ fontFamily: mono }}>sha256=</code>.
          Compare it against the raw bytes, before any JSON parsing, in constant time.
        </P>
        <Code>{`import crypto from "crypto";

app.post("/hooks/nikki", express.raw({ type: "application/json" }), (req, res) => {
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.NIKKI_CALLBACK_SECRET)
    .update(req.body)                      // the raw Buffer, not the parsed object
    .digest("hex");
  const got = req.get("X-Nikki-Signature") || "";
  if (got.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body.toString());
  // ... your work here
  res.sendStatus(200);
});`}</Code>

        {/* ── ORDERS ───────────────────────────────────────── */}
        <H2 id="orders">Orders</H2>
        <P>
          Switch on order taking in <Link href="/setup" style={{ color: C.teal }}>Setup</Link>,
          type your price list, and Nikki takes orders on the phone: she quotes from your
          list, asks pickup or delivery, takes the address, reads the whole order back
          with the total, and sends a WhatsApp confirmation. The order appears here — and
          on your Orders page — the moment the call ends.
        </P>

        <Method verb="GET" path="/api/v1/orders" />
        <P>
          Newest first. <code style={{ fontFamily: mono }}>?status=</code>,{" "}
          <code style={{ fontFamily: mono }}>?from=</code>/<code style={{ fontFamily: mono }}>?to=</code>{" "}
          (ISO timestamps), <code style={{ fontFamily: mono }}>?limit=</code>,{" "}
          <code style={{ fontFamily: mono }}>?cursor=</code>.
        </P>
        <Code>{`{
  "items": [{
    "id": "8b3f...",
    "reference": "ORD-7K3Q",
    "customer_phone": "9848012345",
    "customer_name": "Ravi",
    "items": [
      { "name": "Chicken Biryani", "qty": 2, "unit_price": 250 },
      { "name": "Mirchi ka Salan", "qty": 1, "unit_price": 60, "notes": "less spicy" }
    ],
    "total": 560,
    "currency": "INR",
    "fulfilment": "delivery",
    "address": "Flat 302, Sai Residency, Kondapur — beside the water tank",
    "requested_time": "8 PM",
    "status": "new",
    "wa_confirmed": true,
    "call_id": "b21f...",
    "created_at": "2026-09-08T13:41:02.551Z"
  }],
  "has_more": false,
  "next_cursor": null
}`}</Code>
        <P>
          <code style={{ fontFamily: mono }}>total</code> is null when a price was never
          settled on the call — the shop confirms it at the counter. Prices come from your
          catalogue, not from what was heard on the line, so a misheard number cannot
          become a dispute.
        </P>

        <Method verb="PATCH" path="/api/v1/orders/:id" />
        <P>
          Move an order along from your kitchen or shop system:{" "}
          <code style={{ fontFamily: mono }}>{`{ "status": "preparing" }`}</code>. Statuses
          are <code style={{ fontFamily: mono }}>new</code>,{" "}
          <code style={{ fontFamily: mono }}>confirmed</code>,{" "}
          <code style={{ fontFamily: mono }}>preparing</code>,{" "}
          <code style={{ fontFamily: mono }}>ready</code>,{" "}
          <code style={{ fontFamily: mono }}>delivered</code>,{" "}
          <code style={{ fontFamily: mono }}>cancelled</code>. You may also set{" "}
          <code style={{ fontFamily: mono }}>notes</code>.
        </P>

        {/* ── ORDER WEBHOOK ────────────────────────────────── */}
        <H2 id="order-webhook">Order webhook</H2>
        <P>
          Rather than polling, set an automation webhook URL in Setup and we POST every
          event to <code style={{ fontFamily: mono }}>{"{your-url}/{event}"}</code> — so an
          order arrives at <code style={{ fontFamily: mono }}>{"{your-url}/order-created"}</code>,
          a booking at <code style={{ fontFamily: mono }}>{"{your-url}/appointment-confirmed"}</code>.
        </P>
        <Code>{`POST https://your-app.example.com/hooks/order-created

{
  "order_id": "8b3f...",
  "reference": "ORD-7K3Q",
  "tenant_id": "...",
  "call_id": "b21f...",
  "business_name": "Paradise Mess",
  "customer_phone": "9848012345",
  "customer_name": "Ravi",
  "items": [{ "name": "Chicken Biryani", "qty": 2, "unit_price": 250 }],
  "total": 560,
  "fulfilment": "delivery",
  "address": "Flat 302, Sai Residency, Kondapur",
  "requested_time": "8 PM"
}`}</Code>

        {/* ── READ ─────────────────────────────────────────── */}
        <H2 id="read">Reading calls & appointments</H2>
        <Method verb="GET" path="/api/v1/calls" />
        <P>
          Every call, inbound and outbound, newest first:{" "}
          <code style={{ fontFamily: mono }}>?from=</code>, <code style={{ fontFamily: mono }}>?to=</code>,{" "}
          <code style={{ fontFamily: mono }}>?limit=</code>, <code style={{ fontFamily: mono }}>?cursor=</code>.
          Each item carries the caller, direction, status, duration and intent.
        </P>
        <Method verb="GET" path="/api/v1/calls/:id" />
        <P>One call in full, including the transcript.</P>
        <Method verb="GET" path="/api/v1/appointments" />
        <P>
          Bookings Nikki made, by slot:{" "}
          <code style={{ fontFamily: mono }}>?from=</code>/<code style={{ fontFamily: mono }}>?to=</code>{" "}
          are matched against <code style={{ fontFamily: mono }}>scheduled_at</code>.
        </P>
        <Method verb="GET" path="/api/v1/usage" />
        <P>Minutes used this month. No scope needed beyond a valid key.</P>

        {/* ── ERRORS ───────────────────────────────────────── */}
        <H2 id="errors">Errors & limits</H2>
        <P>
          Errors are JSON: <code style={{ fontFamily: mono }}>{`{ "error": "...", "field": "phone" }`}</code>,
          with <code style={{ fontFamily: mono }}>code</code> on the ones worth branching on.
        </P>
        <Params rows={[
          ["400", "bad request", "A field is missing or malformed. `field` names it."],
          ["401", "auth", "No key, a malformed key, a revoked key, or one that has expired."],
          ["402", "plan_upgrade_required", "Outbound calling is not on this business's plan."],
          ["403", "scope", "The key is valid but was not granted this scope."],
          ["409", "conflict", "opted_out, duplicate, no_number, or a call already being dialled."],
          ["429", "rate limit", "100 requests per minute per key. Standard RateLimit headers are returned."],
        ]} />
        <P style={{ marginTop: 26 }}>
          Something missing that you need? Write to{" "}
          <a href="mailto:support@heynikki.in" style={{ color: C.teal }}>support@heynikki.in</a>{" "}
          and say what you are building — this API grows from what people ask for.
        </P>

        <div style={{ borderTop: `1px solid ${C.bord}`, marginTop: 46, paddingTop: 22,
          display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
          <Link href="/" style={{ color: C.dim, textDecoration: "none" }}>Home</Link>
          <Link href="/pricing" style={{ color: C.dim, textDecoration: "none" }}>Pricing</Link>
          <Link href="/api-keys" style={{ color: C.dim, textDecoration: "none" }}>Get a key</Link>
          <Link href="/contact" style={{ color: C.dim, textDecoration: "none" }}>Contact</Link>
        </div>
      </div>
    </div>
  );
}
