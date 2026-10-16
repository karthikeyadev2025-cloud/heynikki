/**
 * Questions callers asked that Nikki could not answer.
 *
 * The pipeline's post-call scorer lists them; this files each once per
 * business, counts repeats, and pushes the owner the moment a new one
 * appears — the owner answers on Teach Nikki and the next call knows it.
 * Before this, a caller asking "how much for 100 visiting cards?" was told
 * the owner decides, and nobody ever heard the question was asked.
 */
import type { Express, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The same question asked twice files as one: case, punctuation and
 *  spacing do not make it new. */
export function gapKey(question: string): string {
  return String(question || "").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export type Gap = { question: string; caller_said?: string };

/** What the scorer sent, cleaned: real questions only, at most three, no
 *  duplicates within the call. */
export function cleanGaps(raw: unknown): Gap[] {
  const out: Gap[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(raw) ? raw : []) {
    const question = String((g as any)?.question || "").trim().slice(0, 200);
    const key = gapKey(question);
    if (key.length < 6 || seen.has(key)) continue;
    seen.add(key);
    out.push({ question, caller_said: String((g as any)?.caller_said || "").trim().slice(0, 300) || undefined });
    if (out.length === 3) break;
  }
  return out;
}

type Deps = {
  sb: SupabaseClient;
  verifyInternal: RequestHandler;
  pushToUsers: (ids: string[], msg: { title: string; body: string; data?: Record<string, string> }) => Promise<number>;
};

export function mountKnowledgeGapRoutes(app: Express, { sb, verifyInternal, pushToUsers }: Deps) {
  // From the pipeline, after a call: { tenant_id, voice_profile_id, call_id, gaps: [...] }.
  app.post("/internal/knowledge-gaps", verifyInternal, async (req, res) => {
    const tenantId = String(req.body?.tenant_id || "");
    const gaps = cleanGaps(req.body?.gaps);
    if (!tenantId || !gaps.length) return res.json({ ok: true, filed: 0 });
    const now = new Date().toISOString();
    const fresh: string[] = [];
    for (const g of gaps) {
      const key = gapKey(g.question);
      const { data: have, error: readErr } = await sb.from("knowledge_gaps")
        .select("id, status, times_asked").eq("tenant_id", tenantId).eq("question_key", key).maybeSingle();
      if (readErr) {
        // 077 not applied yet: nothing to file into, and nothing is lost
        // that the call itself did not already lose.
        if (/knowledge_gaps/.test(readErr.message)) return res.json({ ok: false, detail: "Needs migration 077." });
        continue;
      }
      if (have) {
        // An owner who said "not relevant" is not asked again. An answered
        // one asked again is still counted: it shows the answer is in use.
        if (have.status === "dismissed") continue;
        await sb.from("knowledge_gaps").update({
          times_asked: (have.times_asked || 1) + 1, last_asked_at: now,
          ...(g.caller_said ? { caller_said: g.caller_said } : {}),
          ...(req.body?.call_id ? { call_id: req.body.call_id } : {}),
        }).eq("id", have.id);
        continue;
      }
      const { error } = await sb.from("knowledge_gaps").insert({
        tenant_id: tenantId, voice_profile_id: req.body?.voice_profile_id || null,
        question: g.question, question_key: key, caller_said: g.caller_said || null,
        call_id: req.body?.call_id || null,
      });
      if (!error) fresh.push(g.question);
    }
    if (fresh.length) {
      const { data: owners } = await sb.from("tenant_users").select("user_id")
        .eq("tenant_id", tenantId).in("role", ["owner", "super_admin"]);
      await pushToUsers((owners || []).map((o: any) => o.user_id), {
        title: "A caller asked something Nikki didn't know",
        body: fresh.length === 1 ? `"${fresh[0]}" — tap to teach her the answer.`
          : `${fresh.length} new questions — tap to teach her the answers.`,
        data: { type: "knowledge_gap", url: "/knowledge" },
      }).catch(() => 0);
    }
    console.log(`[gaps] tenant ${tenantId.slice(0, 8)}: ${gaps.length} from call, ${fresh.length} new`);
    res.json({ ok: true, filed: gaps.length, new: fresh.length });
  });
}
