"""
Compare Sarvam TTS voices side-by-side. Generates the same Telugu test
sentence with EVERY available speaker on both bulbul:v2 and bulbul:v3,
saving each to a labelled WAV file so you can listen and pick which one
sounds most like the "warm, young, emotive" voice you want.

Why this matters, honest: I can wire up any speaker you want, but I
can't hear them and don't know which one carries the mood you're
describing. This script gives you every option — you listen, you pick.

Output: assets/voice_samples/bulbul-v2_<speaker>.wav (and v3_<speaker>.wav)

Usage:
  python3 scripts/compare_voices.py
  # then download the whole directory:
  # scp -i key.pem -r ubuntu@98.130.119.138:~/jovi/voice-pipeline/assets/voice_samples/ .

**Cost note:** each generation costs 1 Sarvam credit-equivalent. This
script generates roughly 45 clips total (7 v2 + 38 v3). If you're on the
free tier, you have 1000 credits — this uses less than 5% of them, but
worth being aware of.
"""
import base64
import io
import os
import sys
import wave

import httpx

SARVAM_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_KEY:
    sys.exit("ERROR: SARVAM_API_KEY not set — source the pipeline env file first.")

# A test sentence with a bit of emotional variety — question + statement +
# warmth marker. Long enough to hear prosody, short enough not to cost much.
TEST_TEXT_TE = (
    "నమస్కారం! Nikki నుండి కాల్ చేస్తున్నాను. "
    "మీ appointment book చేయమని అనుకుంటున్నారా?"
)

# From Sarvam's official docs, verified 2026-07-02 via web search.
# bulbul:v2 speakers (all 7):
V2_SPEAKERS = [
    "anushka", "manisha", "vidya", "arya", "abhilash", "karun", "hitesh",
]

# bulbul:v3 speakers (all 38 from the docs). This is Sarvam's newer model
# with emotion control — the "warm/emotive" ask most likely lives here.
V3_SPEAKERS = [
    "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan",
    "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
    "manan", "sumit", "roopa", "kabir", "aayan", "ashutosh", "advait",
    "amelia", "sophia", "anand", "tanya", "tarun", "sunny", "mani", "gokul",
    "vijay", "shruti", "suhani", "mohit", "kavitha", "rehan", "soham",
    "rupali",
]

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "voice_samples")


def synth(text: str, speaker: str, model: str) -> bytes:
    """Returns the raw WAV bytes Sarvam returns."""
    r = httpx.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": SARVAM_KEY},
        json={
            "inputs": [text],
            "target_language_code": "te-IN",
            "speaker": speaker,
            "model": model,
        },
        timeout=30,
    )
    if r.status_code != 200:
        # Not every speaker is guaranteed to accept Telugu (varun is flagged
        # as "villain/suspense" in the docs, some may not perform well) — a
        # non-200 just means we skip and note it, not abort the whole run.
        return b""
    return base64.b64decode(r.json()["audios"][0])


def save_wav(wav_bytes: bytes, out_path: str) -> tuple:
    """Sarvam returns WAV directly, so just write it and read back the
    duration for the log line."""
    with open(out_path, "wb") as f:
        f.write(wav_bytes)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        dur = wf.getnframes() / wf.getframerate()
    return len(wav_bytes), dur


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ok, failed = 0, []

    for model, speakers in [("bulbul:v2", V2_SPEAKERS), ("bulbul:v3", V3_SPEAKERS)]:
        print(f"\n=== {model} ({len(speakers)} speakers) ===")
        for spk in speakers:
            path = os.path.join(OUT_DIR, f"{model.replace(':','-')}_{spk}.wav")
            try:
                wav = synth(TEST_TEXT_TE, spk, model)
                if not wav:
                    print(f"  {spk:12s} SKIP (API rejected)")
                    failed.append(f"{model}/{spk}")
                    continue
                size, dur = save_wav(wav, path)
                print(f"  {spk:12s} OK  {dur:.2f}s  {size/1024:.0f}KB  -> {os.path.basename(path)}")
                ok += 1
            except Exception as e:
                print(f"  {spk:12s} ERROR: {e}")
                failed.append(f"{model}/{spk}")

    print(f"\nDone. {ok} clips saved to {OUT_DIR}")
    if failed:
        print(f"Skipped/failed ({len(failed)}): {', '.join(failed)}")

    print("\n" + "=" * 60)
    print("Next step: download and listen locally. From your Windows machine:")
    print()
    print(f'  scp -i "C:\\Users\\karthikeya\\Downloads\\nikki-key.pem" -r \\')
    print(f'    ubuntu@98.130.119.138:~/jovi/voice-pipeline/assets/voice_samples/ \\')
    print(f'    C:\\Users\\karthikeya\\Downloads\\')
    print()
    print("Play them all, pick the ONE speaker+model that sounds most like")
    print('the "warm young Telugu girl carrying emotion" you want, then tell me:')
    print('  - Which model (bulbul:v2 or bulbul:v3)')
    print('  - Which speaker name')
    print("I'll wire it into bridge.py as the new default.")


if __name__ == "__main__":
    main()
