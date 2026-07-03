"""
Generate the landing page's demo call clip via Sarvam TTS — a short,
scripted Telugu clinic-booking call matching exactly what the landing page
copy promises ("appointment booked, WhatsApp confirmation sent, all in
Telugu"). Two distinct voices (caller vs. Nikki) so it sounds like an
actual conversation, not one voice talking to itself.

This is a SCRIPTED demo, not a captured real call — today's real test
calls are AES-256 encrypted and were adversarial testing, not a clean
sales clip (background noise, "cut the call" mid-conversation, etc.).
If you'd rather use a real recorded call instead, that needs a separate
decryption + editing step — this script is the fast path to something
usable today.

Output format is WAV, not MP3 — browsers play WAV natively via <audio>,
and generating MP3 would need an ffmpeg dependency this script doesn't
assume is installed. web/app/page.tsx's DemoPlayer was updated to expect
sample-call.wav accordingly.

Usage:
  python3 scripts/generate_landing_demo.py

Then upload the output file to a PUBLIC Supabase Storage bucket (this one
needs to be public, unlike the recordings bucket — it's marketing content)
and set NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL in Vercel to that bucket's public
URL. Exact steps printed at the end of the script.
"""
import asyncio
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

# (speaker_voice, text) — caller uses a distinct male voice from Nikki's
# Clinic persona (vidya) so the two sides are clearly different people.
SCRIPT = [
    ("hitesh", "నమస్కారం, నాకు రేపు ఉదయం అపాయింట్‌మెంట్ కావాలి."),
    ("vidya",  "నమస్కారం! Sri Sai Diagnostics కి స్వాగతం. తప్పకుండా, రేపు ఉదయం "
               "10 గంటలకు అపాయింట్‌మెంట్ ఇవ్వగలను. మీ పేరు మరియు ఫోన్ నంబర్ చెప్పగలరా?"),
    ("hitesh", "నా పేరు రాజేష్, నంబర్ 9876543210."),
    ("vidya",  "ధన్యవాదాలు రాజేష్ గారు. మీ అపాయింట్‌మెంట్ రేపు ఉదయం 10 గంటలకు "
               "కన్ఫర్మ్ అయ్యింది. WhatsApp లో కన్ఫర్మేషన్ మెసేజ్ పంపుతున్నాను. ధన్యవాదాలు!"),
]

TTS_SR = 22050
GAP_MS = 450  # brief pause between speaker turns, natural call pacing

OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "assets", "landing_demo", "sample-call.wav")


async def synth_line(client: httpx.AsyncClient, voice: str, text: str) -> bytes:
    r = await client.post(
        "https://api.sarvam.ai/text-to-speech",
        headers={"api-subscription-key": SARVAM_KEY},
        json={"inputs": [text], "target_language_code": "te-IN",
              "speaker": voice, "model": "bulbul:v2"},
        timeout=30,
    )
    r.raise_for_status()
    wav_bytes = base64.b64decode(r.json()["audios"][0])
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        pcm = wf.readframes(wf.getnframes())
        sr = wf.getframerate()
    if sr != TTS_SR:
        pcm, _ = audioop.ratecv(pcm, 2, 1, sr, TTS_SR, None)
    return pcm


async def main():
    print("Generating landing page demo call (4 lines, 2 voices)...")
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    silence_gap = b"\x00\x00" * int(TTS_SR * GAP_MS / 1000)
    combined = bytearray()

    async with httpx.AsyncClient() as client:
        for i, (voice, text) in enumerate(SCRIPT):
            print(f"  [{i+1}/{len(SCRIPT)}] {voice}: {text[:40]}...")
            pcm = await synth_line(client, voice, text)
            combined.extend(pcm)
            if i < len(SCRIPT) - 1:
                combined.extend(silence_gap)

    with wave.open(OUT_PATH, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(TTS_SR)
        wf.writeframes(bytes(combined))

    duration_s = len(combined) / 2 / TTS_SR
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\nOK: {OUT_PATH}")
    print(f"    {duration_s:.1f}s, {size_kb:.0f} KB")

    print("\n" + "=" * 60)
    print("NEXT STEPS to make this live on the landing page:")
    print("=" * 60)
    print(f"""
1. Upload {os.path.basename(OUT_PATH)} to a PUBLIC Supabase Storage bucket
   (this one is marketing content, unlike the private recordings bucket):

   In Supabase dashboard -> Storage -> create bucket "landing-assets"
   (Public bucket: ON) -> upload sample-call.wav to it.

2. Get the public URL — it'll look like:
   https://wnawozdmmxuziucavngw.supabase.co/storage/v1/object/public/landing-assets

3. In Vercel, set on the `web` project:
   NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL=https://wnawozdmmxuziucavngw.supabase.co/storage/v1/object/public/landing-assets

4. Redeploy `web`. The landing page's "Watch 60s Demo" section will then
   play this clip instead of showing "coming soon".
""")


if __name__ == "__main__":
    asyncio.run(main())
