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
 * Throws on ANY problem. The caller is expected to fall back to REST — a
 * slower voice is fine, a silent demo is not.
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
}

export function synthesizeWs(opts: WsTtsOpts): Promise<Buffer> {
  const {
    apiKey, text, languageCode,
    speaker = "priya", sampleRate = 22050, pace = 1.06, timeoutMs = 12_000,
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
        chunks.push(b.subarray(0, 4).toString() === "RIFF" ? b.subarray(44) : b);
        return;
      }
      if (m?.type === "error") {
        return finish(new Error(`sarvam ws: ${JSON.stringify(m).slice(0, 200)}`));
      }
      // Anything else is the completion event: synthesis is done.
      const pcm = Buffer.concat(chunks);
      if (!pcm.length) return finish(new Error("ws synthesis returned no audio"));
      finish(null, pcm16ToWav(pcm, sampleRate));
    });

    ws.on("error", (e: Error) => finish(e));
    ws.on("close", () => {
      // Closed before a completion event — salvage whatever arrived rather
      // than discarding a usable clip.
      if (settled) return;
      const pcm = Buffer.concat(chunks);
      pcm.length ? finish(null, pcm16ToWav(pcm, sampleRate))
                 : finish(new Error("ws closed before any audio"));
    });
  });
}
