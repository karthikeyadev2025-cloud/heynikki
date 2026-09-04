"""Sarvam STT and the outbound-campaign prompt.

Lifted out of app/exotel/bridge.py when the Exotel telephony path was
removed, and named for the website widget that used to live here.

handle_widget_ws and gemini_reply_streaming have since been deleted: they
were lifted across WITHOUT the bridge-local names they depended on
(Session, SYSTEM_PROMPT, DEFAULT_VOICE, _handle_utterance, GEMINI_KEY, cb,
io, wave, PIPE_SR, MAX_HISTORY_TURNS, WebSocketDisconnect), so every code
path in them raised NameError on first use, and gemini_reply_streaming also
pinned gemini-2.5-flash, which the API now refuses as "no longer supported".
Nothing called either one — the website's live voice path is the API
server's /api/public/voice-turn into main.py's /api/v1/browser/chat.

What remains is imported and working: build_outbound_prompt (main.py) and
sarvam_stt + sarvam_tts + LANGUAGE_NAMES
(scripts/test_language_detection.py).
"""

import base64
import io
import logging
import os
import wave

import httpx

from app import circuit_breaker as cb

log = logging.getLogger("nikki")

SARVAM_KEY     = os.environ.get("SARVAM_API_KEY", "")
# 16kHz: what Sarvam's STT expects, and what the browser sends after
# resampling. Named PIPE_SR because the whole pipeline runs at this rate.
PIPE_SR        = 16000
LANGUAGE_NAMES = {"te-IN": "Telugu", "hi-IN": "Hindi", "en-IN": "English"}

def build_outbound_prompt(script: str, first_name: str = None) -> str:
    """System prompt for an outbound campaign call — wraps the campaign's
    script with the language marker and compliance rules. The TRAI
    disclosure ("this call is handled by an automated AI assistant") is
    played as audio BEFORE the conversation starts (see the outbound
    branch in handle_exotel_ws), so this prompt reinforces it rather than
    repeating it every turn — but the AI must never claim to be human if
    asked directly, regardless of what the script says."""
    name_line = f"- The recipient's name is {first_name}, use it naturally.\n" if first_name else ""
    return f"""మీరు ఒక professional Telugu AI voice assistant, ఔట్‌బౌండ్ కాల్ చేస్తున్నారు.
Rules:
__LANGUAGE_RULE__
- SHORT responses (1-2 sentences). Phone call, not chat.
- If asked directly whether you're human or AI, always say AI assistant, never claim otherwise. Don't bring it up yourself.
- If the recipient asks to be removed from future calls, sounds unwilling to talk, or asks you to stop, acknowledge respectfully and end the call — do not persist or re-pitch.
- YOU called THEM. Never say or imply they called you, and never mention how many times you have spoken before.
- Promise only what the script says. Never invent things to send (a PDF, a brochure, a document) — if they ask, say the details come as a WhatsApp message.
- Never ask a question in the same reply as a goodbye. If you are asking, you are not closing.
{name_line}Your goal for this call:
{script}

[ENDING THE CALL]
When the conversation is over — they have what they need, they said bye, they asked you to cut the call, or they are not interested — say goodbye ONCE and, on the same line, add the token END_CALL. It is never spoken; it tells the line to hang up after your goodbye finishes. Do not keep saying bye and waiting: one goodbye, then END_CALL.
"""

async def sarvam_stt(pcm_16k: bytes) -> tuple:
    """Returns (transcript, detected_language_code). language_code="unknown"
    triggers Sarvam's automatic language detection — see the "Live language
    switching" comment block above for why. Detected code falls back to ""
    on any failure; callers should keep the session's previous language in
    that case rather than resetting to a default."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(PIPE_SR)
        wf.writeframes(pcm_16k)

    if not cb.sarvam_stt_breaker.allow_request():
        log.warning("sarvam_stt: circuit OPEN, skipping live call")
        return "", ""

    async with httpx.AsyncClient(timeout=20) as c:
        try:
            r = await c.post("https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": SARVAM_KEY},
                files={"file": ("audio.wav", buf.getvalue(), "audio/wav")},
                data={"language_code":"unknown", "model":"saarika:v2.5"})
        except Exception as e:
            log.error("STT request failed: %s", e)
            cb.sarvam_stt_breaker.record_failure()
            return "", ""
        if r.status_code != 200:
            log.error("STT %s: %s", r.status_code, r.text[:150])
            cb.sarvam_stt_breaker.record_failure()
            return "", ""
        cb.sarvam_stt_breaker.record_success()
        body = r.json()
        return body.get("transcript", "").strip(), body.get("language_code", "")


async def sarvam_tts(text: str, voice: str = "priya",
                     target_language_code: str = "te-IN") -> bytes:
    """Synthesise `text` and return RAW 22.05kHz mono 16-bit PCM.

    Restored because scripts/test_language_detection.py imports it and had
    been failing at import ever since it was dropped from this module. It
    returns raw PCM with the WAV header stripped, which is the shape that
    script documents and expects — it re-wraps the frames itself.

    22050, not the phone path's 8000: this generates verification clips for
    STT, so there is no reason to hand the recogniser narrowband audio.
    """
    if not cb.sarvam_tts_breaker.allow_request():
        log.warning("sarvam_tts: circuit OPEN, skipping live call")
        return b""

    async with httpx.AsyncClient(timeout=30) as c:
        try:
            r = await c.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": SARVAM_KEY,
                         "Content-Type": "application/json"},
                json={
                    "inputs": [text],
                    "target_language_code": target_language_code,
                    "speaker": voice,
                    "model": "bulbul:v3",
                    "pace": 1.0,
                    "speech_sample_rate": 22050,
                    "enable_preprocessing": True,
                },
            )
        except Exception as e:  # noqa: BLE001
            log.error("TTS request failed: %s", e)
            cb.sarvam_tts_breaker.record_failure()
            return b""
        if r.status_code != 200:
            log.error("TTS %s: %s", r.status_code, r.text[:150])
            cb.sarvam_tts_breaker.record_failure()
            return b""
        cb.sarvam_tts_breaker.record_success()

        audio_b64 = (r.json().get("audios") or [""])[0]
        if not audio_b64:
            return b""
        wav_bytes = base64.b64decode(audio_b64)

    # Strip the WAV container: the caller re-wraps the frames with its own
    # header, and handing it a full WAV would nest one header inside another.
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            return wf.readframes(wf.getnframes())
    except wave.Error as e:
        log.error("TTS returned audio that is not a readable WAV: %s", e)
        return b""
