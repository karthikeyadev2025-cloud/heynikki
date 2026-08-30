"""
One-time verification: confirms Sarvam's automatic language detection
(language_code="unknown") actually works and returns the field name this
code expects (`language_code` in the response) before trusting live
language switching on a real call.

Generates a short, known-text clip in Telugu, Hindi, and English via Sarvam
TTS, feeds each one back into Sarvam STT with language_code="unknown", and
checks whether the detected language matches what was actually spoken.

This exists because the STT auto-detect response schema was verified via
documentation search, not a live call from this dev environment (no
network path to api.sarvam.ai here). "Documented" and "confirmed against
the real API with this account" are different claims — run this once.

Usage:
  python3 scripts/test_language_detection.py
"""
import asyncio
import io
import os
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.widget import sarvam_stt, sarvam_tts, LANGUAGE_NAMES  # noqa: E402

TEST_PHRASES = {
    "te-IN": "నమస్కారం, మీరు ఎలా ఉన్నారు",
    "hi-IN": "नमस्ते, आप कैसे हैं",
    "en-IN": "Hello, how are you doing today",
}


async def main():
    for var in ("SARVAM_API_KEY",):
        if not os.getenv(var):
            sys.exit(f"ERROR: {var} not set — source the pipeline env file first.")

    print("Testing Sarvam language auto-detection (language_code='unknown')...\n")
    results = []

    for spoken_lang, text in TEST_PHRASES.items():
        print(f"--- Generating {LANGUAGE_NAMES[spoken_lang]} clip: {text!r}")
        wav_pcm22k = await sarvam_tts(text, voice="priya", target_language_code=spoken_lang)
        if not wav_pcm22k:
            print(f"    FAILED: TTS generation failed for {spoken_lang}, skipping")
            results.append((spoken_lang, None))
            continue

        # sarvam_tts returns raw 22.05kHz PCM (post-WAV-decode) — wrap it
        # back into a WAV so sarvam_stt (which expects PIPE_SR=16kHz PCM
        # wrapped as WAV) gets a well-formed file. Resample isn't exact
        # here since this is a verification script, not the live path,
        # but STT is tolerant of sample-rate mismatches within a WAV header.
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(22050)
            wf.writeframes(wav_pcm22k)

        import httpx
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post("https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": os.environ["SARVAM_API_KEY"]},
                files={"file": ("audio.wav", buf.getvalue(), "audio/wav")},
                data={"language_code": "unknown", "model": "saarika:v2.5"})

        if r.status_code != 200:
            print(f"    FAILED: STT {r.status_code}: {r.text[:200]}")
            results.append((spoken_lang, None))
            continue

        body = r.json()
        print(f"    Raw response: {body}")
        detected = body.get("language_code", "")
        transcript = body.get("transcript", "")
        print(f"    Transcript: {transcript!r}")
        print(f"    Detected language_code field: {detected!r}\n")
        results.append((spoken_lang, detected))

    print("=" * 60)
    all_correct = True
    for spoken, detected in results:
        ok = (detected == spoken)
        all_correct = all_correct and ok
        status = "OK" if ok else ("SKIPPED" if detected is None else "MISMATCH")
        print(f"  Spoke {LANGUAGE_NAMES[spoken]:8s} ({spoken}) -> "
              f"detected {detected!r:10s} [{status}]")

    print()
    if all_correct:
        print("Language detection verified. Safe to trust live switching on calls.")
    else:
        print("WARNING: not all languages detected correctly. Check the raw responses")
        print("above — if the field name is wrong (not 'language_code'), update")
        print("sarvam_stt() in app/widget.py to match what Sarvam actually returns.")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
