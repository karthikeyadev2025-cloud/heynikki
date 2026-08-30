"""
Knowledge base RAG — lets a voice profile answer real questions about the
tenant's actual services/prices instead of always falling back to "team
will call back". This was schema-complete (pgvector, knowledge_base table,
match_knowledge() SQL function) but had zero code using any of it.

Pipeline:
  ingest:   text -> Gemini embedding -> stored in knowledge_base
  runtime:  caller question -> Gemini embedding -> match_knowledge() RPC
            -> top-3 relevant snippets -> appended to that turn's system
            prompt as grounding context

Embedding model: gemini-embedding-001, output_dimensionality=1536 to match
the schema's `vector(1536)` column exactly. Uses the same GEMINI_API_KEY
already configured — no new provider/credential needed.

IMPORTANT — not yet verified against the live Gemini API from this dev
environment (no network path to generativelanguage.googleapis.com here).
The REST request/response shape below follows Gemini's documented
embedContent convention, but run scripts/test_embedding.py once against
the real API key before trusting this in a live call — same one-time
verification discipline as every other external integration this session.
"""
import logging
import os
from typing import Optional

import httpx

log = logging.getLogger("exotel-bridge")

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIMENSIONS = 1536  # must match knowledge_base.embedding vector(1536)


async def gemini_embed(text: str) -> Optional[list]:
    """Embed a single piece of text. Returns a 1536-float list, or None on
    failure — callers must treat that as "skip RAG for this turn", never
    as a reason to fail the call."""
    if not text or not text.strip():
        return None
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{EMBED_MODEL}:embedContent?key={GEMINI_KEY}")
    async with httpx.AsyncClient(timeout=15) as c:
        try:
            r = await c.post(url, headers={"Content-Type": "application/json"},
                json={
                    "content": {"parts": [{"text": text}]},
                    "outputDimensionality": EMBED_DIMENSIONS,
                })
            if r.status_code != 200:
                log.warning("gemini_embed %s: %s", r.status_code, r.text[:200])
                return None
            values = r.json().get("embedding", {}).get("values")
            if not values or len(values) != EMBED_DIMENSIONS:
                log.warning("gemini_embed: unexpected vector length %s",
                            len(values) if values else 0)
                return None
            return values
        except Exception as e:
            log.warning("gemini_embed failed: %s", e)
            return None


async def search_knowledge(voice_profile_id: str, query_embedding: list,
                            top_k: int = 3) -> list:
    """Call the existing match_knowledge() Postgres function via Supabase
    RPC. Returns a list of content strings, empty list on any failure —
    never raises, RAG is an enhancement, not a call-blocking dependency."""
    if not voice_profile_id or not query_embedding:
        return []
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.post(f"{SUPABASE_URL}/rest/v1/rpc/match_knowledge",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json"},
                json={
                    "p_voice_profile_id": voice_profile_id,
                    "p_embedding": query_embedding,
                    "p_match_count": top_k,
                })
            if r.status_code != 200:
                log.warning("search_knowledge %s: %s", r.status_code, r.text[:200])
                return []
            return [row["content"] for row in r.json() if row.get("content")]
        except Exception as e:
            log.warning("search_knowledge failed: %s", e)
            return []


async def retrieve_context(voice_profile_id: str, question: str) -> list:
    """Convenience wrapper: embed the question, search, return snippets.
    Used inline in the call turn — any failure at any step just means no
    grounding context for this turn, the call continues normally."""
    if not voice_profile_id:
        return []
    embedding = await gemini_embed(question)
    if not embedding:
        return []
    return await search_knowledge(voice_profile_id, embedding)


def augment_prompt(base_system_prompt: str, context_snippets: list) -> str:
    """Append retrieved knowledge to the system prompt for this turn only.
    Does not mutate the session's stored s._sys — call this fresh per turn
    so context reflects only what's relevant to the current question."""
    if not context_snippets:
        return base_system_prompt
    context_block = "\n".join(f"- {s}" for s in context_snippets)
    return (
        base_system_prompt
        + "\n\nRelevant business info (use this to answer if applicable, "
          "don't mention where it came from):\n"
        + context_block
    )


async def ingest_knowledge_entry(voice_profile_id: str, tenant_id: str,
                                  content: str, source_type: str = "faq",
                                  source_name: Optional[str] = None) -> Optional[str]:
    """Embed and store one knowledge_base entry. Returns the new row id,
    or None on failure. This is the ingestion half — see
    scripts/ingest_knowledge.py for a CLI wrapper around this."""
    embedding = await gemini_embed(content)
    if not embedding:
        log.error("ingest_knowledge_entry: embedding failed, not inserting")
        return None
    async with httpx.AsyncClient(timeout=10) as c:
        try:
            r = await c.post(f"{SUPABASE_URL}/rest/v1/knowledge_base",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json", "Prefer": "return=representation"},
                json={
                    "voice_profile_id": voice_profile_id,
                    "tenant_id": tenant_id,
                    "content": content,
                    "embedding": embedding,
                    "source_type": source_type,
                    "source_name": source_name,
                })
            if r.status_code in (200, 201) and r.json():
                return r.json()[0]["id"]
            log.error("ingest_knowledge_entry insert %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            log.error("ingest_knowledge_entry failed: %s", e)
    return None
