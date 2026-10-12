/**
 * The Desk softphone: a telecaller's browser as the phone.
 *
 * Until this, a Desk call rang the telecaller's own mobile first and then
 * the customer — two trunk legs for one conversation, a wait while the seat
 * answered their own phone, customer calls on personal handsets, and a seat
 * with no mobile on file could not work at all. Here the browser IS the
 * seat's leg: WebRTC audio to FreeSWITCH (sip_profiles/webrtc.xml), one
 * trunk leg to the customer.
 *
 * WHAT STANDS BETWEEN A BROWSER AND THE SWITCH
 * FreeSWITCH's browser profile listens on loopback only and has no SIP
 * passwords. Everything a browser sends goes through the proxy below, which
 *   1. refuses the WebSocket unless it carries a valid login, and
 *   2. reads every SIP message and passes only the two things a seat may
 *      do — REGISTER as itself, and INVITE a one-time token this server
 *      issued — plus the in-dialog messages those need.
 * So the switch never sees a message this file has not approved, and a
 * stolen page script cannot dial a number: only the API can turn a token
 * into a customer leg, after the same checks a phone-bridged call gets.
 *
 * Pure logic (seat ids, message policy, tokens, dial strings) is exported
 * on its own so tests cover it without a socket.
 */
import crypto from "crypto";
import os from "os";
import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import WebSocket, { WebSocketServer } from "ws";

export const SOFTPHONE_PATH   = "/softphone/ws";
export const SOFTPHONE_DOMAIN = "heynikki.in";
const FS_WS_URL = process.env.SOFTPHONE_FS_WS || "ws://127.0.0.1:5066";

/**
 * The address this proxy connects to the switch FROM.
 *
 * FreeSWITCH offers its public media address only to a peer it does not
 * take for a neighbour, and a connection from 127.0.0.1 is a neighbour
 * whatever the profile says (the loopback test is compiled in). Every
 * browser arrived that way, so each was offered the LAN address alone and
 * a seat outside the office Wi-Fi could never exchange audio. Connecting
 * from one of this machine's own network addresses reaches the same
 * loopback listener and is not mistaken for a local phone.
 */
export function switchSourceAddress(
  ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
  wanted = process.env.SOFTPHONE_FS_SRC || "",
): string | undefined {
  const v4 = Object.values(ifaces).flatMap(l => l || [])
    .filter(i => !i.internal && (i.family === "IPv4" || (i.family as unknown) === 4))
    .map(i => i.address);
  if (wanted) return v4.includes(wanted) ? wanted : undefined;
  return v4[0];
}

/* ── Seats ──────────────────────────────────────────────────── */

/** The SIP user a login registers as: "u" + the user id without dashes. */
export function seatId(userId: string): string {
  const hex = String(userId || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("Invalid user id");
  return "u" + hex;
}

/* ── What a browser may send ────────────────────────────────── */

const IN_DIALOG = new Set(["ACK", "BYE", "CANCEL", "INFO", "UPDATE", "OPTIONS", "PRACK"]);
const TOKEN_RE  = /^ctc_[0-9a-f]{32}$/;

function header(msg: string, name: string, compact?: string): string {
  const names = compact ? `(?:${name}|${compact})` : name;
  const m = msg.match(new RegExp(`^${names}[ \\t]*:[ \\t]*(.*)$`, "im"));
  return m ? m[1] : "";
}
function uriUser(v: string): string {
  const m = v.match(/sips?:([^@;>\s]+)@/i);
  return m ? decodeURIComponent(m[1]) : "";
}
function hasToTag(msg: string): boolean {
  return /;\s*tag=/i.test(header(msg, "To", "t"));
}

/**
 * Why a browser's SIP message is refused, or "" when it may pass.
 *
 * `seat` is the only identity this connection may use: the one its login
 * maps to. A browser that could put another seat in From would take that
 * seat's incoming calls; one that could INVITE an arbitrary target would
 * be probing the dialplan. Neither is a message the softphone ever sends.
 */
export function refuseClientSip(msg: string, seat: string): string {
  // Keep-alive: SIP.js sends a bare CRLF pair.
  if (/^[\r\n]*$/.test(msg)) return "";
  if (msg.length > 16_384) return "message too large";
  const line = msg.slice(0, msg.indexOf("\r\n") >= 0 ? msg.indexOf("\r\n") : msg.length);

  // A response to something the switch asked (the 200 to its INVITE or BYE).
  if (/^SIP\/2\.0 \d{3}\b/.test(line)) return "";

  const m = line.match(/^([A-Z]+) (\S+) SIP\/2\.0$/);
  if (!m) return "not a SIP message";
  const [, method, target] = m;

  // Identity is checked where a message STARTS something. Inside a call the
  // switch rang us for, our From is the contact it dialled, not the seat —
  // and those messages only mean anything to a dialog that already exists.
  const fromSeat = uriUser(header(msg, "From", "f")) === seat;

  if (method === "REGISTER") {
    if (!fromSeat || uriUser(header(msg, "To", "t")) !== seat) return "may only register its own seat";
    return "";
  }
  if (method === "INVITE") {
    // A re-INVITE (hold, ICE restart) inside a call already set up.
    if (hasToTag(msg)) return "";
    if (!fromSeat) return "From is not this seat";
    const user = uriUser(target);
    if (TOKEN_RE.test(user) || user === "selftest") return "";
    return "may only call a token this server issued";
  }
  if (IN_DIALOG.has(method)) return "";
  return `${method} is not allowed`;
}

/**
 * A browser on https names its transport WSS in the Via of everything it
 * sends. The switch hears it on a plain WS socket (TLS ends at Cloudflare,
 * and this proxy speaks ws:// to loopback), finds no WSS transport to
 * answer on, and answers nothing at all: every REGISTER from a real
 * browser went unanswered and the phone never came up. Tests from a
 * ws:// page said WS and worked, which is how this hid.
 *
 * So the Via is told the truth on the way in, and put back on the way out
 * for a browser that checks its own Via on the reply.
 */
const VIA_WSS = /^((?:Via|v)[ \t]*:[ \t]*SIP\/2\.0\/)WSS(?=[ \t])/im;
const VIA_WS  = /^((?:Via|v)[ \t]*:[ \t]*SIP\/2\.0\/)WS(?=[ \t])/im;
export function viaForSwitch(msg: string): { msg: string; changed: boolean } {
  if (!VIA_WSS.test(msg)) return { msg, changed: false };
  return { msg: msg.replace(VIA_WSS, "$1WS"), changed: true };
}
export function viaForBrowser(msg: string): string {
  // Only replies carry the browser's own Via back; a request from the
  // switch has the switch's.
  return /^SIP\/2\.0 \d{3}\b/.test(msg) ? msg.replace(VIA_WS, "$1WSS") : msg;
}

/* ── One-time call tokens ───────────────────────────────────── */

export type PendingCall = {
  seat: string;            // who may use it
  tenantId: string;
  userId: string;
  customer: string;        // 10 digits
  maskedCli: string;       // the DID the customer sees
  callId: string | null;   // calls.id
  ctcLogId: string | null; // click_to_call_log.id
  expires: number;
};

export const TOKEN_TTL_MS = 60_000;
const pending = new Map<string, PendingCall>();

function sweep(now: number) {
  for (const [k, v] of pending) if (v.expires <= now) pending.delete(k);
}

/** Issue a token for one call. Valid once, for TOKEN_TTL_MS, for one seat. */
export function issueToken(call: Omit<PendingCall, "expires">, now = Date.now()): string {
  sweep(now);
  const token = crypto.randomBytes(16).toString("hex");
  pending.set(token, { ...call, expires: now + TOKEN_TTL_MS });
  return token;
}

/**
 * Redeem a token. Returns the call it stands for, or null — and a token
 * that is wrong for ANY reason (unknown, expired, used, another seat's) is
 * simply null: the caller hangs the leg up and learns nothing.
 */
export function claimToken(token: string, seat: string, now = Date.now()): PendingCall | null {
  const call = pending.get(String(token || ""));
  if (!call) return null;
  pending.delete(token);                 // one use, whoever presented it
  if (call.expires <= now || call.seat !== seat) return null;
  return call;
}

/** Issued and not yet redeemed (expired ones included until swept). */
export function tokenPending(token: string): boolean { return pending.has(token); }

/** For tests. */
export function pendingTokens(): number { return pending.size; }

/* ── Ringing a browser ──────────────────────────────────────── */

/** Stands in a ring group for "this seat's browser, if it is online". */
export function seatPlaceholder(userId: string): string {
  return `webrtc_seat/${seatId(userId)}`;
}

const PLACEHOLDER_RE = /webrtc_seat\/(u[0-9a-f]{32})/g;
// What `sofia_contact` returns for a registered browser. Anything else —
// "error/user_not_registered", or a string that is not exactly this shape —
// is treated as offline rather than passed to a bridge.
const CONTACT_RE = /^sofia\/webrtc\/sip:[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?::\d+)?(?:;[A-Za-z0-9_.%=-]+)*$/;

export function isBrowserContact(s: string): boolean {
  return CONTACT_RE.test(s);
}

/**
 * Turn the seat placeholders in a ring group into real dial strings.
 *
 * `contacts` maps a seat to what the switch says its browser is reachable
 * at right now (one entry per open tab), looked up at the moment of the
 * transfer — a ring group is built when the call starts and may be used
 * minutes later, after a seat has closed their laptop.
 *
 * Online browsers ring first, alone, for `browserSeconds`; then the phones
 * the group already had, as before. No browser online: the group is the
 * phones, exactly as it was.
 */
export function resolveRingGroup(
  group: string,
  contacts: Record<string, string[]>,
  callerNumber: string,
  browserSeconds = 15,
): string {
  const seats = new Set<string>();
  group.replace(PLACEHOLDER_RE, (_m, seat) => { seats.add(seat); return ""; });
  // What is left once the placeholders are gone: the phone legs.
  const phones = group.replace(PLACEHOLDER_RE, "")
    .replace(/,{2,}/g, ",").replace(/\|,|,\|/g, "|").replace(/\|{2,}/g, "|")
    .replace(/^[,|]+|[,|]+$/g, "");

  const caller = String(callerNumber || "").replace(/\D/g, "").slice(-10);
  const vars = [`leg_timeout=${Math.max(5, Math.floor(browserSeconds) || 15)}`];
  // The seat should see who is calling, not the business's own number.
  if (caller.length === 10) {
    vars.push(`origination_caller_id_number=${caller}`, `origination_caller_id_name=${caller}`);
  }
  const legs: string[] = [];
  for (const seat of seats) {
    for (const c of contacts[seat] || []) {
      if (isBrowserContact(c)) legs.push(`[${vars.join(",")}]${c}`);
    }
  }
  if (!legs.length) return phones;
  return phones ? `${legs.join(",")}|${phones}` : legs.join(",");
}

/* ── ICE servers ────────────────────────────────────────────── */

type IceServer = { urls: string | string[]; username?: string; credential?: string };
const STUN: IceServer = { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] };
let turnCache: { at: number; servers: IceServer[] } | null = null;

/**
 * STUN always; a TURN relay when one is configured.
 *
 * A browser on the office network reaches the switch directly. One
 * anywhere else is behind its own router and the switch is behind ours, and
 * for some pairs of routers no direct path exists — that is what a relay is
 * for. Cloudflare's TURN service mints short-lived credentials from a key
 * (CF_TURN_KEY_ID / CF_TURN_API_TOKEN), so nothing long-lived ever reaches
 * a browser. Without the key the softphone still works wherever a direct
 * path exists, and `relay` tells the UI which of the two it has.
 */
export async function iceServers(now = Date.now()): Promise<{ servers: IceServer[]; relay: boolean }> {
  const keyId = process.env.CF_TURN_KEY_ID, apiToken = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !apiToken) return { servers: [STUN], relay: false };
  if (turnCache && now - turnCache.at < 30 * 60_000) return { servers: turnCache.servers, relay: true };
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 4 * 3600 }),
        signal: AbortSignal.timeout(5000),
      });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j: any = await r.json();
    const servers: IceServer[] = Array.isArray(j?.iceServers) ? j.iceServers : [j?.iceServers].filter(Boolean);
    if (!servers.length) throw new Error("no iceServers in the reply");
    turnCache = { at: now, servers };
    return { servers, relay: true };
  } catch (e: any) {
    console.error("[softphone] TURN credentials unavailable:", e?.message || e);
    return { servers: [STUN], relay: false };
  }
}

/* ── The proxy ──────────────────────────────────────────────── */

const SEAT_GONE_MS = 20_000;
const MAX_PER_USER = 3;                      // tabs
const live = new Map<string, number>();      // userId -> open sockets

/** Is this person's browser phone connected right now? */
export function seatOnline(userId: string): boolean { return (live.get(userId) || 0) > 0; }

function reject(socket: Duplex, code: number, text: string) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Serve wss://<api>/softphone/ws?t=<access token>.
 *
 * A browser cannot set an Authorization header on a WebSocket, so the login
 * rides in the query string; `userFor` verifies it exactly as verifyJWT
 * does. The token is checked once, at the upgrade. Each client frame is
 * then held to refuseClientSip for the seat that login maps to; a refused
 * frame closes the connection — the softphone never sends one, so this is
 * someone poking.
 */
export function attachSoftphoneProxy(
  server: Server,
  userFor: (accessToken: string) => Promise<{ id: string } | null>,
  /** The seat's last browser connection has been gone for a while. */
  onSeatGone: (seat: string) => void = () => {},
): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    handleProtocols: (protocols) => (protocols.has("sip") ? "sip" : false),
  });

  server.on("upgrade", async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(req.url || "", "http://localhost"); } catch { return reject(socket, 400, "Bad Request"); }
    if (url.pathname !== SOFTPHONE_PATH) return reject(socket, 404, "Not Found");

    let user: { id: string } | null = null;
    try { user = await userFor(url.searchParams.get("t") || ""); } catch { user = null; }
    if (!user) return reject(socket, 401, "Unauthorized");
    let seat: string;
    try { seat = seatId(user.id); } catch { return reject(socket, 401, "Unauthorized"); }
    if ((live.get(user.id) || 0) >= MAX_PER_USER) return reject(socket, 429, "Too Many Connections");

    wss.handleUpgrade(req, socket, head, (client) => {
      const uid = user!.id;
      live.set(uid, (live.get(uid) || 0) + 1);
      console.log(`[softphone] ${seat} connected`);
      const localAddress = switchSourceAddress();
      const upstream = new WebSocket(FS_WS_URL, "sip", localAddress ? { localAddress } : {});
      const queue: string[] = [];
      let closed = false;
      const close = (code = 1000) => {
        if (closed) return;
        closed = true;
        console.log(`[softphone] ${seat} disconnected (${code})`);
        live.set(uid, Math.max(0, (live.get(uid) || 1) - 1));
        // A reload or a Wi-Fi blip reconnects within seconds and the call
        // keeps its audio meanwhile; a browser still absent after that is gone.
        setTimeout(() => { if (!seatOnline(uid)) onSeatGone(seat); }, SEAT_GONE_MS).unref();
        try { client.close(code); } catch { /* already gone */ }
        try { upstream.close(); } catch { /* already gone */ }
      };

      // The first line of each SIP message, both ways, for the first few of
      // a connection: enough to see where a phone that will not connect
      // stops, without logging a call's whole signalling.
      let secure = false;     // this browser says WSS in its Via
      let traced = 0;
      const trace = (dir: string, text: string) => {
        const first = text.slice(0, 200).split("\r\n")[0].replace(/sip:[^@\s]+@/g, "sip:…@");
        if (first.trim() && traced++ < 12) console.log(`[softphone] ${seat} ${dir} ${first}`);
      };
      client.on("message", (data, isBinary) => {
        const msg = isBinary ? "" : data.toString("utf8");
        trace(">", msg);
        const why = isBinary ? "binary frame" : refuseClientSip(msg, seat);
        if (why) {
          console.warn(`[softphone] refused a message from ${seat}: ${why}`);
          return close(1008);
        }
        const out = viaForSwitch(msg);
        if (out.changed) secure = true;
        if (upstream.readyState === WebSocket.OPEN) upstream.send(out.msg);
        else if (queue.length < 20) queue.push(out.msg);
        else close(1013);
      });
      upstream.on("open", () => { for (const m of queue.splice(0)) upstream.send(m); });
      upstream.on("message", (data, isBinary) => {
        trace("<", data.toString("utf8"));
        if (client.readyState !== WebSocket.OPEN) return;
        if (secure && !isBinary) client.send(viaForBrowser(data.toString("utf8")));
        else client.send(data, { binary: isBinary });
      });
      upstream.on("error", (e) => { console.error("[softphone] switch socket:", e.message); close(1011); });
      upstream.on("close", () => close(1011));
      client.on("error", () => close());
      client.on("close", () => close());
    });
  });
}
