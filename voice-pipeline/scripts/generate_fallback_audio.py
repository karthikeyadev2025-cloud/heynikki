"""
Pre-generate a "technical difficulty" fallback audio clip via Sarvam TTS,
saved as raw 16-bit PCM @ 8kHz — the exact format Session.play_cached()
expects (see app/exotel/bridge.py; NOT WAV, no header, matches
assets/cached_pcm/default.pcm's format exactly).

This gets played when the Sarvam TTS circuit breaker is OPEN (see
circuit_breaker.py) — if live Sarvam TTS synthesis is down, the caller
still hears something instead of dead silence, because this doesn't
require a live Sarvam call to play.

MUST be run while Sarvam is actually healthy, obviously — this is a
one-time asset generation step, not something that runs during an outage.

Usage:
  python3 scripts/generate_fallback_audio.py
"""
import audioop
import base64
import io
import os
import sys
import wave

import httpx

SARVAM_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_KEY:
    sys.exit("ERROR: SARVAM_API_KEY not set — source the pipeline env file first.")

FALLBACK_TEXT = (
    "క్షమించండి, ప్రస్తుతం సాంకేతిక సమస్య ఉంది. "
    "దయచేసి కొద్ది సేపటి తర్వాత మళ్ళీ కాల్ చేయండి."
)
VOICE = "priya"  # fixed: "anushka" is not a valid bulbul:v3 speaker (confirmed via live API error) — was the system-level fallback, not tied to any tenant's SKU voice
EXOTEL_SR = 8000
TTS_SR = 22050

CACHED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "assets", "cached_pcm")


def synthesize() -> bytes:
    r = httpx.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": SARVAM_KEY},
        json={
            "inputs": [FALLBACK_TEXT],
            "target_language_code": "te-IN",
            "speaker": VOICE,
            "model": "bulbul:v2",
        },
        timeout=30,
    )
    r.raise_for_status()
    return base64.b64decode(r.json()["audios"][0])


def main():
    os.makedirs(CACHED_DIR, exist_ok=True)
    print(f"Generating fallback audio (voice={VOICE})...")
    wav_bytes = synthesize()

    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        pcm_22k = wf.readframes(wf.getnframes())
        actual_sr = wf.getframerate()

    if actual_sr != TTS_SR:
        print(f"NOTE: Sarvam returned {actual_sr}Hz, expected {TTS_SR}Hz — "
              f"resampling from actual rate.")

    pcm_8k, _ = audioop.ratecv(pcm_22k, 2, 1, actual_sr, EXOTEL_SR, None)

    out_path = os.path.join(CACHED_DIR, "technical_difficulty.pcm")
    with open(out_path, "wb") as f:
        f.write(pcm_8k)

    print(f"OK: {out_path} ({len(pcm_8k):,} bytes, {len(pcm_8k)/16000:.1f}s @ 8kHz 16-bit)")


if __name__ == "__main__":
    main()
