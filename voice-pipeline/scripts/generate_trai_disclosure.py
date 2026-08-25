"""
Pre-generate TRAI mandatory AI-disclosure WAV via Sarvam Bulbul TTS.
Run once per deployment. Output goes to voice-pipeline/assets/
"""
import os, sys, asyncio, httpx, base64, pathlib

SARVAM_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_KEY:
    sys.exit("ERROR: SARVAM_API_KEY not set.")

DISCLOSURE_TEXT = (
    "నమస్కారం. ఈ call ఒక automated AI assistant ద్వారా handle అవుతోంది. "
    "మీరు ఏ సమయంలో అయినా 'human' అని చెబితే మన staff కి transfer చేస్తాను."
)

# Must cover EVERY speaker sku_voices in main.py can select, or that SKU
# silently falls through to a runtime TTS round-trip at call start — and to
# no disclosure at all if Sarvam is slow or down, which is a TRAI breach,
# not a cosmetic miss. "aditya" was missing here, so the real_estate SKU
# never had an asset.
VOICES = ["priya", "shreya", "aditya", "kavya"]

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
