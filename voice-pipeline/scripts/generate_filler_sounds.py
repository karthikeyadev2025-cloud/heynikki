"""
Pre-generate short conversational filler sounds (
"మ్మ్...", "అలాగా...", "సరే..." etc) via Sarvam TTS, saved as raw 16-bit
PCM @ 8kHz to assets/cached_pcm/fillers/. bridge.py plays a random one
IMMEDIATELY after the caller finishes speaking, while Gemini is still
generating the actual reply — filling what would otherwise be 2+ seconds
of dead silence with a natural "I heard you, one moment" sound.

Why this matters: today's real per-turn latency measurements showed
average total time of ~5.4s from caller-stops-talking to reply-audio-
starts. Half of that is silent dead air. A human receptionist doesn't
sit silent for 2 seconds thinking — they say "mm...", "haan...", "let
me see...". This is the single change with the biggest perceived-
humanness improvement per line of code.

Fillers are pre-synthesized once, cached to disk, and picked randomly
per turn — playing the same filler every turn would sound MORE robotic,
not less.

3 languages × 4 fillers each = 12 files. Files named:
  fillers/te-IN_1.pcm, fillers/te-IN_2.pcm, ..., fillers/en-IN_4.pcm

Voice: uses "priya" for all fillers regardless of tenant SKU. Fillers
are short (< 1 second) — the tenant's actual SKU voice takes over
immediately after via speak_dynamic, so the voice consistency claim
still holds for the substantive part of the reply.

Usage:
  python3 scripts/generate_filler_sounds.py
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

FILLERS = {
    "te-IN": [
        "మ్మ్...",
        "అలాగా...",
        "సరే...",
        "ఒక్క నిమిషం...",
    ],
    "hi-IN": [
        "हम्म...",
        "अच्छा...",
        "ठीक है...",
        "एक मिनट...",
    ],
    "en-IN": [
        "Mm-hmm...",
        "I see...",
        "Okay...",
        "One moment...",
    ],
}

VOICE = "priya"  # fixed: anushka is not a valid bulbul:v3 speaker
EXOTEL_SR = 8000
TTS_SR = 22050

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "cached_pcm", "fillers")


def synth(text: str, lang: str) -> bytes:
    r = httpx.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": SARVAM_KEY},
        json={"inputs": [text], "target_language_code": lang,
              "speaker": VOICE, "model": "bulbul:v2"},
        timeout=30,
    )
    r.raise_for_status()
    wav_bytes = base64.b64decode(r.json()["audios"][0])
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        pcm = wf.readframes(wf.getnframes())
        sr = wf.getframerate()
    pcm_8k, _ = audioop.ratecv(pcm, 2, 1, sr, EXOTEL_SR, None)
    return pcm_8k


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for lang, phrases in FILLERS.items():
        for i, phrase in enumerate(phrases, start=1):
            path = os.path.join(OUT_DIR, f"{lang}_{i}.pcm")
            print(f"[{lang}] {i}/{len(phrases)}: {phrase!r}")
            pcm = synth(phrase, lang)
            with open(path, "wb") as f:
                f.write(pcm)
            dur = len(pcm) / 2 / EXOTEL_SR
            print(f"    -> {os.path.basename(path)} ({dur:.2f}s, {len(pcm):,} bytes)")
            total += 1

    print(f"\nOK: {total} filler clips written to {OUT_DIR}")


if __name__ == "__main__":
    main()
