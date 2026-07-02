"""
Jovio — Telugu Voice Pipeline
FastAPI + LiveKit Agents + Sarvam STT/TTS + Gemini LLM
Run: uvicorn main:app --host 0.0.0.0 --port 8000
"""

import os
import json
import asyncio
import logging
import pathlib
import base64
import secrets
import httpx
from datetime import datetime
from typing import Optional

# ─── Sentry — optional, no-op if SENTRY_DSN env not set ───
# Init BEFORE FastAPI/LiveKit imports so the SDK can wrap them.
_SENTRY_DSN = os.environ.get("SENTRY_DSN")
if _SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration

        sentry_sdk.init(
            dsn=_SENTRY_DSN,
            environment=os.environ.get("JOVIO_ENV", "development"),
            release=os.environ.get("RELEASE_SHA"),
            traces_sample_rate=0.1,
            integrations=[
                FastApiIntegration(),
                # Capture WARNING+ as breadcrumbs, ERROR+ as events
                LoggingIntegration(level=logging.WARNING, event_level=logging.ERROR),
            ],
        )
    except Exception as e:
        # Sentry init failed — log and continue. Pipeline must stay up.
        print(f"[sentry] init failed: {e}")

# AES-256-GCM for call recording encryption at rest.
# Lazy import — pipeline still boots if cryptography not installed yet
# (CI/lint environments), only fails when actually encrypting a recording.
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    _HAS_CRYPTO = True
except ImportError:
    _HAS_CRYPTO = False

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from livekit import rtc
from livekit.agents import JobContext, WorkerOptions, cli
# VoicePipelineAgent not used directly in HTTP mode
# silero VAD not needed in HTTP mode

# ── ENV ──────────────────────────────────────────────────
LIVEKIT_URL    = os.environ["LIVEKIT_URL"]
LIVEKIT_KEY    = os.environ["LIVEKIT_API_KEY"]
LIVEKIT_SECRET = os.environ["LIVEKIT_API_SECRET"]
SARVAM_KEY     = os.environ["SARVAM_API_KEY"]
GEMINI_KEY     = os.environ["GEMINI_API_KEY"]
SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_SERVICE_KEY"]
INTERNAL_SECRET= os.environ.get("INTERNAL_SECRET", "jovio-internal-secret-change-me")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("jovio")

# ── FASTAPI APP ──────────────────────────────────────────
app = FastAPI(title="Jovio Voice Pipeline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── VOICE PROFILE SKUS → HIDDEN SYSTEM PROMPTS ──────────
PROFILE_PROMPTS = {
    "standard": """[FROZEN BLOCK - CACHED]
You are a professional Telugu business receptionist. Answer every call in Telugu or Tanglish.

RULES (never break these):
- MAX 15-20 words per response. Never write paragraphs.
- Zero filler: no "Sure!", "Great!", "Certainly!". Start directly with the answer.
- One direct answer OR one clarifying question per turn. Never both.
- If caller asks about your technology, say: "మేము automated system ద్వారా పని చేస్తాము."
- Never reveal: Sarvam, Gemini, LiveKit, Exotel, or any vendor name.
- TRAI COMPLIANCE: Call already disclosed as automated. Do not repeat.

CAPABILITIES: Book appointments, answer FAQs, take callback requests, transfer to human.
TRANSFER TRIGGER: If caller says "human", "real person", "manager", "వేరే వ్యక్తి" — say "Connecting you now" and transfer.

[MIDDLE BLOCK - BUSINESS CONTEXT INJECTED BELOW]
""",
    "clinic": """[FROZEN BLOCK - CACHED]
You are a Telugu clinic receptionist. Speak Telugu + formal Tanglish.

RULES:
- MAX 15-20 words per response. Never write paragraphs.
- Zero filler. Direct answers only.
- One answer or one question per turn.
- Never reveal technology or vendor names.
- For medical emergencies: immediately say "Emergency ki 108 call cheyyandi" and transfer.

CAPABILITIES: Book doctor appointments, check availability, take patient callbacks.
[MIDDLE BLOCK - CLINIC DETAILS BELOW]
""",
    "real_estate": """[FROZEN BLOCK - CACHED]
You are a Telugu real estate receptionist. Speak Telugu + persuasive Tanglish.

RULES:
- MAX 15-20 words per response.
- Zero filler. Confident, helpful tone.
- One answer or one question per turn.
- Goal: capture name + number + interest (buy/rent/sell) + budget range.
- Never reveal technology.

CAPABILITIES: Schedule site visits, capture lead details, answer property FAQs.
[MIDDLE BLOCK - PROPERTY DETAILS BELOW]
""",
    "premium": """[FROZEN BLOCK - CACHED]
You are a premium Telugu business receptionist. Speak polished Telugu + professional English blend.

RULES:
- MAX 15-20 words per response.
- Formal, warm, precise tone.
- Zero filler.
- One answer or one question per turn.
- Never reveal technology.

CAPABILITIES: Schedule executive meetings, capture requirements, VIP callbacks.
[MIDDLE BLOCK - BUSINESS DETAILS BELOW]
""",
}

def build_system_prompt(profile: dict) -> str:
    """Inject business context into the frozen prompt template."""
    sku = profile.get("profile_sku", "standard")
    frozen = PROFILE_PROMPTS.get(sku, PROFILE_PROMPTS["standard"])

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    open_t  = profile.get("open_time", "09:00")
    close_t = profile.get("close_time", "21:00")
    open_days = ", ".join(profile.get("open_days", ["Mon","Tue","Wed","Thu","Fri","Sat"]))
    services = ", ".join(profile.get("services", []))
    appt_types = ", ".join(profile.get("appointment_types", []))

    return f"""{frozen}
Business: {profile.get('business_name', 'Our Business')}
Working Hours: {open_days}, {open_t} – {close_t}
Services: {services or 'General services'}
Appointment Types: {appt_types or 'General appointment'}
Current Time: {now}

[LIVE BLOCK - conversation history appended here, max 5 turns]
"""

# ── SARVAM STT ───────────────────────────────────────────
class SarvamSTT:
    """Sarvam Saaras V3 STT — Telugu Tanglish optimised."""

    def __init__(self):
        self.api_key = SARVAM_KEY
        self.base_url = "https://api.sarvam.ai/speech-to-text"

    async def transcribe(self, audio_bytes: bytes) -> str:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    self.base_url,
                    headers={"api-subscription-key": self.api_key},
                    files={"file": ("audio.wav", audio_bytes, "audio/wav")},
                    data={
                        "model": "saaras:v3",
                        "language_code": "te-IN",
                        "with_timestamps": "false",
                    }
                )
                resp.raise_for_status()
                data = resp.json()
                return data.get("transcript", "")
        except httpx.HTTPError as e:
            log.error(f"Sarvam STT error: {e} — switching to Google fallback")
            return await self._google_fallback(audio_bytes)
        except Exception as e:
            log.error(f"Sarvam STT unexpected error: {e}")
            return ""

    async def _google_fallback(self, audio_bytes: bytes) -> str:
        """Google Cloud STT Chirp 2 — fallback for Sarvam failures."""
        try:
            import base64
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    "https://speech.googleapis.com/v1/speech:recognize",
                    params={"key": os.environ.get("GOOGLE_STT_KEY", "")},
                    json={
                        "config": {
                            "encoding": "LINEAR16",
                            "sampleRateHertz": 8000,
                            "languageCode": "te-IN",
                            "alternativeLanguageCodes": ["en-IN"],
                            "model": "chirp_2",
                        },
                        "audio": {"content": base64.b64encode(audio_bytes).decode()}
                    }
                )
                if resp.status_code == 200:
                    results = resp.json().get("results", [])
                    if results:
                        return results[0]["alternatives"][0]["transcript"]
        except Exception as e:
            log.error(f"Google STT fallback also failed: {e}")
        return ""


# ── SARVAM TTS ───────────────────────────────────────────
class SarvamTTS:
    """Sarvam Bulbul V3 TTS — 8kHz telephony, Mulaw output."""

    def __init__(self):
        self.api_key = SARVAM_KEY

    async def synthesize(self, text: str, speaker: str = "meera") -> bytes:
        # Enforce 20-word cap before synthesis
        words = text.split()
        if len(words) > 20:
            text = " ".join(words[:20])
            log.warning(f"TTS word cap enforced: truncated to 20 words")

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    "https://api.sarvam.ai/text-to-speech",
                    headers={
                        "api-subscription-key": self.api_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "inputs": [text],
                        "target_language_code": "te-IN",
                        "speaker": speaker,
                        "model": "bulbul:v3",
                        "pitch": 0,
                        "pace": 1.1,
                        "loudness": 1.4,
                        "speech_sample_rate": 8000,
                        "enable_preprocessing": True,
                        "eng_interpolation_wt": 100,
                    }
                )
                resp.raise_for_status()
                import base64
                data = resp.json()
                audio_b64 = data.get("audios", [""])[0]
                return base64.b64decode(audio_b64)
        except httpx.HTTPError as e:
            log.error(f"Sarvam TTS error: {e} — switching to Azure fallback")
            return await self._azure_fallback(text)
        except Exception as e:
            log.error(f"Sarvam TTS unexpected: {e}")
            return b""

    async def _azure_fallback(self, text: str) -> bytes:
        """Azure te-IN-ShrutiNeural — TTS fallback."""
        try:
            azure_key    = os.environ.get("AZURE_SPEECH_KEY", "")
            azure_region = os.environ.get("AZURE_SPEECH_REGION", "centralindia")
            ssml = f"""<speak version='1.0' xml:lang='te-IN'>
  <voice name='te-IN-ShrutiNeural'>{text}</voice>
</speak>"""
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"https://{azure_region}.tts.speech.microsoft.com/cognitiveservices/v1",
                    headers={
                        "Ocp-Apim-Subscription-Key": azure_key,
                        "Content-Type": "application/ssml+xml",
                        "X-Microsoft-OutputFormat": "riff-8khz-16bit-mono-pcm",
                    },
                    content=ssml.encode()
                )
                if resp.status_code == 200:
                    return resp.content
        except Exception as e:
            log.error(f"Azure TTS fallback failed: {e}")
        return b""


# ── GEMINI LLM ───────────────────────────────────────────
class GeminiLLM:
    """Gemini 2.5 Flash with prompt caching + 4-turn rolling window."""

    def __init__(self):
        self.api_key = GEMINI_KEY
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent"

    async def generate(self, system_prompt: str, history: list[dict]) -> str:
        # Keep only last 4 turns (rolling window cost control)
        recent = history[-8:] if len(history) > 8 else history

        parts_history = []
        for turn in recent:
            parts_history.append({
                "role": "user" if turn["role"] == "user" else "model",
                "parts": [{"text": turn["content"]}]
            })

        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": parts_history,
            "generationConfig": {
                "maxOutputTokens": 60,
                "temperature": 0.3,
                "topP": 0.8,
            }
        }

        try:
            # AQ. keys (new format since June 19 2026) use Bearer auth
            # AIza keys (old format) use ?key= query param
            is_auth_key = self.api_key.startswith(("AQ.", "IQ.", "EQ."))
            if is_auth_key:
                headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}
                params = {}
            else:
                headers = {"Content-Type": "application/json"}
                params = {"key": self.api_key}
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(
                    self.base_url,
                    headers=headers,
                    params=params,
                    json=payload
                )
                resp.raise_for_status()
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        text = parts[0].get("text", "").strip()
                        # Vendor name filter — strip before TTS
                        for vendor in ["Sarvam", "Gemini", "LiveKit", "Exotel", "Plivo", "supabase", "OpenAI"]:
                            text = text.replace(vendor, "our system")
                        return text
        except httpx.HTTPError as e:
            log.error(f"Gemini error: {e} — trying GPT-4o-mini fallback")
            return await self._openai_fallback(system_prompt, recent)
        except Exception as e:
            log.error(f"Gemini unexpected: {e}")

        return "ఒక్క నిమిషం — మళ్ళీ చెప్పగలరా?"

    async def _openai_fallback(self, system_prompt: str, history: list) -> str:
        """GPT-4o-mini fallback if Gemini fails."""
        try:
            openai_key = os.environ.get("OPENAI_API_KEY", "")
            if not openai_key:
                return "ఒక్క నిమిషం."
            messages = [{"role": "system", "content": system_prompt}]
            messages.extend(history)
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json={
                        "model": "gpt-4o-mini",
                        "messages": messages,
                        "max_tokens": 60,
                        "temperature": 0.3,
                    }
                )
                if resp.status_code == 200:
                    return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            log.error(f"GPT-4o-mini fallback failed: {e}")
        return "ఒక్క నిమిషం."


# ── SUPABASE CLIENT ──────────────────────────────────────
class SupabaseClient:
    def __init__(self):
        self.url = SUPABASE_URL
        self.key = SUPABASE_KEY
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    async def get_voice_profile(self, did_number: str) -> Optional[dict]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{self.url}/rest/v1/voice_profiles",
                    headers=self.headers,
                    params={"did_number": f"eq.{did_number}", "select": "*", "limit": "1"}
                )
                data = resp.json()
                return data[0] if data else None
        except Exception as e:
            log.error(f"Supabase get_voice_profile: {e}")
            return None

    async def save_call(self, call_data: dict) -> Optional[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{self.url}/rest/v1/calls",
                    headers={**self.headers, "Prefer": "return=representation"},
                    json=call_data
                )
                data = resp.json()
                return data[0]["id"] if data else None
        except Exception as e:
            log.error(f"Supabase save_call: {e}")
            return None

    async def update_call(self, call_id: str, updates: dict):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.patch(
                    f"{self.url}/rest/v1/calls",
                    headers=self.headers,
                    params={"id": f"eq.{call_id}"},
                    json=updates
                )
        except Exception as e:
            log.error(f"Supabase update_call: {e}")

    async def save_appointment(self, appt_data: dict) -> Optional[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{self.url}/rest/v1/appointments",
                    headers={**self.headers, "Prefer": "return=representation"},
                    json=appt_data
                )
                data = resp.json()
                return data[0]["id"] if data else None
        except Exception as e:
            log.error(f"Supabase save_appointment: {e}")
            return None

    async def log_wa_dispatch(self, log_data: dict):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{self.url}/rest/v1/wa_dispatch_log",
                    headers=self.headers,
                    json=log_data
                )
        except Exception as e:
            log.error(f"Supabase wa_log: {e}")

    async def upload_recording(self, path: str, blob: bytes):
        """Upload encrypted recording bytes to Supabase storage bucket.

        Bucket name is configurable via SUPABASE_RECORDINGS_BUCKET (defaults
        to 'recordings'). Bucket should be created as PRIVATE — recordings
        are AES-256-GCM encrypted but defense-in-depth applies.
        """
        bucket = os.environ.get("SUPABASE_RECORDINGS_BUCKET", "recordings")
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.url}/storage/v1/object/{bucket}/{path}",
                    headers={
                        **self.headers,
                        "Content-Type":  "application/octet-stream",
                        "x-upsert":      "true",
                    },
                    content=blob,
                )
                if resp.status_code >= 300:
                    log.error(f"Supabase upload {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            log.error(f"Supabase upload_recording: {e}")


# ── WHATSAPP ─────────────────────────────────────────────
async def send_whatsapp(to: str, message: str, wa_number: str, tenant_id: str):
    """Send WhatsApp via 360dialog. wa_number = client's WhatsApp number."""
    wa_key = os.environ.get("WATI_API_KEY", "")
    wa_url = os.environ.get("WATI_API_URL", "")
    if not wa_key or not wa_url:
        log.warning("WhatsApp not configured — skipping")
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{wa_url}/api/v1/sendSessionMessage/{to}",
                headers={"Authorization": f"Bearer {wa_key}"},
                json={"messageText": message}
            )
            return resp.status_code in (200, 201)
    except Exception as e:
        log.error(f"WhatsApp send failed: {e}")
        return False


# ── VOICE AGENT SESSION ───────────────────────────────────
class JovioAgent:
    """Complete Telugu voice agent session handler."""

    TRAI_DISCLOSURE = "నమస్కారం. ఈ call automated assistant ద్వారా handle అవుతోంది."

    def __init__(self, profile: dict, caller_number: str):
        self.profile     = profile
        self.caller_num  = caller_number
        self.stt         = SarvamSTT()
        self.tts         = SarvamTTS()
        self.llm         = GeminiLLM()
        self.db          = SupabaseClient()
        self.history     : list[dict] = []
        self.call_id     : Optional[str] = None
        self.intent      : str = "unknown"
        self.transcript  : list[dict] = []
        self.system_prompt = build_system_prompt(profile)

        # Voice speaker based on profile SKU
        # NOTE: must be real bulbul:v2 speaker IDs — see SKU_VOICE in
        # app/exotel/bridge.py for the verified source of truth. This dict
        # previously used meera/pavithra/arvind, none of which exist in
        # Sarvam's bulbul:v2 or v3 catalogs.
        sku_voices = {
            "standard":    "anushka",
            "clinic":      "vidya",
            "real_estate": "karun",
            "premium":     "manisha",
        }
        self.voice = sku_voices.get(profile.get("profile_sku","standard"), "anushka")

    async def on_call_start(self) -> bytes:
        """Called when call connects. Play TRAI disclosure first.

        Loads pre-recorded disclosure WAV if available (saves ~500ms +
        Sarvam credits per call). Falls back to runtime TTS synthesis if
        the WAV is missing (dev environments, or before
        generate_trai_disclosure.py has been run).
        """
        self.call_id = await self.db.save_call({
            "tenant_id":        self.profile["tenant_id"],
            "voice_profile_id": self.profile["id"],
            "caller_number":    self.caller_num,
            "direction":        "inbound",
            "status":           "active",
        })
        log.info(f"Call started: {self.call_id} from {self.caller_num}")

        # TRAI mandatory disclosure — non-skippable. Prefer pre-recorded.
        assets_dir = pathlib.Path(__file__).resolve().parent / "assets"
        wav_path   = assets_dir / f"trai_disclosure_{self.voice}.wav"
        if wav_path.exists():
            log.info(f"TRAI disclosure: loading pre-recorded {wav_path.name}")
            return wav_path.read_bytes()

        log.warning(
            f"TRAI WAV not found at {wav_path} — falling back to runtime TTS. "
            f"Run voice-pipeline/scripts/generate_trai_disclosure.py to pre-gen."
        )
        return await self.tts.synthesize(self.TRAI_DISCLOSURE, self.voice)

    async def on_speech(self, audio_bytes: bytes) -> bytes:
        """Process one turn: STT → detect intent → LLM → TTS."""
        try:
            user_text = await self.stt.transcribe(audio_bytes)
            if not user_text.strip():
                return await self.tts.synthesize("మళ్ళీ చెప్పగలరా?", self.voice)

            log.info(f"STT: {user_text}")
            self.transcript.append({"role": "user", "content": user_text, "ts": datetime.now().isoformat()})
            self.history.append({"role": "user", "content": user_text})

            # Intent detection (keyword based, fast, no extra LLM call)
            self.intent = self._detect_intent(user_text)

            # Check for transfer trigger
            if self.intent == "transfer":
                return await self._handle_transfer()

            # Generate response
            response = await self.llm.generate(self.system_prompt, self.history)
            log.info(f"LLM: {response}")

            self.history.append({"role": "assistant", "content": response})
            self.transcript.append({"role": "assistant", "content": response, "ts": datetime.now().isoformat()})

            # If appointment booked, handle async (don't delay audio)
            if self.intent == "appointment":
                asyncio.create_task(self._handle_appointment_booking(user_text, response))

            audio = await self.tts.synthesize(response, self.voice)
            return audio

        except Exception as e:
            log.error(f"on_speech error: {e}")
            return await self.tts.synthesize("క్షమించండి, technical issue. మళ్ళీ try చేయండి.", self.voice)

    async def save_recording(self, raw_audio_bytes: bytes) -> Optional[str]:
        """Encrypt call recording with AES-256-GCM and upload to Supabase storage.

        Layout of stored object (binary):
            [ 12-byte nonce ][ ciphertext + GCM tag ]

        Decryption key is per-tenant, sourced from env JOVIO_RECORDING_KEY_<TENANT>
        or a single fallback JOVIO_RECORDING_KEY. Key must be 32 bytes base64-encoded.

        Returns the Supabase storage path or None on failure (never blocks call cleanup).
        """
        if not raw_audio_bytes:
            return None
        if not _HAS_CRYPTO:
            log.error("cryptography library not installed; skipping recording encryption")
            return None

        tenant_id = self.profile.get("tenant_id", "unknown")
        key_b64 = (
            os.getenv(f"JOVIO_RECORDING_KEY_{tenant_id}")
            or os.getenv("JOVIO_RECORDING_KEY")
        )
        if not key_b64:
            log.error("JOVIO_RECORDING_KEY env not set; skipping recording")
            return None

        try:
            key = base64.b64decode(key_b64)
            if len(key) != 32:
                log.error(f"Recording key must decode to 32 bytes, got {len(key)}")
                return None

            nonce = secrets.token_bytes(12)
            aesgcm = AESGCM(key)
            ciphertext = aesgcm.encrypt(nonce, raw_audio_bytes, associated_data=self.call_id.encode())

            blob = nonce + ciphertext
            path = f"recordings/{tenant_id}/{self.call_id}.wav.enc"

            await self.db.upload_recording(path, blob)
            log.info(
                f"Recording encrypted+uploaded: {path} "
                f"({len(raw_audio_bytes):,}B → {len(blob):,}B ciphertext)"
            )
            return path
        except Exception as e:
            log.error(f"save_recording failed: {e}")
            return None

    async def on_call_end(self, duration_seconds: int, recording_bytes: Optional[bytes] = None):
        """Save full transcript, update call record, encrypt+store recording."""
        try:
            recording_path = None
            if recording_bytes:
                recording_path = await self.save_recording(recording_bytes)

            update = {
                "status":           "completed",
                "duration_seconds": duration_seconds,
                "transcript":       self.transcript,
                "intent":           self.intent,
            }
            if recording_path:
                update["recording_path"] = recording_path

            await self.db.update_call(self.call_id, update)
            log.info(f"Call ended: {self.call_id}, duration: {duration_seconds}s")
        except Exception as e:
            log.error(f"on_call_end error: {e}")

    def _detect_intent(self, text: str) -> str:
        text_lower = text.lower()
        transfer_words = ["human","person","manager","staff","real","వేరే","నిజంగా","మనిషి","transfer"]
        appt_words     = ["appointment","appt","book","schedule","date","time","booking","అపాయింట్మెంట్","బుక్"]
        callback_words = ["call back","callback","later","తర్వాత","మళ్ళీ"]
        emergency_words= ["emergency","urgent","108","ambulance","accident"]

        if any(w in text_lower for w in emergency_words): return "emergency"
        if any(w in text_lower for w in transfer_words):  return "transfer"
        if any(w in text_lower for w in appt_words):      return "appointment"
        if any(w in text_lower for w in callback_words):  return "callback"
        return "enquiry"

    async def _handle_transfer(self) -> bytes:
        """Warm transfer to client's staff."""
        msg = "ఒక్క నిమిషం — మీకు staff కి connect చేస్తున్నాను."
        audio = await self.tts.synthesize(msg, self.voice)
        # Signal to LiveKit to initiate SIP transfer
        # Actual transfer logic handled by LiveKit dispatch rules
        return audio

    async def _handle_appointment_booking(self, user_text: str, response: str):
        """Extract appointment details and save + send WhatsApp."""
        try:
            appt_id = await self.db.save_appointment({
                "tenant_id":        self.profile["tenant_id"],
                "voice_profile_id": self.profile["id"],
                "call_id":          self.call_id,
                "caller_number":    self.caller_num,
                "status":           "confirmed",
            })

            # Send WhatsApp confirmation
            if self.profile.get("whatsapp_number"):
                wa_msg = (
                    f"నమస్కారం! మీ appointment {self.profile.get('business_name','')} లో "
                    f"confirm అయింది. మేము soon మీకు details పంపుతాం. ధన్యవాదాలు!"
                )
                sent = await send_whatsapp(
                    self.caller_num,
                    wa_msg,
                    self.profile["whatsapp_number"],
                    self.profile["tenant_id"]
                )
                if appt_id:
                    await self.db.update_call(self.call_id, {
                        "appointment_created": True,
                        "wa_sent": sent,
                    })
                if sent:
                    await self.db.log_wa_dispatch({
                        "tenant_id":        self.profile["tenant_id"],
                        "voice_profile_id": self.profile["id"],
                        "call_id":          self.call_id,
                        "appointment_id":   appt_id,
                        "message_type":     "confirmation",
                        "to_number":        self.caller_num,
                        "message_body":     wa_msg,
                        "status":           "sent" if sent else "failed",
                    })
        except Exception as e:
            log.error(f"Appointment booking error: {e}")


# ── FASTAPI ROUTES ────────────────────────────────────────

class InboundCallRequest(BaseModel):
    caller_number: str
    did_number: str
    call_sid: Optional[str] = None

class SpeechRequest(BaseModel):
    call_id: str
    audio_b64: str
    did_number: str
    caller_number: str

@app.get("/health")
async def health():
    from app.exotel import circuit_breaker as _cb
    return {
        "status": "ok",
        "service": "jovio-voice-pipeline",
        "timestamp": datetime.now().isoformat(),
        "circuit_breakers": _cb.all_status(),
    }

@app.post("/api/v1/call/inbound")
async def handle_inbound(req: InboundCallRequest, x_internal_secret: str = Header(None)):
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    db = SupabaseClient()
    profile = await db.get_voice_profile(req.did_number)

    if not profile:
        log.warning(f"No voice profile for DID: {req.did_number}")
        raise HTTPException(status_code=404, detail="Voice profile not found for this number")

    agent = JovioAgent(profile, req.caller_number)
    disclosure_audio = await agent.on_call_start()

    import base64
    return {
        "call_id":        agent.call_id,
        "voice_profile":  profile.get("profile_sku"),
        "business_name":  profile.get("business_name"),
        "disclosure_audio_b64": base64.b64encode(disclosure_audio).decode() if disclosure_audio else None,
        "status": "active"
    }

@app.post("/api/v1/call/speech")
async def handle_speech(req: SpeechRequest, x_internal_secret: str = Header(None)):
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    import base64
    db = SupabaseClient()
    profile = await db.get_voice_profile(req.did_number)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    agent = JovioAgent(profile, req.caller_number)
    agent.call_id = req.call_id

    audio_bytes = base64.b64decode(req.audio_b64)
    response_audio = await agent.on_speech(audio_bytes)

    return {
        "response_audio_b64": base64.b64encode(response_audio).decode() if response_audio else None,
        "intent": agent.intent,
        "turn_count": len(agent.history),
    }

@app.post("/api/v1/call/end")
async def handle_call_end(
    call_id: str,
    duration_seconds: int,
    x_internal_secret: str = Header(None)
):
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    db = SupabaseClient()
    await db.update_call(call_id, {
        "status": "completed",
        "duration_seconds": duration_seconds,
    })
    return {"status": "saved"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


# ─── Exotel WebSocket bridge ──────────────────────────────
from app.exotel.bridge import handle_exotel_ws, handle_widget_ws
from fastapi import WebSocket as _WebSocket

@app.websocket("/ws/exotel")
async def exotel_ws(ws: _WebSocket):
    await handle_exotel_ws(ws)

@app.websocket("/ws/widget")
async def widget_ws(ws: _WebSocket):
    await handle_widget_ws(ws)
