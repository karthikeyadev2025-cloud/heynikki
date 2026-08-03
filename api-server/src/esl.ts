// api-server/src/esl.ts
// FreeSWITCH Event Socket Library (ESL) client
// Connects via TCP to FreeSWITCH port 8021 (localhost only — never expose externally)
// Uses Node.js built-in `net` module — no extra packages needed.

import net from "net";

const FS_HOST     = process.env.FREESWITCH_HOST         || "127.0.0.1";
const FS_PORT     = parseInt(process.env.FREESWITCH_ESL_PORT || "8021");
const FS_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD || "ClueCon";

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
   * Leg 1: rings the agent's phone/browser
   * Leg 2: dials the customer via Jio SIP trunk
   * The customer sees the masked CLI (the Jio DID assigned to the tenant).
   *
   * @param agentNumber   Agent's internal extension or SIP URI
   * @param customerNumber Customer's mobile number (E.164 preferred)
   * @param maskedCli     Jio DID to show as caller ID to customer
   * @returns FreeSWITCH channel UUID
   */
  async clickToCall(
    agentNumber:    string,
    customerNumber: string,
    maskedCli:      string
  ): Promise<string> {
    // Sanitize numbers
    const clean = (n: string) => n.replace(/[^0-9+]/g, "");
    const customer = clean(customerNumber);
    const masked   = clean(maskedCli);

    // ESL originate: bridge agent + customer with masked CLI
    // Dial agent first, then bridge to customer
    const cmd = [
      `api originate`,
      `{origination_caller_id_number=${masked},`,
      `origination_caller_id_name=HeyNikki,`,
      `hangup_after_bridge=true}`,
      `sofia/gateway/jio_primary/${customer}`,
      `&bridge(user/${agentNumber})`,
    ].join("");

    const response = await eslCommand(cmd);
    const parsed   = parseESLResponse(response);

    // Response on success: "+OK <uuid>"
    const match = response.match(/\+OK\s+([a-f0-9-]{36})/);
    if (match) return match[1];

    // If ESL failed
    const errLine = Object.entries(parsed).find(([k]) => k.toLowerCase().includes("reply"));
    throw new Error(`Click-to-Call failed: ${errLine?.[1] || response.slice(0, 100)}`);
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
      const uptimeMatch = response.match(/UP\s+([\d\s\w,]+)/i);
      const versionMatch = response.match(/FreeSWITCH Version ([\d.]+)/i);
      const sessionsMatch = response.match(/(\d+)\s+session\(s\) since startup/i);

      return {
        uptime:       uptimeMatch?.[1]?.trim() || "unknown",
        version:      versionMatch?.[1] || "unknown",
        active_calls: parseInt(sessionsMatch?.[1] || "0"),
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
