// lib/softphone.ts — the browser as the telecaller's phone.
//
// One instance per tab, outside React: a call must survive a re-render, and
// two components must never own two phones. The Desk subscribes to it.
//
// What it does
//   - connects to the API's softphone socket with the current login and
//     registers this seat, so an incoming call can ring here;
//   - places a call the API has already authorised (it is handed a one-time
//     target, never a phone number — see api-server/src/softphone.ts);
//   - answers, mutes, holds, sends keypad tones, hangs up.
//
// What it deliberately does not do
//   - dial numbers. The API decides who may be called and as whom; a page
//     script cannot.
//   - keep a long-lived socket URL. The login token in it expires within the
//     hour, so every (re)connection builds a new one from a fresh token.
import {
  Invitation, Inviter, Registerer, RegistererState, Session, SessionState, UserAgent,
} from "sip.js";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

export type PhoneStatus =
  | "off"          // not started (the seat is using their mobile)
  | "connecting"
  | "ready"        // registered: can call, can be rung
  | "no_mic"       // the browser was refused the microphone
  | "offline";     // lost the connection; retrying

export type PhoneCall =
  | { state: "none" }
  | { state: "incoming"; from: string }
  | { state: "calling" }                               // outbound, not yet answered by the switch
  | { state: "active"; dir: "in" | "out"; since: number; from?: string };

export type PhoneSnapshot = {
  status: PhoneStatus;
  call: PhoneCall;
  muted: boolean;
  held: boolean;
  relay: boolean;      // a TURN relay is configured (calls work from any network)
  quality: "good" | "fair" | "poor" | null;
  error: string;
};

type Config = {
  seat: string; domain: string; ws_path: string;
  ice_servers: RTCIceServer[]; relay: boolean;
};

const AUDIO: MediaTrackConstraints = {
  echoCancellation: true, noiseSuppression: true, autoGainControl: true,
};

class Softphone {
  private snap: PhoneSnapshot = {
    status: "off", call: { state: "none" }, muted: false, held: false,
    relay: false, quality: null, error: "",
  };
  private subs = new Set<(s: PhoneSnapshot) => void>();
  private ua: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private session: Session | null = null;
  private getToken: (() => Promise<string>) | null = null;
  private cfg: Config | null = null;
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 2000;
  // Bumped by every connect(). A socket or registration from an earlier
  // attempt must not be able to schedule or cancel anything: each one that
  // did left a second connection open, until the server refused the fourth.
  private gen = 0;
  private connecting = false;
  private audio: HTMLAudioElement | null = null;
  private ring: { ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  /* ── state ── */
  get(): PhoneSnapshot { return this.snap; }
  subscribe(fn: (s: PhoneSnapshot) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }
  private set(p: Partial<PhoneSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.subs.forEach(fn => fn(this.snap));
  }

  /* ── lifecycle ── */

  /** Turn the phone on. Asks for the microphone, so call it from a click. */
  async start(getToken: () => Promise<string>): Promise<void> {
    this.getToken = getToken;
    this.wanted = true;
    if (this.snap.status === "ready" || this.snap.status === "connecting") return;
    this.set({ status: "connecting", error: "" });
    // Ask once, up front. A call that discovers a blocked microphone when the
    // customer is already ringing is the worst moment to find out.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
      s.getTracks().forEach(t => t.stop());
    } catch {
      this.wanted = false;
      this.set({ status: "no_mic", error: "This browser is not allowed to use the microphone. Allow it in the address bar, then turn the phone on again." });
      return;
    }
    await this.connect();
  }

  /** Turn the phone off (the seat is switching to their mobile, or leaving). */
  async stop(): Promise<void> {
    this.wanted = false;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.stopRing();
    try { await this.hangup(); } catch { /* nothing to end */ }
    await this.teardown();
    this.set({ status: "off", call: { state: "none" }, muted: false, held: false, quality: null, error: "" });
  }

  private async teardown() {
    const ua = this.ua, reg = this.registerer;
    this.ua = null; this.registerer = null;
    try { if (reg && reg.state === RegistererState.Registered) await reg.unregister(); } catch { /* socket may be gone */ }
    try { await ua?.stop(); } catch { /* already stopped */ }
  }

  private scheduleReconnect() {
    if (!this.wanted || this.retry) return;
    this.set({ status: "offline" });
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect().catch(() => { /* connect() schedules the next try itself */ });
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  private async connect(): Promise<void> {
    if (!this.wanted || !this.getToken || this.connecting) return;
    this.connecting = true;
    const gen = ++this.gen;
    await this.teardown();
    // Which step failed is what tells a seat (and us) what to fix.
    let step = "sign-in";
    try {
      const token = await this.getToken();
      if (!token) throw new Error("signed out");
      step = "settings";
      const r = await fetch(`${API}/api/desk/softphone/config`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`settings ${r.status}`);
      const cfg: Config = await r.json();
      this.cfg = cfg;

      const uri = UserAgent.makeURI(`sip:${cfg.seat}@${cfg.domain}`);
      if (!uri) throw new Error("bad seat address");
      const wsBase = API.replace(/^http/, "ws");
      const ua = new UserAgent({
        uri,
        transportOptions: { server: `${wsBase}${cfg.ws_path}?t=${encodeURIComponent(token)}`, keepAliveInterval: 25 },
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: { iceServers: cfg.ice_servers },
          // Do not hold the INVITE waiting for every candidate: two seconds
          // is enough to gather a relay, and silence is what a seat hears.
          iceGatheringTimeout: 2000,
        },
        logLevel: "error",
        delegate: {
          onInvite: (inv) => this.onIncoming(inv),
          onDisconnect: () => {
            // The socket dropped (Wi-Fi, laptop lid, an hour-old login). A
            // call in progress keeps its audio — media does not ride this
            // socket — so only the signalling is rebuilt.
            if (this.wanted && gen === this.gen) this.scheduleReconnect();
          },
        },
      });
      this.ua = ua;
      step = "connection";
      await ua.start();
      step = "registration";
      const reg = new Registerer(ua, { expires: 300 });
      this.registerer = reg;
      reg.stateChange.addListener((s) => {
        if (this.registerer !== reg || gen !== this.gen) return;
        if (s === RegistererState.Registered) { this.retryMs = 2000; this.set({ status: "ready", relay: cfg.relay, error: "" }); }
        if (s === RegistererState.Unregistered && this.wanted && this.snap.status === "ready") this.scheduleReconnect();
      });
      // An unanswered REGISTER used to leave the phone "connecting" for good.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("no answer in 10 seconds")), 10_000);
        reg.stateChange.addListener((s) => { if (s === RegistererState.Registered) { clearTimeout(t); resolve(); } });
        reg.register({ requestDelegate: { onReject: (r) => { clearTimeout(t); reject(new Error(`refused ${r.message.statusCode}`)); } } })
          .catch((e) => { clearTimeout(t); reject(e); });
      });
      this.connecting = false;
    } catch (e: any) {
      this.connecting = false;
      if (!this.wanted || gen !== this.gen) return;
      console.warn(`[desk phone] ${step} failed:`, e?.message || e);
      this.set({ error: step === "sign-in" ? "Your login has expired. Refresh the page and sign in again."
        : `Can't reach the phone service (${step} failed). Retrying…` });
      this.scheduleReconnect();
    }
  }

  /* ── calls ── */

  private attach(session: Session, dir: "in" | "out", from?: string) {
    this.session = session;
    session.stateChange.addListener((s) => {
      if (this.session !== session) return;
      if (s === SessionState.Established) {
        this.stopRing();
        this.playRemote(session);
        this.set({ call: { state: "active", dir, since: Date.now(), from }, muted: false, held: false, error: "" });
        this.watchQuality(session);
        this.watchAudioPath(session);
      }
      if (s === SessionState.Terminated) {
        this.stopRing();
        this.session = null;
        if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
        if (this.audio) this.audio.srcObject = null;
        this.set({ call: { state: "none" }, muted: false, held: false, quality: null });
      }
    });
  }

  private pc(session: Session): RTCPeerConnection | null {
    return (session.sessionDescriptionHandler as any)?.peerConnection || null;
  }

  private playRemote(session: Session) {
    const pc = this.pc(session);
    if (!pc) return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.autoplay = true;
    }
    const stream = new MediaStream();
    pc.getReceivers().forEach(r => { if (r.track) stream.addTrack(r.track); });
    this.audio.srcObject = stream;
    this.audio.play().catch(() => { /* resumed by the next click */ });
  }

  /** Ends a call whose audio never connects. Signalling and audio take
   *  different routes, so a call can be "answered" with no sound either way:
   *  on 13 Oct four customers were rung and picked up to silence while the
   *  Desk showed a normal call. Seven seconds is before most people answer. */
  private watchAudioPath(session: Session) {
    const pc = this.pc(session);
    if (!pc) return;
    const fail = () => {
      if (this.session !== session) return;
      console.warn("[desk phone] no audio path:", pc.connectionState, pc.iceConnectionState);
      this.hangup().catch(() => {}).finally(() => this.set({
        error: "Call ended: this computer and the phone service could not exchange audio. Try again, or switch to \"My mobile\".",
      }));
    };
    const t = setTimeout(() => { if (pc.connectionState !== "connected") fail(); }, 7000);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") clearTimeout(t);
      if (pc.connectionState === "failed") { clearTimeout(t); fail(); }
    });
    if (pc.connectionState === "connected") clearTimeout(t);
  }

  /** A rough line-quality reading from packet loss and jitter, every 3 s. */
  private watchQuality(session: Session) {
    if (this.statsTimer) clearInterval(this.statsTimer);
    let last = { recv: 0, lost: 0 };
    this.statsTimer = setInterval(async () => {
      const pc = this.pc(session);
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        stats.forEach((r: any) => {
          if (r.type !== "inbound-rtp" || r.kind !== "audio") return;
          const recv = r.packetsReceived - last.recv, lost = r.packetsLost - last.lost;
          last = { recv: r.packetsReceived, lost: r.packetsLost };
          const loss = recv + lost > 0 ? lost / (recv + lost) : 0;
          const jitterMs = (r.jitter || 0) * 1000;
          const q = recv === 0 || loss > 0.08 || jitterMs > 60 ? "poor"
                  : loss > 0.02 || jitterMs > 30 ? "fair" : "good";
          if (q !== this.snap.quality) this.set({ quality: q });
        });
      } catch { /* the call ended between ticks */ }
    }, 3000);
  }

  private onIncoming(inv: Invitation) {
    // One call at a time: a seat already talking is busy to the next caller,
    // and the ring group moves on to someone else.
    if (this.session) { inv.reject({ statusCode: 486 }).catch(() => {}); return; }
    const from = String(inv.remoteIdentity.uri.user || "").replace(/\D/g, "").slice(-10);
    this.attach(inv, "in", from);
    this.set({ call: { state: "incoming", from } });
    this.startRing();
  }

  /** Place a call the API authorised. `target` is the one-time value it returned. */
  async call(target: string): Promise<void> {
    if (!this.ua || !this.cfg || this.snap.status !== "ready") throw new Error("The phone is not connected yet.");
    if (this.session) throw new Error("You are already on a call.");
    const uri = UserAgent.makeURI(`sip:${target}@${this.cfg.domain}`);
    if (!uri) throw new Error("Could not start the call.");
    const inv = new Inviter(this.ua, uri, {
      sessionDescriptionHandlerOptions: { constraints: { audio: AUDIO, video: false } },
    });
    this.attach(inv, "out");
    this.set({ call: { state: "calling" } });
    try {
      await inv.invite();
    } catch (e: any) {
      this.session = null;
      this.set({ call: { state: "none" } });
      throw new Error(/Permission|NotAllowed/i.test(String(e?.message)) ? "The microphone is blocked in this browser." : "Could not start the call.");
    }
  }

  /** Hear a tone and your own voice: checks the headset without calling anyone. */
  selfTest(): Promise<void> { return this.call("selftest"); }

  async answer(): Promise<void> {
    const s = this.session;
    if (!(s instanceof Invitation) || s.state !== SessionState.Initial) return;
    this.stopRing();
    try {
      await s.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: AUDIO, video: false } } });
    } catch {
      this.session = null;
      this.set({ call: { state: "none" }, error: "Couldn't answer — the caller may have hung up." });
    }
  }

  async hangup(): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.stopRing();
    try {
      if (s.state === SessionState.Established) await s.bye();
      else if (s instanceof Inviter && (s.state === SessionState.Initial || s.state === SessionState.Establishing)) await s.cancel();
      else if (s instanceof Invitation && s.state === SessionState.Initial) await s.reject({ statusCode: 486 });
    } catch { /* already over */ }
    // Tell the server as well: a leg that outlives the BYE keeps ringing
    // the customer, and the Desk goes on showing a call that was cut.
    try {
      const token = await this.getToken?.();
      if (token) await fetch(`${API}/api/desk/softphone/hangup`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch { /* the server ends an abandoned leg by itself */ }
  }

  setMuted(muted: boolean) {
    const pc = this.session && this.pc(this.session);
    if (!pc) return;
    pc.getSenders().forEach(s => { if (s.track) s.track.enabled = !muted; });
    this.set({ muted });
  }

  /** Hold: stop sending and stop playing, without a re-INVITE to renegotiate. */
  setHeld(held: boolean) {
    const pc = this.session && this.pc(this.session);
    if (!pc) return;
    pc.getSenders().forEach(s => { if (s.track) s.track.enabled = !held && !this.snap.muted; });
    pc.getReceivers().forEach(r => { if (r.track) r.track.enabled = !held; });
    this.set({ held });
  }

  /** Keypad tones during a call (bank IVRs, extensions). */
  sendDigit(d: string) {
    if (!/^[0-9*#]$/.test(d)) return;
    const pc = this.session && this.pc(this.session);
    const sender = pc?.getSenders().find(s => s.track?.kind === "audio");
    try { sender?.dtmf?.insertDTMF(d, 160, 70); } catch { /* not on a call */ }
  }

  /* ── ringtone: two short tones, the Indian ringback cadence ── */
  private startRing() {
    this.stopRing();
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      const beep = () => {
        [0, 0.6].forEach(at => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.value = 440; o.connect(g); g.connect(ctx.destination);
          g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
          g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.4);
          o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.42);
        });
      };
      beep();
      this.ring = { ctx, timer: setInterval(beep, 3000) };
    } catch { /* a silent ring still shows on screen */ }
  }
  private stopRing() {
    if (!this.ring) return;
    clearInterval(this.ring.timer);
    this.ring.ctx.close().catch(() => {});
    this.ring = null;
  }
}

let instance: Softphone | null = null;
/** The tab's one phone. */
export function softphone(): Softphone {
  if (!instance) instance = new Softphone();
  return instance;
}

/* ── which phone this seat uses ── */
const MODE_KEY = "nikki_desk_phone";
export type PhoneMode = "browser" | "mobile";
export function savedPhoneMode(): PhoneMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "browser" || v === "mobile" ? v : null;
  } catch { return null; }
}
export function savePhoneMode(m: PhoneMode) {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* private window */ }
}
