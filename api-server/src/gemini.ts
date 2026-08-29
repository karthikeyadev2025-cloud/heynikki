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

const MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

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
