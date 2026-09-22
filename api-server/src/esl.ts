// api-server/src/esl.ts
// FreeSWITCH Event Socket Library (ESL) client
// Connects via TCP to FreeSWITCH port 8021 (localhost only — never expose externally)
// Uses Node.js built-in `net` module — no extra packages needed.

import net from "net";

const FS_HOST     = process.env.FREESWITCH_HOST         || "127.0.0.1";
const FS_PORT     = parseInt(process.env.FREESWITCH_ESL_PORT || "8021");
// No default. The stock FreeSWITCH password is "ClueCon" and it was the
// fallback here — meaning a missing env var silently produced a working
// connection secured by a password every attacker already knows. ESL has
// full call control and no rate limiting, so this fails closed instead.
const FS_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD || "";

export interface Channel {
  uuid:         string;
  direction:    string;
  caller_number: string;
  called_number: string;
  state:        string;
  duration_sec: number;
  context:      string;
}

export interface SipTrunkStatus {
  name:    string;
  status:  GatewayHealth["status"];
  gateway: string;
}

/**
 * Can a call get through this gateway right now, in FreeSWITCH's own words.
 *
 * `Status` (UP/DOWN) is the verdict of FreeSWITCH's OPTIONS pings to the
 * carrier, and it is the one line that matters. `State` is SIP registration,
 * and the Jio circuit is IP-authenticated: it never registers, so State is
 * NOREG on a healthy trunk and on a dead one alike. Reading State is how the
 * old check reported "unknown" forever, and how the trunk sat DOWN from
 * 21 Sep 14:52 IST with nothing saying so for 23 hours.
 */
export interface GatewayHealth {
  gateway:        string;
  /** up / down: FreeSWITCH's ping verdict. not_configured: no such gateway
   *  is loaded. unknown: we could not ask (ESL unreachable), which proves
   *  nothing about the carrier. */
  status:         "up" | "down" | "not_configured" | "unknown";
  /** Registration state. NOREG is normal for the Jio trunk. */
  state:          string;
  /** successes/failures/threshold of recent pings, e.g. "1/0/3". */
  pingState:      string;
  /** Outbound calls that failed through this gateway since FreeSWITCH started. */
  failedCallsOut: number;
  detail:         string;
}

/**
 * `sofia status gateway <name>` prints one "Key<padding>\tValue" per line.
 * Not "Key: Value" — which is why parseESLResponse, built for ESL headers,
 * saw none of it. Exported for tests.
 */
export function parseGatewayStatus(gateway: string, raw: string): GatewayHealth {
  const f: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Za-z-]+)\s*\t\s*(.*?)\s*$/);
    if (m) f[m[1]] = m[2];
  }
  const base = {
    gateway,
    state:          f["State"] || "",
    pingState:      f["PingState"] || "",
    failedCallsOut: parseInt(f["FailedCallsOUT"] || "0", 10) || 0,
  };
  if (/Invalid Gateway/i.test(raw)) {
    return { ...base, status: "not_configured", detail: `no gateway named ${gateway} is loaded` };
  }
  const s = (f["Status"] || "").toUpperCase();
  if (s === "UP")   return { ...base, status: "up",   detail: "" };
  if (s === "DOWN") return { ...base, status: "down", detail: `Status DOWN, ping ${base.pingState || "?"}` };
  return { ...base, status: "unknown", detail: "no Status line in the gateway report" };
}

// ── ESL Response Parser ───────────────────────────────────────
function parseESLResponse(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx > -1) {
      result[line.substring(0, idx).trim()] = line.substring(idx + 2).trim();
    }
  }
  return result;
}

// ── Low-level ESL command sender ─────────────────────────────
// What Jio actually sold, and how much of it outbound may use. Two channels
// are held back for inbound: a business whose own customers get congestion
// because our reminder run filled the trunk has been made worse off by the
// product. Env-overridable for the day the contract changes.
const TRUNK_CHANNELS = parseInt(process.env.TRUNK_MAX_CHANNELS || "10", 10);
const TRUNK_OUTBOUND_CEILING = Math.max(
  1, parseInt(process.env.TRUNK_OUTBOUND_CEILING || String(TRUNK_CHANNELS - 2), 10));

async function eslCommand(command: string, timeoutMs = 8000): Promise<string> {
  if (!FS_PASSWORD) {
    throw new Error("FREESWITCH_ESL_PASSWORD is not set — refusing to connect to ESL");
  }
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = "";
    let authenticated = false;
    let commandSent = false;

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`ESL timeout for: ${command}`));
    }, timeoutMs);

    socket.connect(FS_PORT, FS_HOST, () => {
      // FreeSWITCH sends auth/request on connect — wait for it
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();

      // Auth request
      if (!authenticated && buffer.includes("auth/request")) {
        socket.write(`auth ${FS_PASSWORD}\n\n`);
        buffer = "";
        return;
      }

      // Auth accepted
      if (!authenticated && buffer.includes("Reply-Text: +OK accepted")) {
        authenticated = true;
        buffer = "";
        // Send our command
        socket.write(`${command}\n\n`);
        commandSent = true;
        return;
      }

      // Wait for the COMPLETE response. FreeSWITCH writes the headers and the
      // body of an api/response separately, and this used to resolve on the
      // first "\n\n" — the end of the headers — with no body. Measured: 2 in
      // 200 `show channels count` replies came back empty. On an originate
      // that loses the "+OK <uuid>" of a call that WAS answered, so the
      // dispatcher recorded a live conversation as a no-answer, sent the
      // "missed you" WhatsApp and queued a redial.
      if (commandSent) {
        const sep = buffer.indexOf("\n\n");
        if (sep < 0) return;
        const headers = buffer.slice(0, sep);
        const m = headers.match(/Content-Length:\s*(\d+)/i);
        if (m) {
          const body = Buffer.from(buffer.slice(sep + 2), "utf8");
          if (body.length < parseInt(m[1], 10)) return;
        } else if (!/Reply-Text:/i.test(headers)) {
          return;
        }
        clearTimeout(timer);
        const response = buffer;
        socket.destroy();
        resolve(response);
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`ESL connection error: ${err.message}. Is FreeSWITCH running?`));
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!commandSent) resolve("");
    });
  });
}

// ── Values interpolated into ESL commands ─────────────────────
// An originate is ONE line of text: `{a=1,b=2}sofia/... dest XML ctx`, and an
// ESL command ends at a newline. A comma in a variable starts a new variable,
// a `}` closes the block early, a space ends the dial string and a newline
// starts a whole new ESL command — with full call control. campaign_id,
// onboard_tenant and ring_group went in exactly as they arrived. Today they
// come from our own database, but "nobody would put a newline in a campaign
// id" is not a security boundary. Each is cut down to the characters its
// value can legitimately contain.
function safeUuid(v: unknown): string {
  return String(v ?? "").replace(/[^0-9a-f-]/gi, "").slice(0, 36);
}
// A ring group is a comma-separated list of dial strings such as
// sofia/gateway/jio_primary/+919848012345. No spaces, braces, quotes or
// line breaks can appear in one.
function safeDialList(v: unknown): string {
  return String(v ?? "").replace(/[^A-Za-z0-9_/+.,:@|-]/g, "");
}
function safeSeconds(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── FreeSWITCH ESL Client ─────────────────────────────────────
/**
 * The form the trunk will accept as a caller ID.
 *
 * Jio's SBC (AudioCodes) classifies every outbound INVITE by the From-user
 * and needs it in strict E.164. Traced on 2026-09-04 against the live
 * trunk, same callee, three CLIs:
 *   8633502033     -> 500 "Classification Failure"  (NORMAL_TEMPORARY_FAILURE)
 *   918633502033   -> 407 Proxy Authentication Required, no challenge (CALL_REJECTED)
 *   +918633502033  -> 183 / 180 Ringing / 200 OK
 * The "91" form was accepted once; Jio tightened classification and 250
 * consecutive outbound attempts then failed as CALL_REJECTED, which reads
 * like a dead trunk. The old note here that FreeSWITCH rejects a leading
 * "+" is wrong for origination_caller_id_number — verified in the same
 * trace.
 *
 * Every originate path needed this and each was written to remember it
 * separately, so none of them did.
 */
export function wireCli(n: string): string {
  const d = String(n || "").replace(/[^\d]/g, "").replace(/^0+/, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return d;
}

/**
 * The form the trunk will accept as a CALLEE.
 *
 * Same SBC, same strictness, other side of the INVITE. A bare ten-digit
 * Request-URI user was accepted for months and then, on 2026-09-04, every
 * campaign call came back 484 Address Incomplete (INVALID_NUMBER_FORMAT to
 * us) while the identical originate with +91 on the callee rang through.
 * Every outbound dial string goes through here so the next tightening is a
 * one-line fix instead of a hunt across three files and a dialplan.
 */
export function wireCallee(n: string): string {
  return wireCli(n);
}

/** Trunk channels one click-to-call takes: the seat's mobile, then the
 *  customer. Both legs ride the Jio trunk. */
export const CTC_LEGS = 2;

/**
 * Whether a click-to-call fits on the trunk right now.
 *
 * It needs BOTH its legs under the same outbound ceiling campaigns stop at,
 * so two channels always stay free for people ringing in. With four
 * telecallers on a 10-channel trunk that is exactly the limit: 0, 2, 4, 6
 * all fit, the fourth call reaches 8, and a fifth call (or a campaign leg
 * on top of four seats) is refused here with a message a telecaller can
 * act on, instead of by Jio's SBC as a NORMAL_TEMPORARY_FAILURE that looks
 * like a dead line.
 *
 * Two seats pressing Call in the same instant can both read the same count
 * and both proceed. That overshoots by at most one call, into the two
 * inbound channels, which is the same exposure there was before this check
 * existed. A lock would cost a round trip on every call to close it.
 */
export function clickToCallFits(inUse: number, ceiling = TRUNK_OUTBOUND_CEILING): boolean {
  return inUse + CTC_LEGS <= ceiling;
}

export class FreeSwitchESL {

  /**
   * Click-to-Call: initiates a 2-leg bridged call.
   * Leg 1: rings the AGENT first.
   * Leg 2: once the agent picks up, dials the customer via the Jio trunk.
   * The customer sees the masked CLI (the Jio DID assigned to the tenant).
   *
   * Agent-first is deliberate. Dialling the customer first means they
   * answer to silence while the agent's phone is still ringing — the
   * single fastest way to get hung up on. Ringing the agent first
   * means the human is already on the line the moment the customer
   * picks up.
   *
   * @param agentNumber    Agent's mobile/extension (E.164 or 10-digit)
   * @param customerNumber Customer's mobile number
   * @param maskedCli      Jio DID shown as caller ID to the customer
   * @returns FreeSWITCH channel UUID
   */
  async clickToCall(
    agentNumber:    string,
    customerNumber: string,
    maskedCli:      string
  ): Promise<string> {
    const clean = (n: string) => n.replace(/[^0-9+]/g, "");
    const customer = clean(customerNumber);
    const agent    = clean(agentNumber);
    const masked   = clean(maskedCli);

    if (!customer || !agent) {
      throw new Error("Click-to-Call needs both an agent number and a customer number");
    }

    // Checked before anything rings: refusing after the seat's phone has
    // been dialled would ring them for a call that can never connect.
    const inUse = await this.channelsInUse();
    if (!clickToCallFits(inUse)) {
      throw new Error(
        `SWITCH_CONGESTION: trunk busy, ${inUse}/${TRUNK_CHANNELS} channels in use ` +
        `(a click-to-call needs ${CTC_LEGS}; outbound stops at ${TRUNK_OUTBOUND_CEILING} so inbound calls still fit)`);
    }

    // FreeSWITCH originate syntax is whitespace-sensitive:
    //
    //   originate <vars><dial-string> <application>
    //
    // The {vars} block abuts the dial string with NO space, but there
    // MUST be a space after "originate" and before the &bridge(...)
    // application. Building this with .join("") produced
    // "api originate{...}sofia/...&bridge(...)" — which FreeSWITCH
    // cannot parse, so every click-to-call failed at runtime while
    // still typechecking cleanly.
    const customer10 = customer.replace(/\D/g, "").slice(-10);
    const did10      = masked.replace(/\D/g, "").slice(-10);
    const vars = [
      `origination_caller_id_number=${wireCli(masked)}`,
      `origination_caller_id_name=HeyNikki`,
      `hangup_after_bridge=true`,
      `ignore_early_media=true`,
      `originate_timeout=30`,
      // Read by the click_to_call_agent_leg extension: the hangup hook
      // reports did_number/caller_ani the same way an inbound leg does, so
      // the api-server closes the calls row it opened for this dial.
      `did_number=${did10}`,
      `caller_ani=${customer10}`,
      `outbound_cli=${wireCli(masked)}`,
      `ctc_customer_bridge=sofia/gateway/jio_primary/${wireCallee(customer)}`,
    ].join(",");

    // Leg 1 = agent. Once they answer, the leg is dropped into the
    // click_to_call_agent_leg extension, which records it, arms the hangup
    // hook and bridges Leg 2 = customer. The old form bridged straight from
    // the originate, which meant no dialplan ran: no recording, no hangup
    // report, and a call nothing in the product could see afterwards.
    const cmd =
      `api originate {${vars}}sofia/gateway/jio_primary/${wireCallee(agent)} ` +
      `ctc_agent_${customer10} XML heynikki`;

    const response = await eslCommand(cmd, 40000);   // ringing can take ~30s

    const match = response.match(/\+OK\s+([a-f0-9-]{36})/i);
    if (match) return match[1];

    const parsed  = parseESLResponse(response);
    const errLine = Object.entries(parsed).find(([k]) => k.toLowerCase().includes("reply"));
    throw new Error(`Click-to-Call failed: ${errLine?.[1] || response.slice(0, 160)}`);
  }

  /**
   * Dial a customer and hand the answered call to the AI.
   *
   * The voice pipeline's /outbound path has been DELETED — it predated the
   * move to FreeSWITCH, never dialled on our own trunk, and had been raising
   * NameError since the Exotel module it called was removed. This is the
   * only outbound origination path now, using the same originate
   * syntax as clickToCall above (note the whitespace rules there; they
   * apply here too).
   *
   * Three-argument form: originate <dial-string> <exten> <dialplan> <context>.
   * The answered leg is dropped into camp_<number>, which the
   * outbound_campaign extension matches — it starts uuid_audio_stream and
   * parks, so the pipeline drives the conversation exactly as it does for an
   * inbound call. That extension existed but nothing ever produced a camp_
   * destination, so it was unreachable code until now.
   *
   * origination_caller_id_number MUST be a DID we actually own. A spoofed CLI
   * on an Indian trunk gets the trunk suspended, not just the call rejected.
   */
  /**
   * How many legs the trunk is carrying right now.
   *
   * Jio sold ten channels and nothing local enforced it: call eleven was
   * refused by the carrier's SBC, which arrives here as a generic
   * NORMAL_TEMPORARY_FAILURE indistinguishable from a dead trunk — so a
   * busy hour looked exactly like an outage, and the dispatcher's trunk
   * retry ladder ran against a trunk that was simply full.
   *
   * Counted rather than configured, because a sofia gateway has no channel
   * cap parameter — the number lives in `show channels`.
   */
  async channelsInUse(): Promise<number> {
    try {
      const out = await eslCommand("api show channels count", 4000);
      const m = out.match(/(\d+)\s+total/i);
      return m ? parseInt(m[1], 10) : 0;
    } catch (e: any) {
      // Never block a call on a failed count: an unknown number is not a
      // full trunk, and refusing to dial because we could not ask is worse
      // than letting Jio refuse the eleventh call as it does today.
      console.warn("[esl] channel count failed:", e?.message || e);
      return 0;
    }
  }

  async originateOutbound(
    customerNumber: string,
    callerIdNumber: string,
    campaignId?:    string,
    timeoutSec = 35,
    // Why we are ringing them ("incomplete_booking", "lead_capture"); the
    // pipeline opens the call with that instead of a generic follow-up.
    callReason = "",
    // The outbound_recipients row this leg belongs to. An API-placed
    // reminder call carries its message in that row, and the pipeline
    // needs it BEFORE the first word — the dispatcher only writes
    // metadata.fs_uuid after originate returns, which is after the
    // pipeline has already connected, so looking the row up by channel
    // UUID would race. Handed over as a channel variable instead.
    recipientId = ""
  ): Promise<string> {
    const clean = (n: string) => n.replace(/[^0-9+]/g, "");
    const customer = clean(customerNumber);
    const cli      = clean(callerIdNumber);
    timeoutSec     = safeSeconds(timeoutSec, 35);
    if (!customer) throw new Error("Outbound needs a customer number");
    if (!cli)      throw new Error("Outbound needs a caller ID we own");

    const digits = customer.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) throw new Error(`Bad customer number: ${customerNumber}`);

    // The trunk classifies OUTBOUND calls on the caller ID, and refuses a
    // bare ten-digit CLI with 500 "Classification Failure" — which surfaces
    // here as NORMAL_TEMPORARY_FAILURE and looks exactly like a dead trunk.
    // With the country code the same INVITE is accepted and the phone rings.
    // See wireCli / wireCallee for the forms Jio accepts today — both sides
    // of the INVITE now need +91.
    //
    // Only what goes ON THE WIRE changes. outbound_did stays ten digits
    // below, because the pipeline resolves the tenant's voice profile from
    // it and a 91-prefixed lookup would find no profile — the call would
    // connect and then have nobody to be.
    // Leave room for people ringing IN. Inbound is a customer who chose to
    // call a business; outbound is a reminder that can wait five minutes,
    // and an outbound burst that fills the trunk makes the business
    // uncontactable — the one failure a receptionist product cannot have.
    const inUse = await this.channelsInUse();
    if (inUse >= TRUNK_OUTBOUND_CEILING) {
      throw new Error(
        `SWITCH_CONGESTION: trunk busy, ${inUse}/${TRUNK_CHANNELS} channels in use ` +
        `(outbound stops at ${TRUNK_OUTBOUND_CEILING} so inbound calls still fit)`);
    }

    const sipCli = wireCli(cli);

    const vars = [
      `origination_caller_id_number=${sipCli}`,
      `origination_caller_id_name=HeyNikki`,
      // Do NOT treat ringback as answer — otherwise the AI starts talking to
      // a ringing phone and the first seconds of the pitch are lost.
      `ignore_early_media=true`,
      `originate_timeout=${timeoutSec}`,
      `campaign_id=${safeUuid(campaignId)}`,
      `call_reason=${callReason.replace(/[^a-z_]/gi, "")}`,
      `recipient_id=${recipientId.replace(/[^0-9a-f-]/gi, "")}`,
      `outbound_call=true`,
      // The answered leg is streamed to the SAME pipeline handler inbound
      // calls use, and that handler resolves the tenant's voice profile from
      // the DID in the URL. Carrying our own CLI through as a channel
      // variable is what lets the dialplan build that URL — without it the
      // outbound extension has no DID to look the profile up by.
      `outbound_did=${cli}`,
      // The dialplan sets effective_caller_id_number from ${outbound_cli} on
      // BOTH outbound extensions, and nothing had ever set it — so the two
      // places that exist to make sure we present a number we own were
      // assigning an empty string. origination_caller_id_number above covers
      // the originate itself, which is why this never showed up as a failed
      // call; it would have shown up the first time an outbound leg was
      // bridged onward.
      // The wire form again: this is what a bridged leg presents.
      `outbound_cli=${sipCli}`,
    ].join(",");

    const cmd =
      `api originate {${vars}}sofia/gateway/jio_primary/${wireCallee(digits)} ` +
      `camp_${digits} XML heynikki`;

    const response = await eslCommand(cmd, (timeoutSec + 10) * 1000);
    const match = response.match(/\+OK\s+([a-f0-9-]{36})/i);
    if (match) return match[1];

    // NO_ANSWER / USER_BUSY / CALL_REJECTED are normal campaign outcomes, not
    // faults — the caller sees them as a status, not an error.
    const reason = (response.match(/-ERR\s+([A-Z_]+)/) || [])[1] || response.slice(0, 120);
    throw new Error(`originate failed: ${reason}`);
  }

  /**
   * Ring a business that has just signed up, so Nikki can ask them about
   * their business and fill their setup from the answers.
   *
   * Same originate as a campaign call, a different extension on purpose:
   * camp_ carries consent, DND and calling-window rules that belong to
   * marketing. This is a call to our own customer about their own account,
   * and the two should not be able to inherit each other's rules by accident.
   *
   * onboard_tenant rides through as a channel variable so the dialplan can
   * put it on the websocket URL — that is how the pipeline knows to run the
   * interview instead of answering as that business's receptionist.
   */
  async originateOnboarding(
    ownerPhone:   string,
    callerId:     string,
    tenantId:     string,
    timeoutSec = 40,
  ): Promise<string> {
    const clean = (n: string) => n.replace(/[^0-9+]/g, "");
    const digits = clean(ownerPhone).replace(/\D/g, "").slice(-10);
    const cli    = clean(callerId);
    const tenant = safeUuid(tenantId);
    timeoutSec   = safeSeconds(timeoutSec, 40);
    if (digits.length !== 10) throw new Error(`Bad owner number: ${ownerPhone}`);
    if (!cli)      throw new Error("Onboarding needs a caller ID we own");
    if (tenant.length !== 36) throw new Error("Onboarding needs a tenant");

    const vars = [
      `origination_caller_id_number=${wireCli(cli)}`,
      `origination_caller_id_name=HeyNikki`,
      `ignore_early_media=true`,
      `originate_timeout=${timeoutSec}`,
      `outbound_cli=${wireCli(cli)}`,
      `onboard_did=${cli}`,
      `onboard_tenant=${tenant}`,
    ].join(",");

    const response = await eslCommand(
      `api originate {${vars}}sofia/gateway/jio_primary/${wireCallee(digits)} ` +
      `onb_${digits} XML heynikki`,
      (timeoutSec + 10) * 1000,
    );
    const match = response.match(/\+OK\s+([a-f0-9-]{36})/i);
    if (match) return match[1];
    const reason = (response.match(/-ERR\s+([A-Z_]+)/) || [])[1] || response.slice(0, 120);
    throw new Error(`onboarding originate failed: ${reason}`);
  }

  /**
   * Transfer a live channel into the human ring-group extension.
   *
   * This is what actually makes the dids.routing_mode column mean
   * something. The pipeline calls it (via the API server) when a DID
   * is set to "human", or when a caller mid-conversation asks for a
   * person. Channel variables are set first so the dialplan's
   * inbound_human extension knows who to ring and how long to wait
   * before the missed-call guard fires.
   */
  async transferToHuman(
    uuid:         string,
    ringGroup:    string,
    guardSeconds: number = 20
  ): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(uuid)) throw new Error("Invalid channel uuid");
    const group = safeDialList(ringGroup);
    if (!group) throw new Error("ring_group required for human transfer");

    // setvar before transfer — the extension reads both immediately.
    // guard_seconds arrives as parseInt(req.body...) and was NaN for a bad
    // value; Math.max(5, NaN) is NaN, and "NaN" became the ring timeout.
    await eslCommand(`api uuid_setvar ${uuid} ring_group ${group}`);
    await eslCommand(`api uuid_setvar ${uuid} guard_seconds ${Math.max(5, safeSeconds(guardSeconds, 20))}`);
    await eslCommand(`api uuid_transfer ${uuid} human_transfer XML heynikki`);
  }

  /**
   * Hang up a specific channel by UUID.
   */
  async hangupChannel(uuid: string): Promise<void> {
    await eslCommand(`api uuid_kill ${uuid}`);
  }

  /**
   * Is this channel still up? `uuid_exists` answers "true"/"false" as the
   * body. Used to time a click-to-call leg, which has no hangup hook of its
   * own (the originate variables cannot carry the quoted curl the dialplan
   * uses), and to tell the dashboard when a dialled call has ended.
   */
  async channelExists(uuid: string): Promise<boolean> {
    if (!/^[a-f0-9-]{36}$/i.test(uuid)) return false;
    const r = await eslCommand(`api uuid_exists ${uuid}`);
    return /\btrue\b/.test(r);
  }

  /**
   * Get all active channels across all contexts.
   */
  async getActiveChannels(): Promise<Channel[]> {
    try {
      const response = await eslCommand("api show channels as json");
      // FreeSWITCH returns JSON after the headers
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const data = JSON.parse(jsonMatch[0]);
      const rows = data.rows || [];

      return rows.map((row: any) => ({
        uuid:          row.uuid          || "",
        direction:     row.direction     || "inbound",
        caller_number: row.cid_num       || row.caller_id_number || "",
        called_number: row.dest          || "",
        state:         row.callstate     || row.state || "",
        duration_sec:  parseInt(row.duration || "0"),
        context:       row.context       || "",
      }));
    } catch {
      return [];
    }
  }

  /** Whether calls can get through a gateway. See GatewayHealth. */
  async gatewayHealth(gateway: string): Promise<GatewayHealth> {
    const name = gateway.replace(/[^A-Za-z0-9_-]/g, "");
    try {
      return parseGatewayStatus(name, await eslCommand(`api sofia status gateway ${name}`, 4000));
    } catch (e: any) {
      return { gateway: name, status: "unknown", state: "", pingState: "", failedCallsOut: 0,
               detail: e?.message || String(e) };
    }
  }

  /** Jio and Vi, for the Super Admin FreeSWITCH panel. */
  async getSipTrunkStatus(): Promise<SipTrunkStatus[]> {
    const [jio, vi] = await Promise.all([
      this.gatewayHealth("jio_primary"),
      this.gatewayHealth("vi_failover"),
    ]);
    return [
      { name: "Jio Enterprise", status: jio.status, gateway: "jio_primary" },
      { name: "Vi Business",    status: vi.status,  gateway: "vi_failover" },
    ];
  }

  /**
   * Reload FreeSWITCH dialplan XML (after DID changes).
   */
  async reloadXml(): Promise<void> {
    await eslCommand("api reloadxml");
  }

  /**
   * Get FreeSWITCH uptime and version.
   */
  async getStatus(): Promise<{ uptime: string; version: string; active_calls: number }> {
    try {
      const response = await eslCommand("api status");
      const uptimeMatch  = response.match(/UP\s+([\d\s\w,]+)/i);
      const versionMatch = response.match(/FreeSWITCH Version ([\d.]+)/i);

      // "N session(s) since startup" is the lifetime total, not the live
      // count — it was being reported to Super Admin as "active calls",
      // so a healthy server that had handled 4,000 calls displayed 4,000
      // concurrent channels. The live figure is "N session(s) - peak M",
      // which FreeSWITCH prints separately.
      const liveMatch =
        response.match(/(\d+)\s+session\(s\)\s*-\s*peak/i) ||
        response.match(/(\d+)\s+session\(s\)\s+current/i);

      return {
        uptime:       uptimeMatch?.[1]?.trim() || "unknown",
        version:      versionMatch?.[1] || "unknown",
        active_calls: parseInt(liveMatch?.[1] || "0"),
      };
    } catch {
      return { uptime: "unavailable", version: "unavailable", active_calls: 0 };
    }
  }

  /**
   * Check if FreeSWITCH ESL is reachable.
   */
  async isAlive(): Promise<boolean> {
    try {
      await eslCommand("api status", 3000);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton — reuse across API server
export const fsl = new FreeSwitchESL();
