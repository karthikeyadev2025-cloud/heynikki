"""DEAD MODULE — nothing imports it. Kept only because CI compiles it.

Its one caller, main.py's _save_onboarding_draft, now goes through
agent.llm (a configured GeminiLLM) instead, so the model name, auth header
and circuit breaker stay in one place.

Two things in here are WRONG and must not be copied. The Bearer-auth claim
below is false: verified against the live API on 2026-09-01, an AQ. key
sent as `Authorization: Bearer` returns 401 API_KEY_SERVICE_BLOCKED, while
`?key=` and `x-goog-api-key` both return 200. main.py:1188 documents the
same finding and uses x-goog-api-key for both key formats. The model
fallback chain is also unverified against the measured numbers in
main.py's GeminiLLM.
"""
import os
import httpx
import logging

log = logging.getLogger("nikki.gemini")

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

# AQ. keys use Authorization header (Bearer), not ?key= query param
# AIza keys use ?key= query param
def _is_auth_key(key: str) -> bool:
    return key.startswith("AQ.") or key.startswith("IQ.") or key.startswith("EQ.")

# Reachable and measured (see main.py GeminiLLM for the full table).
# gemini-flash-latest and gemini-3.6-flash are deliberately NOT fallbacks:
# both think before answering, and thinking tokens come out of
# maxOutputTokens, so at a small budget they return replies cut off
# mid-word.
MODELS = [
    os.environ.get("GEMINI_MODEL") or "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
]

async def gemini_generate(system_prompt: str, history: list[dict], api_key: str = "") -> str:
    key = api_key or GEMINI_KEY
    if not key:
        log.error("No Gemini API key set")
        return "ఒక్క నిమిషం."

    # Keep only last 4 turns (rolling window cost control)
    recent = history[-8:] if len(history) > 8 else history

    contents = []
    for turn in recent:
        role = "user" if turn["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": turn["content"]}]})

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": 60,
            "temperature": 0.15,  # lowered from 0.3 for more literal, less improvised answers
            "topP": 0.8,
        }
    }

    # Try each model in order until one works
    for model in MODELS:
        try:
            result = await _call_gemini(key, model, payload)
            if result:
                # Strip vendor names before returning
                for vendor in ["Sarvam", "Gemini", "LiveKit", "FreeSWITCH", "Plivo", "OpenAI", "supabase"]:
                    result = result.replace(vendor, "our system")
                return result
        except Exception as e:
            log.warning(f"Model {model} failed: {e}, trying next...")
            continue

    return "ఒక్క నిమిషం."

async def _call_gemini(key: str, model: str, payload: dict) -> str:
    base_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    if _is_auth_key(key):
        # AQ. format: use Authorization Bearer header
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        }
        url = base_url
    else:
        # Old AIza format: use ?key= query param
        headers = {"Content-Type": "application/json"}
        url = f"{base_url}?key={key}"

    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if parts:
                return parts[0].get("text", "").strip()
    return ""

