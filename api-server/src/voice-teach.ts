/**
 * Teaching Nikki by voice, from the phone.
 *
 * In the dashboard a spoken fact is saved at once: the owner can see what was
 * written and delete it. On the phone there is no screen, and what she saves
 * is repeated to customers on live calls — so a misheard price must not get
 * there on its own. She reads the fact back and saves it only on a spoken
 * yes. The fact waits here, per phone, for two minutes.
 */
export type Lang = "te" | "hi" | "en";

export function replyLang(text: string): Lang {
  if (/[ఀ-౿]/.test(text)) return "te";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  return "en";
}

const NO_WORDS  = ["no", "nope", "nah", "dont", "don't", "not", "cancel", "wrong", "stop", "vaddu", "oddu", "kadu", "kaadu", "nahi", "nahin", "mat"];
const NO_PARTS  = ["వద్దు", "ఒద్దు", "కాదు", "లేదు", "క్యాన్సిల్", "రద్దు", "नहीं", "मत ", "गलत", "रद्द"];
const YES_WORDS = ["yes", "yeah", "yep", "ya", "yaa", "ok", "okay", "save", "correct", "right", "sure", "fine", "haan", "ha", "avunu", "sare", "ji", "theek"];
const YES_PARTS = ["అవును", "ఔను", "సరే", "సేవ్", "చెయ్యి", "చేయండి", "చేసేయ్", "కరెక్ట్", "హా", "ఓకే", "हाँ", "हां", "जी", "ठीक", "सही", "सेव", "कर दो", "ओके"];

/** A short spoken answer to "shall I save it?". Anything longer than a few
 *  words is a new question, not an answer, and is left alone. A refusal wins
 *  over an agreement: "సేవ్ చేయవద్దు" contains both. */
export function parseYesNo(transcript: string): "yes" | "no" | null {
  const t = String(transcript || "").toLowerCase().replace(/[.,!?।"“”]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const words = t.split(" ");
  if (words.length > 6) return null;
  if (words.some(w => NO_WORDS.includes(w)) || NO_PARTS.some(p => (t + " ").includes(p))) return "no";
  if (words.some(w => YES_WORDS.includes(w)) || YES_PARTS.some(p => t.includes(p))) return "yes";
  return null;
}

/** What the model asked for: a fact to keep, or the last one to drop. */
export function extractTeach(answer: string): { fact?: string; forget?: boolean; rest: string } {
  const a = String(answer || "");
  const f = a.match(/^\s*FORGET_LAST\b.*$/im);
  if (f) return { forget: true, rest: a.replace(f[0], "").trim() };
  const m = a.match(/^\s*REMEMBER:\s*(.+)$/im);
  if (!m) return { rest: a.trim() };
  const fact = m[1].trim().slice(0, 500);
  const rest = a.replace(m[0], "").trim();
  return fact.length < 8 ? { rest: rest || a.trim() } : { fact, rest };
}

export const PENDING_TTL_MS = 120_000;

export class PendingFacts {
  private m = new Map<string, { fact: string; at: number }>();
  set(key: string, fact: string, now = Date.now()) {
    for (const [k, v] of this.m) if (now - v.at > PENDING_TTL_MS) this.m.delete(k);
    this.m.set(key, { fact, at: now });
  }
  /** The fact waiting on this phone, removed as it is read — one answer each. */
  take(key: string, now = Date.now()): string | null {
    const v = this.m.get(key);
    if (!v) return null;
    this.m.delete(key);
    return now - v.at > PENDING_TTL_MS ? null : v.fact;
  }
}

const withStop = (s: string) => /[.!?।]$/.test(s) ? s : s + ".";

export const teachSay = {
  confirm: (fact: string, l: Lang) => l === "te"
    ? `కాలర్స్‌కి ఇలా చెప్తాను: ${withStop(fact)} సేవ్ చేయమంటారా? అవును లేదా వద్దు అని చెప్పండి.`
    : l === "hi" ? `मैं कॉलर्स को यह बताऊँगी: ${withStop(fact)} सेव कर दूँ? हाँ या नहीं बोलिए।`
    : `I will tell callers this: ${withStop(fact)} Shall I save it? Say yes or no.`,
  saved: (l: Lang) => l === "te" ? "సేవ్ చేశాను. ఇకపై కాలర్స్‌కి ఇదే చెప్తాను."
    : l === "hi" ? "सेव कर दिया। अब से कॉलर्स को यही बताऊँगी।"
    : "Saved. I will tell callers that from now on.",
  failed: (l: Lang) => l === "te" ? "క్షమించండి, సేవ్ చేయలేకపోయాను. డాష్‌బోర్డ్‌లో Teach Nikki లో చేర్చండి."
    : l === "hi" ? "माफ़ कीजिए, सेव नहीं हो पाया। डैशबोर्ड में Teach Nikki में जोड़ दीजिए।"
    : "Sorry, I could not save that. Please add it under Teach Nikki in the dashboard.",
  dropped: (l: Lang) => l === "te" ? "సరే, సేవ్ చేయలేదు."
    : l === "hi" ? "ठीक है, सेव नहीं किया।"
    : "Okay, I have not saved it.",
  forgot: (fact: string, l: Lang) => l === "te" ? `తీసేశాను: ${withStop(fact)}`
    : l === "hi" ? `हटा दिया: ${withStop(fact)}`
    : `Removed: ${withStop(fact)}`,
  nothingToForget: (l: Lang) => l === "te" ? "మీరు వాయిస్ ద్వారా నేర్పినది ఏదీ లేదు."
    : l === "hi" ? "आपने आवाज़ से कुछ सिखाया नहीं है।"
    : "There is nothing you taught me by voice to remove.",
};
