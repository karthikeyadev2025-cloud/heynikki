/**
 * Sarvam bulbul:v3 over WebSocket.
 *
 * The website has always called Sarvam over REST, which has a floor of
 * roughly 700ms per request no matter how short the text. The voice pipeline
 * already talks to the same model over a WebSocket instead and measured 75ms
 * to first audio after a 195ms connect (see _synthesize_ws in
 * voice-pipeline/main.py) — same vendor, same model, same voice, different
 * transport.
 *
 * That REST floor is what justified only ever speaking the first sentence of
 * a reply on the site. Removing the floor removes the reason to truncate, so
 * this is the other half of that fix rather than a new feature.
 *
 * Chunks arrive as complete RIFF WAVs. Their PCM is concatenated and
 * re-wrapped into one clip, because the browser is handed a single base64
 * blob to decode.
 *
 * Throws on ANY problem, including a socket that closes before Sarvam's
 * completion event — the promise only resolves with a COMPLETE clip, which
 * is what makes its result safe to cache. The caller is expected to fall
 * back to REST — a slower voice is fine, a silent demo is not.
 */
import WebSocket from "ws";

const WS_URI =
  "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true";

/** Wrap raw 16-bit mono PCM in a RIFF/WAVE header. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);          // PCM fmt chunk size
  header.writeUInt16LE(1, 20);           // format = PCM
  header.writeUInt16LE(1, 22);           // channels = mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 16-bit)
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface WsTtsOpts {
  apiKey: string;
  text: string;
  languageCode: string;         // te-IN | hi-IN | en-IN
  speaker?: string;
  sampleRate?: number;
  pace?: number;
  timeoutMs?: number;
  /**
   * Called with each chunk as it arrives, already wrapped as a standalone
   * WAV so a browser can decodeAudioData it on its own. This is the whole
   * point of the socket: first chunk lands ~354ms in, the complete file
   * ~1932ms in, so anything that waits for the return value has thrown the
   * difference away.
   */
  onChunk?: (wav: Buffer, seq: number) => void;
}

export function synthesizeWs(opts: WsTtsOpts): Promise<Buffer> {
  const {
    apiKey, text, languageCode,
    speaker = "priya", sampleRate = 22050, pace = 1.06, timeoutMs = 12_000,
    onChunk,
  } = opts;

  return new Promise<Buffer>((resolve, reject) => {
    if (!apiKey) return reject(new Error("SARVAM_API_KEY not set"));
    if (!text.trim()) return reject(new Error("nothing to synthesise"));

    const chunks: Buffer[] = [];
    let settled = false;
    const ws = new WebSocket(WS_URI, { headers: { "Api-Subscription-Key": apiKey } });

    // One timer for the whole exchange. Without it a stalled socket would
    // hold the visitor's turn open until the outer request timeout.
    const timer = setTimeout(() => finish(new Error(`ws tts timeout after ${timeoutMs}ms`)), timeoutMs);

    function finish(err: Error | null, out?: Buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      err ? reject(err) : resolve(out!);
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "config", data: {
        target_language_code: languageCode,
        speaker,
        pace,
        speech_sample_rate: sampleRate,
        enable_preprocessing: true,
        output_audio_codec: "wav",
        min_buffer_size: 30,
        max_chunk_length: 120,
      }}));
      ws.send(JSON.stringify({ type: "text", data: { text } }));
      ws.send(JSON.stringify({ type: "flush" }));
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      let m: any;
      try { m = JSON.parse(raw.toString()); }
      catch { return; }                       // keepalive / non-JSON frame

      if (m?.type === "audio" && m?.data?.audio) {
        const b = Buffer.from(m.data.audio, "base64");
        // Each chunk is its own RIFF file; keep only the PCM payload.
        const pcmChunk = b.subarray(0, 4).toString() === "RIFF" ? b.subarray(44) : b;
        chunks.push(pcmChunk);
        if (onChunk) {
          // Re-wrap per chunk. A caller forwarding these onward needs each
          // one to stand alone; a bare PCM fragment is not decodable.
          try { onChunk(pcm16ToWav(pcmChunk, sampleRate), chunks.length - 1); }
          catch { /* a failing consumer must not abort synthesis */ }
        }
        return;
      }
      if (m?.type === "error") {
        return finish(new Error(`sarvam ws: ${JSON.stringify(m).slice(0, 200)}`));
      }
      // Only the completion event means synthesis is done:
      //   {"type":"event","data":{"event_type":"final"}}
      // This used to treat ANY other JSON frame as completion, so an
      // informational or keepalive frame arriving between audio chunks ended
      // the clip early — and the truncated reply was then cached in
      // webTtsCache and replayed, cut short, to every later visitor who got
      // the same answer.
      const ev = String(m?.data?.event_type ?? m?.event_type ?? "").toLowerCase();
      if (m?.type === "event" && (!ev || ["final", "complete", "completed", "done"].includes(ev))) {
        const pcm = Buffer.concat(chunks);
        if (!pcm.length) return finish(new Error("ws synthesis returned no audio"));
        return finish(null, pcm16ToWav(pcm, sampleRate));
      }
      // Anything else is not ours to interpret; keep waiting (the timer
      // bounds it). Logged, because an unrecognised terminal event would
      // show up here as a 12s stall before the REST fallback.
      console.warn(`[sarvam-ws] ignoring frame: ${JSON.stringify(m).slice(0, 160)}`);
    });

    ws.on("error", (e: Error) => finish(e));
    ws.on("close", () => {
      // Closed before the completion event: the clip is incomplete, however
      // much arrived. It used to be salvaged and returned as a success,
      // which is a reply with its ending missing — and a cached one. Failing
      // lets the caller fall back to REST, which returns a whole clip or
      // nothing. A streaming caller has already forwarded the chunks it got
      // and knows not to repeat them.
      if (settled) return;
      finish(new Error(chunks.length
        ? `ws closed before completion (${chunks.length} chunk(s) received)`
        : "ws closed before any audio"));
    });
  });
}
