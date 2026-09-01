"""
Nikki — API Key Tester
Run: python voice-pipeline/scripts/test_keys.py
Tests all your API keys and tells you exactly what works
"""
import asyncio
import httpx
import json
import base64
import os

SARVAM_KEY = "sk_xrjuvesm_PzpTtnRStrGBdnP7aoIWbRQI"
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "REPLACE_ME")  # Set this after getting from AI Studio
GEMINI_MODEL = os.environ.get("GEMINI_MODEL") or "gemini-3.5-flash-lite"  # same default as the services
LIVEKIT_KEY = "APIKXJGadU3uAqS"
SUPABASE_URL = "https://wnawozdmmxuziucavngw.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduYXdvemRtbXh1eml1Y2F2bmd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTQ2MzEsImV4cCI6MjA5ODA3MDYzMX0.x9MqSJzRRkZqM1KadQg1m3C64xyRcUu_bkc5uXEZfns"

def ok(msg): print(f"  ✅ {msg}")
def fail(msg): print(f"  ❌ {msg}")
def info(msg): print(f"  ℹ️  {msg}")

async def test_sarvam_tts():
    print("\n📢 Testing Sarvam TTS (Bulbul V3)...")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": SARVAM_KEY, "Content-Type": "application/json"},
                json={
                    "inputs": ["నమస్కారం! ఇది Nikki Telugu AI రిసెప్షనిస్ట్."],
                    "target_language_code": "te-IN",
                    "speaker": "priya",  # fixed: meera not valid on bulbul:v3
                    "model": "bulbul:v3",
                    "speech_sample_rate": 8000,
                }
            )
            if r.status_code == 200:
                data = r.json()
                audio = data.get("audios", [""])[0]
                if audio:
                    # Save audio file
                    with open("test_tts_output.wav", "wb") as f:
                        f.write(base64.b64decode(audio))
                    ok(f"Sarvam TTS WORKS! Audio saved to test_tts_output.wav")
                    ok(f"Play it: start test_tts_output.wav  (Windows)")
                    return True
                else:
                    fail(f"Sarvam TTS: No audio in response. Response: {data}")
            else:
                fail(f"Sarvam TTS: HTTP {r.status_code} — {r.text[:200]}")
    except Exception as e:
        fail(f"Sarvam TTS Exception: {e}")
    return False

async def test_sarvam_stt():
    print("\n🎤 Testing Sarvam STT (Saaras V3)...")
    try:
        # Create a tiny silent WAV for testing
        # WAV header: 44 bytes + 8000 Hz, 16-bit, mono, 0.5s silence
        sample_rate = 8000
        num_samples = sample_rate // 2  # 0.5 seconds
        wav_header = (
            b'RIFF' + (36 + num_samples * 2).to_bytes(4, 'little') +
            b'WAVE' + b'fmt ' + (16).to_bytes(4, 'little') +
            (1).to_bytes(2, 'little') +   # PCM
            (1).to_bytes(2, 'little') +   # Mono
            (sample_rate).to_bytes(4, 'little') +
            (sample_rate * 2).to_bytes(4, 'little') +
            (2).to_bytes(2, 'little') +
            (16).to_bytes(2, 'little') +
            b'data' + (num_samples * 2).to_bytes(4, 'little') +
            b'\x00' * (num_samples * 2)
        )
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": SARVAM_KEY},
                files={"file": ("test.wav", wav_header, "audio/wav")},
                data={"model": "saaras:v3", "language_code": "te-IN"}
            )
            if r.status_code == 200:
                ok(f"Sarvam STT WORKS! Response: {r.json()}")
                return True
            else:
                fail(f"Sarvam STT: HTTP {r.status_code} — {r.text[:300]}")
    except Exception as e:
        fail(f"Sarvam STT Exception: {e}")
    return False

async def test_gemini():
    print(f"\n🧠 Testing Gemini API key: {GEMINI_KEY[:15]}...")
    if GEMINI_KEY == "REPLACE_ME" or not GEMINI_KEY.startswith("AIza"):
        fail("Gemini key not set or wrong format.")
        info("Go to: aistudio.google.com/apikey")
        info("Click 'Create API Key' — key must start with 'AIza...'")
        info(f"Your current key starts with: {GEMINI_KEY[:10]}... (WRONG FORMAT)")
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_KEY}",
                json={"contents": [{"parts": [{"text": "Say 'నమస్కారం' only, nothing else."}]}],
                      "generationConfig": {"maxOutputTokens": 20}}
            )
            if r.status_code == 200:
                text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
                ok(f"Gemini WORKS! Response: {text.strip()}")
                return True
            else:
                fail(f"Gemini: HTTP {r.status_code} — {r.text[:300]}")
    except Exception as e:
        fail(f"Gemini Exception: {e}")
    return False

async def test_supabase():
    print("\n🗄️  Testing Supabase connection...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/tenants?limit=1",
                headers={
                    "apikey": SUPABASE_ANON,
                    "Authorization": f"Bearer {SUPABASE_ANON}",
                }
            )
            if r.status_code == 200:
                ok(f"Supabase WORKS! Tables accessible.")
                data = r.json()
                if isinstance(data, list):
                    info(f"tenants table has {len(data)} rows (RLS may filter)")
                return True
            elif r.status_code == 401:
                fail(f"Supabase: 401 Unauthorized — check anon key")
            else:
                # 404 means table doesn't exist yet — run schema first
                fail(f"Supabase: HTTP {r.status_code} — Run 001_schema.sql first in SQL Editor")
    except Exception as e:
        fail(f"Supabase Exception: {e}")
    return False

async def test_livekit():
    print("\n🎙️  Testing LiveKit connection...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Test LiveKit Cloud endpoint reachability
            r = await client.get("https://nikki-7xgvqaga.livekit.cloud")
            if r.status_code in (200, 404, 400, 403):  # Any response = reachable
                ok(f"LiveKit Cloud endpoint REACHABLE (HTTP {r.status_code})")
                info("Full connection test requires WebSocket — verify in LiveKit dashboard")
                return True
    except Exception as e:
        fail(f"LiveKit: {e}")
    return False

async def main():
    print("=" * 50)
    print("Nikki — API Key Test Suite")
    print("=" * 50)

    results = {}
    results["sarvam_tts"] = await test_sarvam_tts()
    results["sarvam_stt"] = await test_sarvam_stt()
    results["gemini"]     = await test_gemini()
    results["supabase"]   = await test_supabase()
    results["livekit"]    = await test_livekit()

    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    for service, status in results.items():
        emoji = "✅" if status else "❌"
        print(f"  {emoji} {service.upper()}")

    if not results["gemini"]:
        print("\n🔴 ACTION REQUIRED:")
        print("  1. Go to: https://aistudio.google.com/apikey")
        print("  2. Click 'Create API Key'")
        print("  3. Copy the key (starts with AIza...)")
        print("  4. Run: GEMINI_API_KEY=AIzaYourKey python voice-pipeline/scripts/test_keys.py")

    if results["sarvam_tts"]:
        print("\n🎵 Sarvam TTS audio saved! Open test_tts_output.wav to hear Telugu AI voice.")

    working = sum(results.values())
    print(f"\n{working}/{len(results)} APIs working")

if __name__ == "__main__":
    asyncio.run(main())
