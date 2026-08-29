// api-server/src/assets.ts
// ────────────────────────────────────────────────────────────────
// Onboarding by upload rather than by form.
//
// A clinic owner has a brochure. A restaurant has a menu. A jeweller has
// a price list and a board outside the shop. All of it says what they do,
// when they open and what they charge — which is exactly what /setup asks
// them to retype, and exactly why /setup sits half-finished.
//
// They upload it. Gemini reads it directly (it accepts PDFs and images as
// inline data, so there is no OCR step to get wrong). Two things come out:
//
//   knowledge_base rows  — free text facts, embedded by the existing job,
//                          so the agent can answer from the brochure.
//   a profile draft      — services, hours, appointment types, which the
//                          owner confirms before anything changes.
//
// The draft is the important part. A brochure is evidence, not
// instruction: applying "Mon-Sat 9-9" silently would let a stale PDF
// change when a business answers its phone.
// ────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } });

const GEMINI_KEY   = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

// Deliberately short. These are leaflets and photos, not video, and an
// unbounded upload endpoint on a service with a service-role key is a
// liability rather than a feature.
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
]);

/** Fields a document is ever allowed to propose. Everything about routing,
 *  numbers, billing and consent is absent on purpose — a model reading an
 *  uploaded PDF must not be able to reach them. */
const DRAFTABLE = [
  "business_name", "services", "appointment_types",
  "open_time", "close_time", "open_days", "fallback_message",
] as const;

const EXTRACT_PROMPT = `You are reading a document belonging to a small Indian business.
Extract ONLY what the document actually states. Never invent details.

Return strict JSON:
{
  "business_name": string|null,
  "services": string[],
  "appointment_types": string[],
  "open_time": "HH:MM"|null,
  "close_time": "HH:MM"|null,
  "open_days": string[],
  "facts": string[]
}

"facts" is for anything a caller might ask that does not fit above —
prices, locations, doctor names, offers, parking, languages spoken.
Write each fact as one short standalone sentence.

If the document is only a logo or a photo with no readable business
information, return every field null or empty. Do not guess from the
image style. An empty answer is correct and useful; a guessed one is not.`;

async function readAsset(base64: string, mime: string): Promise<any> {
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: EXTRACT_PROMPT },
        { inline_data: { mime_type: mime, data: base64 } },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(text);
}

export function mountAssetRoutes(app: Express, verifyJWT: any) {
  // Upload. Base64 in JSON rather than multipart: the payloads are small,
  // express.json already has a 2mb limit that this raises deliberately for
  // one route, and it avoids adding a multipart dependency for one endpoint.
  app.post("/api/assets", verifyJWT, async (req: any, res: Response) => {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ error: "No tenant" });

    const { file_name, mime_type, data_base64, kind } = req.body || {};
    if (!data_base64 || !mime_type) {
      return res.status(400).json({ error: "mime_type and data_base64 required" });
    }
    if (!ALLOWED.has(String(mime_type))) {
      return res.status(415).json({
        error: `Cannot read ${mime_type}. Send a PDF or a photo.`,
      });
    }
    const buf = Buffer.from(String(data_base64), "base64");
    if (!buf.length) return res.status(400).json({ error: "Empty file" });
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: `Too large (${Math.round(buf.length / 1e6)}MB). Max 8MB.` });
    }

    const key = `assets/${tenantId}/${crypto.randomUUID()}`;
    const { data, error } = await sb.from("tenant_assets").insert({
      tenant_id: tenantId,
      kind: ["brochure", "logo", "price_list", "menu", "photo", "other"]
        .includes(String(kind)) ? kind : "brochure",
      file_name: String(file_name || "upload").slice(0, 200),
      mime_type, size_bytes: buf.length, r2_object_key: key,
      status: "uploaded",
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Processed inline, not queued. The owner is sitting on the page having
    // just pressed upload; a job that runs in fifteen minutes would mean
    // they see nothing happen and conclude it did not work.
    processAsset(data.id, buf.toString("base64"), mime_type, tenantId)
      .catch(e => console.error("[assets] processing:", e.message));

    res.json({ ok: true, asset: { id: data.id, status: "processing" } });
  });

  app.get("/api/assets", verifyJWT, async (req: any, res: Response) => {
    const { data, error } = await sb.from("tenant_assets")
      .select("id, kind, file_name, mime_type, size_bytes, status, extracted, error, created_at")
      .eq("tenant_id", req.user.tenant_id).order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ assets: data || [] });
  });

  app.get("/api/profile-drafts", verifyJWT, async (req: any, res: Response) => {
    const { data, error } = await sb.from("profile_drafts")
      .select("id, proposed, status, created_at")
      .eq("tenant_id", req.user.tenant_id).eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ drafts: data || [] });
  });

  // Apply. The whitelist is enforced HERE as well as at extraction, because
  // this endpoint takes an id and the row it reads was written by a model.
  app.post("/api/profile-drafts/:id/apply", verifyJWT, async (req: any, res: Response) => {
    const { data: draft } = await sb.from("profile_drafts")
      .select("id, proposed, tenant_id, status")
      .eq("id", req.params.id).eq("tenant_id", req.user.tenant_id).maybeSingle();
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    if (draft.status !== "pending") return res.status(409).json({ error: `Already ${draft.status}` });

    const patch: Record<string, any> = {};
    for (const f of DRAFTABLE) {
      const v = (draft.proposed as any)?.[f];
      if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) patch[f] = v;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to apply" });

    const { data: profile } = await sb.from("voice_profiles")
      .select("id").eq("tenant_id", draft.tenant_id).limit(1).maybeSingle();
    if (!profile) return res.status(400).json({ error: "No voice profile yet" });

    const { error: upErr } = await sb.from("voice_profiles").update(patch).eq("id", profile.id);
    if (upErr) return res.status(500).json({ error: upErr.message });

    await sb.from("profile_drafts")
      .update({ status: "applied", decided_at: new Date().toISOString() }).eq("id", draft.id);
    res.json({ ok: true, applied: Object.keys(patch) });
  });

  app.post("/api/profile-drafts/:id/dismiss", verifyJWT, async (req: any, res: Response) => {
    const { error } = await sb.from("profile_drafts")
      .update({ status: "dismissed", decided_at: new Date().toISOString() })
      .eq("id", req.params.id).eq("tenant_id", req.user.tenant_id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });
}

async function processAsset(id: string, b64: string, mime: string, tenantId: string) {
  await sb.from("tenant_assets").update({ status: "processing" }).eq("id", id);
  try {
    const out = await readAsset(b64, mime);

    // Facts go to knowledge_base, where the existing embedding job picks
    // them up — so the brochure is answerable on the next call without a
    // second pipeline.
    const facts: string[] = Array.isArray(out.facts) ? out.facts.filter(Boolean).slice(0, 40) : [];
    if (facts.length) {
      const { data: vp } = await sb.from("voice_profiles")
        .select("id").eq("tenant_id", tenantId).limit(1).maybeSingle();
      await sb.from("knowledge_base").insert(facts.map(f => ({
        tenant_id: tenantId, voice_profile_id: vp?.id || null,
        content: String(f).slice(0, 1000),
        source_type: "upload", source_name: `asset:${id}`,
      })));
    }

    const proposed: Record<string, any> = {};
    for (const f of DRAFTABLE) {
      const v = out[f];
      if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) proposed[f] = v;
    }
    if (Object.keys(proposed).length) {
      await sb.from("profile_drafts").insert({
        tenant_id: tenantId, source_asset: id, proposed,
      });
    }

    await sb.from("tenant_assets").update({
      status: "processed",
      extracted: { facts: facts.length, proposed: Object.keys(proposed) },
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    console.log(`[assets] ${id}: ${facts.length} facts, ${Object.keys(proposed).length} fields proposed`);
  } catch (e: any) {
    await sb.from("tenant_assets").update({
      status: "failed", error: String(e.message).slice(0, 300),
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    console.error(`[assets] ${id} failed:`, e.message);
  }
}
