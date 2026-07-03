"""
Generate the pre-cached greeting played instantly (~50ms) the moment a
call connects, before any database lookups happen — this is the fix from
very early in this project's history for Exotel hanging up before Nikki/
Nikki said anything. Played via Session.play_cached("default") in
bridge.py.

This script didn't exist before 2026-07-02 — the original greeting was
generated ad-hoc directly in a terminal session, never committed as a
reusable script. Written now specifically to regenerate it with the
"Nikki" rebrand (2026-07-02) and the bulbul:v3 voice upgrade (also
2026-07-02) — keeping the greeting's voice consistent with the rest of
the pipeline instead of leaving it on the old v2/anushka voice while
every live-generated reply moved to v3/priya.

Usage:
  python3 scripts/generate_greeting.py
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

GREETING_TEXT = "నమస్కారం! నిక్కీకి స్వాగతం. నేను ఎలా సహాయపడగలను?"
VOICE = "priya"  # matches DEFAULT_VOICE in bridge.py — consistent voice
                 # across the greeting and every live-generated reply
EXOTEL_SR = 8000

OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "assets", "cached_pcm", "default.pcm")


def main():
    print(f"Generating greeting (voice={VOICE}, bulbul:v3): {GREETING_TEXT!r}")
    r = httpx.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": SARVAM_KEY},
        json={
            "inputs": [GREETING_TEXT],
            "target_language_code": "te-IN",
            "speaker": VOICE,
            "model": "bulbul:v3",
            # No pitch/loudness — bulbul:v3 rejects those params (found
            # live 2026-07-02). speech_sample_rate=8000 matches Exotel's
            # target rate directly, no resample needed.
            "pace": 1.1,
            "speech_sample_rate": EXOTEL_SR,
            "enable_preprocessing": True,
            "eng_interpolation_wt": 100,
        },
        timeout=30,
    )
    r.raise_for_status()
    wav_bytes = base64.b64decode(r.json()["audios"][0])

    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        pcm = wf.readframes(wf.getnframes())
        actual_sr = wf.getframerate()

    if actual_sr != EXOTEL_SR:
        print(f"NOTE: Sarvam returned {actual_sr}Hz, resampling to {EXOTEL_SR}Hz.")
        pcm, _ = audioop.ratecv(pcm, 2, 1, actual_sr, EXOTEL_SR, None)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "wb") as f:
        f.write(pcm)

    dur = len(pcm) / 2 / EXOTEL_SR
    print(f"OK: {OUT_PATH} ({dur:.1f}s, {len(pcm):,} bytes @ {EXOTEL_SR}Hz)")


if __name__ == "__main__":
    main()
