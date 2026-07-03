"""
Gemini client updated for AQ. Auth key format (post June 19 2026)
AQ. keys use Bearer token auth, not ?key= query param
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

MODELS = [
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
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
            "temperature": 0.3,
            "topP": 0.8,
        }
    }

    # Try each model in order until one works
    for model in MODELS:
        try:
            result = await _call_gemini(key, model, payload)
            if result:
                # Strip vendor names before returning
                for vendor in ["Sarvam", "Gemini", "LiveKit", "Exotel", "Plivo", "OpenAI", "supabase"]:
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

