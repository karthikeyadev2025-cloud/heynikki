/**
 * What the Desk keeps from a call so that the next one goes better.
 *
 * Nine days of one business's calls (23 Sep – 1 Oct, 507 of them) showed
 * where the learning was leaking away:
 *
 *   - 34 of the 46 numbers that said "interested" or "call me back" were
 *     never rung again. Only "call back" with a spoken time booked a
 *     follow-up; "interested" booked none at all.
 *   - The daily insights suggested "Do you build websites?" on five days,
 *     four of them after the owner had already taught Nikki the answer.
 *   - Nothing of what was actually said survived the call — only two
 *     sentences of summary — so nobody could ask "which kind of business
 *     says yes" or "what did the telecaller say on the calls that worked".
 *
 * Everything here is arithmetic on rows, kept apart from the routes so it
 * can be tested without a database or a model.
 */

const IST_MS = 5.5 * 3600_000;

/** ISO time for hh:mm IST, `addDays` after the IST day `nowMs` falls in. */
function istAt(nowMs: number, addDays: number, hh: number, mm: number): number {
  const ist = new Date(nowMs + IST_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + addDays, hh, mm) - IST_MS;
}

/** The next day the Desk works: tomorrow, or Monday when tomorrow is Sunday. */
function nextWorkingDay(nowMs: number, hh: number, mm: number): number {
  const t = istAt(nowMs, 1, hh, mm);
  return new Date(t + IST_MS).getUTCDay() === 0 ? istAt(nowMs, 2, hh, mm) : t;
}

/**
 * When to ring this customer again.
 *
 * A time the customer named always wins. Without one, "call me later" said
 * before 2 pm means this afternoon at four — the hour that answered best —
 * and otherwise the next working morning; "interested" gets the next
 * working morning, so the details sent on WhatsApp have been seen. Other
 * outcomes book nothing. `explicit` tells the caller whether the customer
 * chose the time, because a guessed time must not replace a promised one.
 */
export function followUpFor(disposition: string, followUpAt: string | null | undefined, nowMs: number):
  { at: string; explicit: boolean } | null {
  if (disposition !== "callback" && disposition !== "interested") return null;
  const given = followUpAt ? new Date(followUpAt).getTime() : NaN;
  if (!isNaN(given) && given > nowMs) return { at: new Date(given).toISOString(), explicit: true };
  const istHour = new Date(nowMs + IST_MS).getUTCHours();
  const at = disposition === "callback" && istHour < 14 ? istAt(nowMs, 0, 16, 0) : nextWorkingDay(nowMs, 11, 30);
  return { at: new Date(at).toISOString(), explicit: false };
}

// ── What one call said ────────────────────────────────────────────────

export type Turn = { who: "agent" | "customer"; text: string };
export type Facts = {
  business_type?: string;      // "hospital", "hotel", "school" … lower case, one or two words
  speaker?: "owner" | "employee" | "unknown";
  has_website?: "yes" | "no" | "unknown";
  pitched?: string[];
  price_quoted?: string;
  objection?: string;
  questions?: string[];
  next_step?: string;
  skipped?: string;            // set when the recording could not be read, so it is not tried again
};

const str = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const strs = (v: unknown, max: number, n: number) =>
  (Array.isArray(v) ? v : []).map(x => str(x, n)).filter(Boolean).slice(0, max);
const NONE = /^(none|null|n\/?a|unknown|not (mentioned|stated|applicable|discussed))?\.?$/i;

/** What the model is asked of a call recording: summary, outcome, facts and the call as spoken. */
export function listenPrompt(nowMs: number): string {
  const nowIst = new Date(nowMs + IST_MS).toISOString().slice(0, 16).replace("T", " ");
  return (
    "This is a recording of a business telecaller's phone call with a customer in India " +
    "(Telugu, Hindi or English, often mixed). Reply with JSON only:\n" +
    '{"summary": "<two short sentences in English: what the customer wants and what was agreed>",\n' +
    ' "disposition": "booked" | "interested" | "callback" | "not_interested" | "no_answer",\n' +
    ' "follow_up_at": "<ISO 8601 with +05:30 if a callback time was agreed, else null>",\n' +
    ' "facts": {"business_type": "<the customer\'s kind of business in one or two English words, e.g. hospital, hotel, school, or null>",\n' +
    '   "speaker": "owner" | "employee" | "unknown",\n' +
    '   "has_website": "yes" | "no" | "unknown",\n' +
    '   "pitched": ["<each product or service the telecaller offered>"],\n' +
    '   "price_quoted": "<any price the telecaller said, else null>",\n' +
    '   "objection": "<the customer\'s main reason for saying no or not now, in a few English words, else null>",\n' +
    '   "questions": ["<each question the customer asked, in English>"],\n' +
    '   "next_step": "<what was agreed to happen next, else null>"},\n' +
    ' "transcript": [{"who": "agent" | "customer", "text": "<what was said, in the language and script it was said in>"}]}\n' +
    "In the transcript the agent is the telecaller — the one who names the company and offers its services; " +
    "the customer is the one who was rung. Keep it to what was actually said, at most 80 turns, and leave " +
    "out ringing, caller tunes, hold music and network messages. Write Telugu in Telugu script, Hindi in " +
    "Devanagari and English words in Latin letters; never any other script.\n" +
    "Facts come only from the call: null or \"unknown\" when it was not said. \"questions\" are the " +
    "CUSTOMER's questions only, translated to English — never the telecaller's.\n" +
    `The time now is ${nowIst} IST. Choose the disposition from what the CUSTOMER did, not ` +
    `from what the telecaller offered:\n` +
    `- "booked": a specific appointment, meeting or visit was fixed — including an executive ` +
    `visiting the customer on a named day.\n` +
    `- "interested": the customer asked for details, a price, a demo or the brochure, or agreed ` +
    `to a next step (details sent to them, a visit, a follow-up call).\n` +
    `- "callback": the customer asked to be called later, or said they would call back.\n` +
    `- "not_interested": the customer declined, said they have no need, or only listened and ` +
    `neither asked for anything nor agreed to anything. Listening politely, "ok" or "hmm" is ` +
    `NOT interest.\n` +
    `- "no_answer": nobody really spoke (ringing, voicemail, a network message, silence).\n` +
    `If you are unsure between "interested" and "not_interested", choose "not_interested". ` +
    `Never invent a callback time.`
  );
}

// Said by whoever placed the call: "calling from …", "… company nunchi".
const CALLER_LINE = /calling from|call (chest|kar)|technolog|software company|కంపెనీ నుం[చడ]ి|टेक्नोलॉजी|కాల్ చేస్తున్న/i;

/**
 * The model's transcript, held to the shape the Desk stores.
 *
 * The model hears two voices well and names them badly: on two of three
 * real calls it labelled whoever said "hello" first — the customer — as
 * the agent. The telecaller is the one who says where they are calling
 * from, so when those lines sit on the "customer" side the labels are
 * swapped.
 */
export function cleanTranscript(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw.map((t: any): Turn => ({
    who: /agent|caller|telecaller|executive/i.test(String(t?.who || t?.speaker || "")) ? "agent" : "customer",
    text: str(t?.text, 600),
  })).filter(t => t.text).slice(0, 120);
  const hits = (who: Turn["who"]) => turns.filter(t => t.who === who && CALLER_LINE.test(t.text)).length;
  if (hits("customer") > hits("agent")) {
    for (const t of turns) t.who = t.who === "agent" ? "customer" : "agent";
  }
  return turns;
}

/** The model's facts about a call, with every "none"/"unknown" dropped. */
export function cleanFacts(raw: any): Facts {
  const f: Facts = {};
  if (!raw || typeof raw !== "object") return f;
  const bt = str(raw.business_type, 40).toLowerCase();
  if (bt && !NONE.test(bt)) f.business_type = bt;
  if (raw.speaker === "owner" || raw.speaker === "employee") f.speaker = raw.speaker;
  if (raw.has_website === "yes" || raw.has_website === "no") f.has_website = raw.has_website;
  const pitched = strs(raw.pitched, 5, 60); if (pitched.length) f.pitched = pitched;
  const questions = strs(raw.questions, 4, 160); if (questions.length) f.questions = questions;
  for (const k of ["price_quoted", "objection", "next_step"] as const) {
    const v = str(raw[k], 200);
    if (v && !NONE.test(v)) f[k] = v;
  }
  return f;
}

// ── What the calls say together ───────────────────────────────────────

const POSITIVE = new Set(["booked", "interested", "callback"]);

type Row = {
  created_at: string; duration_seconds?: number | null; disposition?: string | null;
  customer_answered_at?: string | null; callee_number?: string | null; ai_facts?: Facts | null;
};
export type Patterns = {
  days: number;
  segments: { name: string; talked: number; positive: number }[];
  hours: { hour: number; calls: number; answered: number; positive: number }[];
  objections: { text: string; count: number }[];
  never_called_again: number;
};

/**
 * Counted, not asked of a model: which kinds of business say yes, which
 * hours answer, which objections recur, and how many customers who showed
 * interest were rung only once. A segment or hour needs a handful of calls
 * before it is shown — two calls to hotels is an anecdote.
 */
export function patterns(rows: Row[], conversationSecs: number, days: number): Patterns {
  const seg = new Map<string, { talked: number; positive: number }>();
  const hrs = new Map<number, { calls: number; answered: number; positive: number }>();
  const obj = new Map<string, number>();
  const dials = new Map<string, number>();
  const warm = new Set<string>();
  for (const r of rows) {
    const pos = POSITIVE.has(String(r.disposition));
    const talked = (r.duration_seconds || 0) >= conversationSecs;
    const hour = new Date(new Date(r.created_at).getTime() + IST_MS).getUTCHours();
    const h = hrs.get(hour) || { calls: 0, answered: 0, positive: 0 };
    h.calls += 1; if (r.customer_answered_at) h.answered += 1; if (pos) h.positive += 1;
    hrs.set(hour, h);
    if (r.callee_number) {
      dials.set(r.callee_number, (dials.get(r.callee_number) || 0) + 1);
      if (pos) warm.add(r.callee_number);
    }
    const f = r.ai_facts;
    if (talked && f?.business_type) {
      const s = seg.get(f.business_type) || { talked: 0, positive: 0 };
      s.talked += 1; if (pos) s.positive += 1;
      seg.set(f.business_type, s);
    }
    if (talked && f?.objection) {
      const k = f.objection.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (k) obj.set(k, (obj.get(k) || 0) + 1);
    }
  }
  return {
    days,
    segments: [...seg].filter(([, v]) => v.talked >= 3).map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => (b.positive / b.talked) - (a.positive / a.talked) || b.talked - a.talked).slice(0, 8),
    hours: [...hrs].filter(([, v]) => v.calls >= 10).map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    objections: [...obj].filter(([, n]) => n >= 2).map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6),
    never_called_again: [...warm].filter(n => dials.get(n) === 1).length,
  };
}

// ── Answers Nikki has already been offered ────────────────────────────

/** A question reduced to its words, so "Do you build websites?" matches "do you build websites". */
export const questionKey = (q: unknown) =>
  String(q ?? "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Drop suggestions the owner has already decided on (approved or
 * dismissed, on any day) or that repeat within this batch.
 */
export function freshSuggestions<T extends { question: string }>(items: T[], decided: Iterable<string>): T[] {
  const seen = new Set([...decided].map(questionKey));
  const out: T[] = [];
  for (const x of items) {
    const k = questionKey(x.question);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** The questions the owner has decided on, from earlier desk_insights rows and taught facts. */
export function decidedQuestions(insightRows: { suggestions?: any }[], taughtFacts: string[]): string[] {
  const out: string[] = [];
  for (const r of insightRows) {
    for (const s of (Array.isArray(r.suggestions) ? r.suggestions : [])) {
      if (s?.status === "approved" || s?.status === "dismissed") out.push(String(s.question || ""));
    }
  }
  // Approved answers are stored as: If asked "<question>": <answer>
  for (const f of taughtFacts) {
    const m = /^If asked "(.+?)":/.exec(String(f));
    if (m) out.push(m[1]);
  }
  return out;
}
