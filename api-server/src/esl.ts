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
  status:  "registered" | "unregistered" | "error" | "unknown";
  gateway: string;
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

      // Wait for complete response (ends with double newline or has Reply-Text)
      if (commandSent && (buffer.includes("\n\n") || buffer.includes("Reply-Text:"))) {
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

// ── FreeSWITCH ESL Client ─────────────────────────────────────
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
    const vars = [
      `origination_caller_id_number=${masked}`,
      `origination_caller_id_name=HeyNikki`,
      `hangup_after_bridge=true`,
      `ignore_early_media=true`,
      `originate_timeout=30`,
    ].join(",");

    // Leg 1 = agent, bridged to Leg 2 = customer.
    const cmd =
      `api originate {${vars}}sofia/gateway/jio_primary/${agent} ` +
      `&bridge({origination_caller_id_number=${masked}}sofia/gateway/jio_primary/${customer})`;

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
   * The existing /outbound path in the voice pipeline returns 503 unless
   * Exotel is configured — it was written before the move to FreeSWITCH and
   * never dialled on our own trunk. This does, using the same originate
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
  async originateOutbound(
    customerNumber: string,
    callerIdNumber: string,
    campaignId?:    string,
    timeoutSec = 35
  ): Promise<string> {
    const clean = (n: string) => n.replace(/[^0-9+]/g, "");
    const customer = clean(customerNumber);
    const cli      = clean(callerIdNumber);
    if (!customer) throw new Error("Outbound needs a customer number");
    if (!cli)      throw new Error("Outbound needs a caller ID we own");

    const digits = customer.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) throw new Error(`Bad customer number: ${customerNumber}`);

    const vars = [
      `origination_caller_id_number=${cli}`,
      `origination_caller_id_name=HeyNikki`,
      // Do NOT treat ringback as answer — otherwise the AI starts talking to
      // a ringing phone and the first seconds of the pitch are lost.
      `ignore_early_media=true`,
      `originate_timeout=${timeoutSec}`,
      campaignId ? `campaign_id=${campaignId}` : `campaign_id=`,
      `outbound_call=true`,
    ].join(",");

    const cmd =
      `api originate {${vars}}sofia/gateway/jio_primary/${digits} ` +
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
    if (!ringGroup) throw new Error("ring_group required for human transfer");

    // setvar before transfer — the extension reads both immediately.
    await eslCommand(`api uuid_setvar ${uuid} ring_group ${ringGroup}`);
    await eslCommand(`api uuid_setvar ${uuid} guard_seconds ${Math.max(5, guardSeconds)}`);
    await eslCommand(`api uuid_transfer ${uuid} human_transfer XML heynikki`);
  }

  /**
   * Hang up a specific channel by UUID.
   */
  async hangupChannel(uuid: string): Promise<void> {
    await eslCommand(`api uuid_kill ${uuid}`);
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

  /**
   * Get SIP gateway registration status for Jio and Vi trunks.
   */
  async getSipTrunkStatus(): Promise<SipTrunkStatus[]> {
    try {
      const response = await eslCommand("api sofia status gateway jio_primary");
      const jioParsed = parseESLResponse(response);

      const response2 = await eslCommand("api sofia status gateway vi_failover");
      const viParsed  = parseESLResponse(response2);

      const parseStatus = (parsed: Record<string, string>): SipTrunkStatus["status"] => {
        const state = (parsed["State"] || parsed["state"] || "").toLowerCase();
        if (state.includes("reged") || state.includes("registered")) return "registered";
        if (state.includes("unreg") || state.includes("unregistered")) return "unregistered";
        if (state.includes("failed") || state.includes("error")) return "error";
        return "unknown";
      };

      return [
        { name: "Jio Enterprise",    status: parseStatus(jioParsed), gateway: "jio_primary"  },
        { name: "Vi Business",       status: parseStatus(viParsed),  gateway: "vi_failover"  },
      ];
    } catch {
      return [
        { name: "Jio Enterprise", status: "error", gateway: "jio_primary" },
        { name: "Vi Business",    status: "error", gateway: "vi_failover" },
      ];
    }
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
