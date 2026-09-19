"""
Pre-generate TRAI mandatory AI-disclosure WAV via Sarvam Bulbul TTS.
Run once per deployment. Output goes to voice-pipeline/assets/
"""
import os, sys, asyncio, httpx, base64, pathlib

SARVAM_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_KEY:
    sys.exit("ERROR: SARVAM_API_KEY not set.")

# ONE sentence, and it must match TRAI_DISCLOSURE in main.py — that constant
# is what a missing asset falls back to synthesising, and a caller should not
# hear two different disclosures depending on whether a file existed.
#
# It used to carry a second sentence offering a transfer to staff, which took
# the recording to 7.0s on simran, 9.5s on shreya and 10.3s on aditya. That
# plays BEFORE the greeting, so every caller waited that long to hear hello —
# which is why the disclosure was switched off on 5 Sep rather than shortened.
# The transfer offer is not lost: Nikki transfers whenever anyone asks for a
# person, which is a prompt rule and does not depend on this file.
DISCLOSURE_TEXT = "నమస్కారం. ఈ call automated assistant ద్వారా handle అవుతోంది."

# Must cover EVERY speaker sku_voices in main.py can select, or that SKU
# silently falls through to a runtime TTS round-trip at call start — and to
# no disclosure at all if Sarvam is slow or down, which is a TRAI breach,
# not a cosmetic miss. "aditya" was missing here, so the real_estate SKU
# never had an asset.
# EVERY voice that exists as an asset today, not just the ones sku_voices
# names: "simran" is the standard SKU and the Hey Nikki line itself, and it
# was missing from this list even though the file existed — so a regeneration
# run would have left the most-used voice on the old, long recording.
VOICES = ["simran", "shreya", "aditya", "kavya",
          "priya", "manisha", "anushka", "vidya"]

ASSETS_DIR = pathlib.Path(__file__).resolve().parent.parent / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

async def synthesize(voice: str) -> bytes:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.sarvam.ai/text-to-speech",
            headers={"api-subscription-key": SARVAM_KEY},
            json={
                "inputs": [DISCLOSURE_TEXT],
                "target_language_code": "te-IN",
                "speaker": voice,
                # v3, matching TTSEngine.synthesize in main.py. This said v2,
                # so any asset it produced came from a different model than
                # the live voice — an audible mismatch mid-call.
                "model": "bulbul:v3",
                # Telephony is 8kHz G.711. Generating at the default 22050
                # forces FreeSWITCH to resample every playback.
                "speech_sample_rate": 8000,
                "enable_preprocessing": True,
            },
        )
        r.raise_for_status()
        return base64.b64decode(r.json()["audios"][0])

async def main():
    print(f"Generating TRAI disclosure for {len(VOICES)} voices…")
    for voice in VOICES:
        try:
            wav = await synthesize(voice)
            out = ASSETS_DIR / f"trai_disclosure_{voice}.wav"
            out.write_bytes(wav)
            print(f"  ✓ {out.name}  ({len(wav):,} bytes)")
        except Exception as e:
            print(f"  ✗ {voice}: {e}", file=sys.stderr)
    print(f"\nDone. Files in {ASSETS_DIR}")

if __name__ == "__main__":
    asyncio.run(main())
