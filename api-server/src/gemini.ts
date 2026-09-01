/**
 * One place for calling Gemini, because every call site had written the
 * same single-shot fetch with no retry.
 *
 * A customer hit this today: POST /api/agents/draft returned 500 with the
 * body "Internal error", losing the business description they had just
 * typed. The cause was one aborted request — measured from the same
 * container immediately afterwards, the identical call returns in about
 * 800ms, so the model was not slow, it stalled once. A single transient
 * stall should never be a dead end for a person who is mid-signup.
 *
 * Retries are safe here specifically because generation is a read: nothing
 * is written, so re-issuing cannot double-apply anything.
 */

// Deliberately a flat shape rather than a discriminated union: callers read
// gen.ok then gen.data or gen.detail, and a union bought nothing but
// narrowing friction at every call site.
export interface GenResult {
  ok: boolean;
  data: any;
  timedOut: boolean;
  status: number;
  detail: string;
}
const fail = (status: number, detail: string, timedOut = false): GenResult =>
  ({ ok: false, data: null, timedOut, status, detail });

export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

// GEMINI_MODEL is an operator setting and any value not listed here is used
// as given. These are refused because each is a CALLER-VISIBLE FAULT rather
// than a preference: the "thinking" tiers bill reasoning tokens against
// maxOutputTokens, so replies arrive cut off mid-word, and the retired ids
// simply error. Measured against this account on 2026-09-01 — the table is
// in voice-pipeline/main.py GeminiLLM.base_url. Keep the two in step.
const GEMINI_REFUSED: Record<string, string> = {
  "gemini-flash-latest":     "thinks before answering — replies truncated mid-word; 1.91s p50 TTFT vs 0.86s",
  "gemini-3.5-flash":        "same truncation; 2.43s p50 TTFT",
  "gemini-3.6-flash":        "same truncation; 2.01s p50 TTFT",
  "gemini-3.7-flash":        "leaked prompt text into a reply and returned nothing on another turn",
  "gemini-2.5-flash":        "retired — the API answers 'no longer supported'",
  "gemini-2.5-flash-lite":   "retired",
  "gemini-2.0-flash-exp":    "retired — 404",
  "gemini-1.5-flash":        "retired",
  "gemini-1.5-flash-latest": "retired",
};

let warnedModel = "";

/** The model to call, with a known-broken GEMINI_MODEL refused. */
export function resolveGeminiModel(): string {
  const want = (process.env.GEMINI_MODEL || "").trim();
  if (!want) return GEMINI_DEFAULT_MODEL;
  const why = GEMINI_REFUSED[want];
  if (why) {
    // Once per distinct value: this is called per request in places, and a
    // line on every turn would bury everything else in the log.
    if (warnedModel !== want) {
      warnedModel = want;
      console.error(
        `[gemini] GEMINI_MODEL=${want} REFUSED: ${why}. ` +
        `Falling back to ${GEMINI_DEFAULT_MODEL}. ` +
        `Unset or correct the environment variable to silence this.`);
    }
    return GEMINI_DEFAULT_MODEL;
  }
  return want;
}

const MODEL = () => resolveGeminiModel();

export async function geminiGenerate(
  body: object,
  opts: { timeoutMs?: number; attempts?: number } = {},
): Promise<GenResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(503, "GEMINI_API_KEY not set");

  const timeoutMs = opts.timeoutMs ?? 25_000;
  const attempts  = opts.attempts ?? 2;
  let last: GenResult = fail(0, "no attempt made");

  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });

      if (r.ok) {
        const j: any = await r.json();
        const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        // The model is asked for JSON, but a stray prose wrapper is common
        // enough that pulling the first object out is worth the two lines.
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) { last = fail(502, "no JSON in response"); }
        else {
          try { return { ok: true, data: JSON.parse(m[0]), timedOut: false, status: 200, detail: "" }; }
          catch { last = fail(502, "unparseable JSON"); }
        }
      } else {
        last = fail(r.status, (await r.text()).slice(0, 200));
        // 4xx other than rate limiting is our fault and will fail identically
        // on a retry — a bad key or a malformed body does not heal.
        if (r.status < 500 && r.status !== 429) return last;
      }
    } catch (e: any) {
      last = fail(504, e?.message || "fetch failed", /abort|timeout/i.test(e?.message || ""));
    }
    if (i < attempts) {
      console.warn(`[gemini] attempt ${i} failed (${last.detail}) — retrying`);
      await new Promise(r => setTimeout(r, 600 * i));
    }
  }
  return last;
}
