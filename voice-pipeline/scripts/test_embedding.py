"""
One-time verification: confirms the Gemini embedContent REST call actually
works against the real API before the knowledge-base RAG feature is
trusted in a live call. Run this once after deploying, before relying on
retrieve_context() during real conversations.

This exists because knowledge.py was written without network access to
generativelanguage.googleapis.com to test against — the REST shape follows
Gemini's documented convention, but "documented" and "verified against the
real API with this exact key/account" are different claims. Run this,
don't skip it.

Usage:
  python3 scripts/test_embedding.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.knowledge import gemini_embed, EMBED_MODEL, EMBED_DIMENSIONS  # noqa: E402


async def main():
    if not os.getenv("GEMINI_API_KEY"):
        sys.exit("ERROR: GEMINI_API_KEY not set — source the pipeline env file first.")

    print(f"Testing {EMBED_MODEL} with outputDimensionality={EMBED_DIMENSIONS}...")
    vec = await gemini_embed("Clinic hours are Monday to Saturday, 8am to 8pm.")

    if vec is None:
        print("\nFAILED — gemini_embed returned None. Check the warning logged above")
        print("(printed via the 'exotel-bridge' logger — look for 'gemini_embed' lines).")
        print("Common causes: wrong model name, API key doesn't have this model enabled,")
        print("or outputDimensionality isn't accepted by this model/API version.")
        sys.exit(1)

    print(f"\nOK — got a {len(vec)}-dimension vector.")
    print(f"First 5 values: {vec[:5]}")
    if len(vec) != EMBED_DIMENSIONS:
        print(f"\nWARNING: expected {EMBED_DIMENSIONS} dimensions, got {len(vec)}.")
        print("This WILL break inserts into knowledge_base (column is vector(1536)).")
        sys.exit(1)

    print("\nEmbedding pipeline verified. Safe to use scripts/ingest_knowledge.py")
    print("and the live RAG retrieval path now.")


if __name__ == "__main__":
    asyncio.run(main())
