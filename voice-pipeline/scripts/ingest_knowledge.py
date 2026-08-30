"""
Ingest FAQ/knowledge content for a voice profile's RAG knowledge base.

There's no PDF-upload dashboard UI yet (that's a separate, larger piece of
work) — this is a usable interim path: give it a JSON file of Q&A/FAQ
entries and it embeds + inserts each one via app/knowledge.py.

Usage:
  python3 scripts/ingest_knowledge.py \\
      --voice-profile-id <uuid> --tenant-id <uuid> --file faq.json

faq.json format:
[
  {"content": "Clinic hours are Mon-Sat, 8am to 8pm.", "source_type": "faq"},
  {"content": "Blood test results take 24 hours.", "source_type": "faq"},
  {"content": "We accept UPI, cash, and cards.", "source_type": "faq", "source_name": "pricing"}
]

`content` is required. `source_type` defaults to "faq" if omitted (must be
one of: faq, document, manual, url — matches the DB check constraint).
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.knowledge import ingest_knowledge_entry  # noqa: E402


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice-profile-id", required=True)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--file", required=True, help="Path to JSON file of entries")
    args = parser.parse_args()

    for var in ("GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        if not os.getenv(var):
            sys.exit(f"ERROR: {var} not set — source the pipeline env file first.")

    with open(args.file, "r", encoding="utf-8") as f:
        entries = json.load(f)

    if not isinstance(entries, list) or not entries:
        sys.exit("ERROR: file must contain a non-empty JSON array of entries.")

    print(f"Ingesting {len(entries)} entries for voice_profile_id={args.voice_profile_id}...")
    ok, failed = 0, 0
    for i, entry in enumerate(entries):
        content = entry.get("content", "").strip()
        if not content:
            print(f"  [{i}] SKIP — empty content")
            failed += 1
            continue
        row_id = await ingest_knowledge_entry(
            voice_profile_id=args.voice_profile_id,
            tenant_id=args.tenant_id,
            content=content,
            source_type=entry.get("source_type", "faq"),
            source_name=entry.get("source_name"),
        )
        if row_id:
            print(f"  [{i}] OK  -> {row_id}  ({content[:50]}...)" if len(content) > 50
                  else f"  [{i}] OK  -> {row_id}  ({content})")
            ok += 1
        else:
            print(f"  [{i}] FAILED  ({content[:50]}...)")
            failed += 1

    print(f"\nDone. {ok} inserted, {failed} failed.")


if __name__ == "__main__":
    asyncio.run(main())
