"""
Focused voice + expressiveness comparison — the listening test that
actually closes the "which voice should Hey Nikki have" question.

WHY THIS EXISTS (and why compare_voices.py wasn't enough):
compare_voices.py generated 44 clips across every speaker on both models.
That turned out to be too many to realistically sit and listen through,
so it never happened, and the pipeline has been shipping `priya` — a
voice picked from an API error message, never heard by anyone.

This script generates a much smaller, more decidable set: 5 candidate
female voices x 3 expressiveness levels = 15 clips. Fifteen is a
listening task someone actually finishes.

The temperature axis matters as much as the voice axis. Per Sarvam's own
docs, temperature controls "expressiveness and prosodic variation... higher
values introduce more natural pitch variation and emotional colour" — it's
the single biggest lever on whether the voice sounds warm/human vs flat.
Same speaker at 0.6 vs 1.1 can sound like a different person. So picking a
speaker without also picking a temperature is only half the decision.

Voice shortlist rationale: from Sarvam's 39 v3 speakers, these 5 are the
ones whose names read as female Indian names, since the brief throughout
has been "young Telugu woman who carries mood and emotion." This is a
name-based heuristic, NOT a quality judgement — I have never heard any of
these voices. If none of the 5 sound right, widen the list (all 39 names
are in compare_voices.py) and re-run.

Usage:
  export SARVAM_API_KEY="..."
  python3 scripts/pick_voice.py
"""
import base64
import io
import os
import sys
import wave

import httpx

SARVAM_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_KEY:
    sys.exit("ERROR: SARVAM_API_KEY not set — source the pipeline env first.")

# Deliberately a real receptionist line with emotional range in it — a
# greeting, a reassurance, and a question. Flat text can make even a warm
# voice sound flat, which would make this whole comparison useless.
TEST_TEXT = (
    "నమస్కారం! హే నిక్కీకి స్వాగతం. "
    "చింతించకండి, నేను మీకు సహాయం చేస్తాను. "
    "మీ appointment ఎప్పుడు కావాలి?"
)

CANDIDATES = ["priya", "ritu", "tanya", "shruti", "kavitha"]

# 0.6 is Sarvam's default (what we've been shipping unknowingly all along).
# 0.85 is the new proposed default. 1.1 leans further into expressiveness —
# Sarvam warns higher values "may introduce artifacts", so this is included
# specifically so you can hear where that tradeoff starts to bite.
TEMPERATURES = [0.6, 0.85, 1.1]

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "voice_picks")


def synth(text, speaker, temperature):
    r = httpx.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": SARVAM_KEY},
        json={
            "inputs": [text],
            "target_language_code": "te-IN",
            "speaker": speaker,
            "model": "bulbul:v3",
            "pace": 1.1,
            "temperature": temperature,
            "enable_preprocessing": True,
            "eng_interpolation_wt": 100,
        },
        timeout=45,
    )
    if r.status_code != 200:
        return None, r.text[:200]
    return base64.b64decode(r.json()["audios"][0]), None


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ok, failed = 0, []
    print(f"Generating {len(CANDIDATES) * len(TEMPERATURES)} clips "
          f"({len(CANDIDATES)} voices x {len(TEMPERATURES)} temperatures)\n")

    for speaker in CANDIDATES:
        for temp in TEMPERATURES:
            label = f"{speaker}_temp{str(temp).replace('.','')}"
            wav, err = synth(TEST_TEXT, speaker, temp)
            if wav is None:
                print(f"  {label:24s} FAILED: {err}")
                failed.append(label)
                continue
            path = os.path.join(OUT_DIR, f"{label}.wav")
            with open(path, "wb") as f:
                f.write(wav)
            with wave.open(io.BytesIO(wav), "rb") as wf:
                dur = wf.getnframes() / wf.getframerate()
            print(f"  {label:24s} OK  {dur:.1f}s  -> {os.path.basename(path)}")
            ok += 1

    print(f"\n{ok} clips written to {OUT_DIR}")
    if failed:
        print(f"Failed: {', '.join(failed)}")

    print("\n" + "=" * 62)
    print("Now download and listen. Tell me the winning filename,")
    print("e.g. 'ritu_temp085'. Listen for BOTH:")
    print("  - which VOICE sounds like the person you want answering calls")
    print("  - which TEMPERATURE sounds warm without sounding unstable")


if __name__ == "__main__":
    main()
