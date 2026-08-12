"""
Nikki — Telugu Voice Pipeline
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

# NOTE: livekit imports removed 2026-07-25. They were dead weight — imported
# but never called (VAD is a custom RMS threshold in bridge.py, not silero;
# the pipeline runs over raw WebSocket audio, not LiveKit rooms). They were
# also the most install-fragile dependency (documented version-pin conflict
# in the old requirements.txt) and broke fresh builds. Removing them makes
# the Railway container build cleanly and start faster.

# ── ENV ──────────────────────────────────────────────────
# LIVEKIT_* env vars removed 2026-07-25 — were required at startup
# (os.environ[...]) but never used, so they crashed boot on any host that
# didn't have the old LiveKit vars set (e.g. a fresh Railway deploy).

SARVAM_KEY     = os.environ["SARVAM_API_KEY"]
GEMINI_KEY     = os.environ["GEMINI_API_KEY"]
SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_SERVICE_KEY"]
INTERNAL_SECRET= os.environ.get("INTERNAL_SECRET", "nikki-internal-secret-change-me")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("nikki")

# ── FASTAPI APP ──────────────────────────────────────────
app = FastAPI(title="Nikki Voice Pipeline")

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
- If you don't have specific information (price, availability, exact date/time), say so honestly and offer a callback — never invent a business fact you weren't given.
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
- If you don't have specific information (price, doctor availability, exact timing), say so honestly and offer a callback — never invent a fact you weren't given.
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
- If you don't have specific information (price, site availability, exact dates), say so honestly and offer a callback — never invent a property fact you weren't given.
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
- If you don't have specific information (pricing, executive availability, exact scheduling), say so honestly and offer a callback — never invent a fact you weren't given.
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

    async def synthesize(self, text: str, speaker: str = "priya") -> bytes:
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
                "temperature": 0.15,  # lowered from 0.3 for more literal, less improvised answers
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
                        "temperature": 0.15,  # lowered from 0.3 for more literal, less improvised answers
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
        # FIXED: was querying voice_profiles.did_number, a backward-compat
        # column that super-admin's DID assignment panel never writes to —
        # it only updates dids.tenant_id/voice_profile_id. That meant
        # assigning a number in the panel did NOT actually route any real
        # calls; this table's own migration comment says outright "dids
        # table is source of truth", but this lookup was never updated to
        # match. Now queries the real assignment record and embeds the
        # linked voice_profiles row via PostgREST's embed syntax.
        #
        # Matches on the last 10 digits rather than an exact string match:
        # dids.number is stored E.164 (+917XXXXXXXXX), but FreeSWITCH's
        # destination_number could arrive as a bare 10-digit number
        # depending on how the carrier's SIP trunk presents it — unverified
        # against a real live call. An exact match would silently return
        # zero results if the formats don't line up; a last-10-digits
        # match is correct either way.
        digits = "".join(c for c in did_number if c.isdigit())[-10:]
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{self.url}/rest/v1/dids",
                    headers=self.headers,
                    params={
                        "number": f"like.*{digits}",
                        "status": "eq.assigned",
                        "select": "*,voice_profiles(*)",
                        "limit": "1",
                    }
                )
                data = resp.json()
                if not data or not data[0].get("voice_profiles"):
                    return None
                return data[0]["voice_profiles"]
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
class NikkiAgent:
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
        # CRITICAL FIX (confirmed via a real Sarvam API call, not guessed):
        # anushka/vidya/karun/manisha are NOT valid bulbul:v3 speakers —
        # confirmed by Sarvam's own error response listing the real
        # catalog. This means every real phone call's TTS synthesis has
        # been failing outright this whole time (or silently falling
        # back to a different provider, if one is configured). The
        # comment this replaces already noted ONE prior failed attempt
        # at this same fix (meera/pavithra/arvind) — these picks are
        # verified against the actual current bulbul:v3 speaker list,
        # not another guess.
        sku_voices = {
            "standard":    "priya",   # warm general-business female voice
            "clinic":      "shreya",  # calm, professional — healthcare
            "real_estate": "aditya",  # confident male voice
            "premium":     "kavya",   # distinct, polished — luxury/high-value
        }
        self.voice = sku_voices.get(profile.get("profile_sku","standard"), "priya")

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


# ── BROWSER WIDGET SESSION STORE ─────────────────────────────
# In-memory session map: session_id → NikkiAgent instance.
# Cleared after 30 minutes of inactivity. Separate from phone calls.
import time as _time
_widget_sessions: dict[str, tuple[NikkiAgent, float]] = {}

def _get_or_create_widget_session(session_id: str, profile: dict) -> NikkiAgent:
    now = _time.time()
    # Expire sessions older than 30 minutes
    expired = [k for k, (_, ts) in _widget_sessions.items() if now - ts > 1800]
    for k in expired:
        del _widget_sessions[k]
    if session_id in _widget_sessions:
        agent, _ = _widget_sessions[session_id]
        _widget_sessions[session_id] = (agent, now)
        return agent
    agent = NikkiAgent(profile, "web_visitor")
    _widget_sessions[session_id] = (agent, now)
    return agent


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

class OutboundDispatchRequest(BaseModel):
    tenant_id: str
    voice_profile_id: Optional[str] = None
    to_number: str
    script: Optional[str] = None
    recipient_id: str

@app.post("/outbound")
async def handle_outbound_dispatch(req: OutboundDispatchRequest,
                                    x_internal_secret: str = Header(None)):
    """Places one outbound call and connects it to the same Voicebot
    Applet flow inbound calls use. This is the endpoint
    api-server/src/jobs/outbound-dispatcher.ts has always called — it
    simply didn't exist on this side yet, so every dispatch attempt was
    failing at the network layer before ever reaching Exotel.

    Used by BOTH campaign dispatch (recipient_id -> a campaign row) and
    instant lead-capture dispatch (recipient_id -> an is_instant row) —
    the request shape and this handler don't need to know which.

    Genuinely still blocked until Exotel enables outbound on the account
    and EXOTEL_OUTBOUND_APP_ID is set — see app/exotel/outbound.py
    config_status(). Until then this returns a clear 503 explaining
    exactly what's missing, rather than a confusing generic failure.
    """
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    status = ob.config_status()
    if not status["ready"]:
        missing = [k for k, v in status["fields"].items() if not v]
        raise HTTPException(status_code=503,
            detail=f"Outbound calling not configured yet. Missing: {', '.join(missing)}")

    result = await ob.place_outbound_call(req.to_number)

    if result["success"]:
        await ob.mark_recipient_dispatched(req.recipient_id, result["call_sid"])
        return {"call_id": result["call_sid"]}
    else:
        await ob.mark_recipient_failed(req.recipient_id, result["error"] or "unknown")
        raise HTTPException(status_code=502, detail=result["error"] or "dispatch failed")


@app.get("/health")
async def health():
    from app.exotel import circuit_breaker as _cb
    return {
        "status": "ok",
        "service": "nikki-voice-pipeline",
        "timestamp": datetime.now().isoformat(),
        "circuit_breakers": _cb.all_status(),
    }

# ════════════════════════════════════════════════════════════════
# BROWSER WIDGET ENDPOINTS
# Used by the in-browser voice/chat widget (Web Speech API frontend).
# No auth needed for the demo widget — rate-limited by CORS origin.
# Confirmed bookings are saved to Supabase so they appear in admin.
# ════════════════════════════════════════════════════════════════

_DEMO_PROFILE: dict = {
    "id":             "demo",
    "tenant_id":      "demo",
    "profile_sku":    "standard",
    "business_name":  "Hey Nikki Demo",
    "open_time":      "09:00",
    "close_time":     "21:00",
    "services":       ["Doctor Consultation", "Dental Check-up", "Property Site Visit", "Business Enquiry", "General Appointment"],
    "appointment_types": ["New Patient", "Follow-up", "Enquiry"],
    "whatsapp_number": None,
    "missed_call_guard_enabled": False,
}

class BrowserChatRequest(BaseModel):
    text:        str
    session_id:  str
    tenant_id:   Optional[str] = None   # if authenticated visitor, use real profile
    tts:         bool = False            # True = also return Sarvam TTS audio bytes

class BookingSaveRequest(BaseModel):
    name:        str
    phone:       str
    service:     str
    slot:        str
    tenant_id:   Optional[str] = None
    session_id:  str

@app.post("/api/v1/browser/chat")
async def browser_chat(req: BrowserChatRequest):
    """
    Single-turn chat endpoint for the in-browser voice widget.
    Web Speech API → transcript text → this endpoint → LLM response text
    (+ optional Sarvam TTS audio bytes if tts=True).

    Each session_id maintains conversation history so follow-up turns
    are contextually aware. Supports both demo mode (no tenant) and
    authenticated widget (tenant_id provided).
    """
    # Pick voice profile: real tenant profile or fallback demo
    profile = _DEMO_PROFILE
    if req.tenant_id and req.tenant_id != "demo":
        db = SupabaseClient()
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(
                    f"{db.url}/rest/v1/voice_profiles",
                    headers=db.headers,
                    params={"tenant_id": f"eq.{req.tenant_id}", "select": "*", "limit": "1"},
                )
                rows = resp.json()
                if rows:
                    profile = rows[0]
        except Exception as e:
            log.warning(f"[widget] profile lookup failed: {e}")

    agent = _get_or_create_widget_session(req.session_id, profile)

    # Build system prompt for web widget context
    system_prompt = (
        build_system_prompt(profile) +
        "\n\n[WIDGET CONTEXT] User is chatting via the web widget — not on a phone call. "
        "Respond in English or Telugu/Tanglish. Keep responses SHORT (under 25 words). "
        "Guide them to: share their name → phone number → choose a service → preferred time → confirm booking. "
        "When you have name + phone + service + time, say: BOOKING_CONFIRMED: <summary>."
    )

    history = list(agent.history)
    history.append({"role": "user", "content": req.text})

    llm = GeminiLLM()
    response_text = await llm.generate(system_prompt, history)

    # Update agent history
    agent.history.append({"role": "user", "content": req.text})
    agent.history.append({"role": "assistant", "content": response_text})

    # Detect booking confirmation
    booking_confirmed = "BOOKING_CONFIRMED:" in response_text
    booking_summary = ""
    if booking_confirmed:
        booking_summary = response_text.split("BOOKING_CONFIRMED:")[-1].strip()
        response_text = response_text.split("BOOKING_CONFIRMED:")[0].strip()
        if not response_text:
            response_text = f"✅ Booking confirmed! {booking_summary}"

    # Optional TTS via Sarvam (for richer voice experience)
    audio_b64 = None
    if req.tts:
        try:
            tts = SarvamTTS()
            audio_bytes = await tts.synthesize(response_text, agent.voice)
            import base64 as _b64
            audio_b64 = _b64.b64encode(audio_bytes).decode() if audio_bytes else None
        except Exception as e:
            log.warning(f"[widget] TTS failed (will use browser TTS): {e}")

    return {
        "response": response_text,
        "audio_b64": audio_b64,
        "booking_confirmed": booking_confirmed,
        "booking_summary": booking_summary,
        "intent": agent.intent,
        "turn": len(agent.history) // 2,
    }


@app.post("/api/v1/browser/save-booking")
async def browser_save_booking(req: BookingSaveRequest):
    """
    Save a booking collected by the browser widget to Supabase.
    This makes it appear in the client's Appointments dashboard immediately.
    For demo visitors (no tenant_id), saved to a shared demo tenant.
    """
    db = SupabaseClient()
    tenant_id = req.tenant_id or "00000000-0000-0000-0000-000000000000"  # demo tenant

    # Resolve real tenant if provided
    real_tenant_id: Optional[str] = None
    if req.tenant_id and req.tenant_id != "demo":
        real_tenant_id = req.tenant_id

    try:
        # Create a leads record for the visitor
        lead_resp = await db.save_call({
            "tenant_id":     real_tenant_id or tenant_id,
            "caller_number": req.phone,
            "direction":     "inbound",
            "status":        "completed",
            "intent":        "appointment",
            "source":        "web_widget",
        })
        call_id = lead_resp

        # Create appointment record
        appt_id = await db.save_appointment({
            "tenant_id":     real_tenant_id or tenant_id,
            "caller_number": req.phone,
            "call_id":       call_id,
            "status":        "confirmed",
            "notes":         f"Web widget booking | Name: {req.name} | Service: {req.service} | Slot: {req.slot}",
        })

        # Also upsert lead record with name
        if real_tenant_id:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(
                        f"{db.url}/rest/v1/leads",
                        headers={**db.headers, "Prefer": "resolution=merge-duplicates"},
                        json={
                            "tenant_id":         real_tenant_id,
                            "phone":             req.phone,
                            "name":              req.name,
                            "intent":            "book_appointment",
                            "interest":          req.service,
                            "stage":             "qualified",
                            "score":             80,
                            "source":            "web_widget",
                            "last_contacted_at": datetime.now().isoformat(),
                        }
                    )
            except Exception as e:
                log.warning(f"[widget] lead upsert failed: {e}")

        log.info(f"[widget] booking saved: {req.name} {req.phone} {req.service} @ {req.slot}")
        return {"ok": True, "appointment_id": appt_id, "call_id": call_id}

    except Exception as e:
        log.error(f"[widget] save_booking failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/call/inbound")
async def handle_inbound(req: InboundCallRequest, x_internal_secret: str = Header(None)):
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    db = SupabaseClient()
    profile = await db.get_voice_profile(req.did_number)

    if not profile:
        log.warning(f"No voice profile for DID: {req.did_number}")
        raise HTTPException(status_code=404, detail="Voice profile not found for this number")

    agent = NikkiAgent(profile, req.caller_number)
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

    agent = NikkiAgent(profile, req.caller_number)
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



# ═══════════════════════════════════════════════════════════
# TEST CONSOLE — Verify pipeline works without needing Exotel
# Public endpoints, no auth. Visit /test in browser.
# ═══════════════════════════════════════════════════════════

class TTSTestRequest(BaseModel):
    text: str = "నమస్కారం! Nikki నుండి కాల్ చేస్తున్నాము."
    speaker: str = "priya"

class LLMTestRequest(BaseModel):
    user_message: str = "డాక్టర్ కి appointment కావాలి"
    profile_sku: str = "clinic"
    business_name: str = "Ravi Clinic, Banjara Hills"

@app.get("/test")
async def test_dashboard():
    """Interactive test dashboard — visit in a browser"""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=TEST_CONSOLE_HTML)


@app.post("/api/test/tts")
async def test_tts(req: TTSTestRequest):
    """Direct Sarvam Telugu TTS test — bypasses fallback to show real errors"""
    import base64
    try:
        # Enforce word cap
        words = req.text.split()
        text = " ".join(words[:20]) if len(words) > 20 else req.text

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={
                    "api-subscription-key": SARVAM_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "inputs": [text],
                    "target_language_code": "te-IN",
                    "speaker": req.speaker,
                    "model": "bulbul:v3",
                    "pitch": 0,
                    "pace": 1.1,
                    "loudness": 1.4,
                    "speech_sample_rate": 8000,
                    "enable_preprocessing": True,
                    "eng_interpolation_wt": 100,
                }
            )

        # Return full details of what happened
        if resp.status_code == 200:
            data = resp.json()
            audio_b64 = data.get("audios", [""])[0]
            audio_bytes = base64.b64decode(audio_b64)
            return {
                "audio_b64": audio_b64,
                "audio_bytes": len(audio_bytes),
                "text": text,
                "speaker": req.speaker,
                "sarvam_status": 200,
            }
        else:
            return {
                "error": f"Sarvam returned {resp.status_code}",
                "sarvam_response": resp.text[:500],
                "text": text,
                "speaker": req.speaker,
                "api_key_prefix": SARVAM_KEY[:10] + "..." if SARVAM_KEY else "NOT SET",
            }
    except httpx.HTTPError as e:
        return {"error": f"HTTP error: {type(e).__name__}: {str(e)}"}
    except Exception as e:
        import traceback
        return {
            "error": f"{type(e).__name__}: {str(e)}",
            "traceback": traceback.format_exc()[-500:],
        }


@app.post("/api/test/llm")
async def test_llm(req: LLMTestRequest):
    """Direct Gemini LLM test"""
    try:
        llm = GeminiLLM()
        fake_profile = {
            "profile_sku": req.profile_sku,
            "business_name": req.business_name,
            "open_time": "09:00", "close_time": "21:00",
            "services": ["Consultation", "Blood Test", "ECG"],
            "appointment_types": ["New Patient", "Follow-up"],
        }
        system_prompt = build_system_prompt(fake_profile)
        history = [{"role": "user", "content": req.user_message}]
        response = await llm.generate(system_prompt, history)
        return {
            "response": response,
            "model": "gemini-2.5-flash",
            "user_message": req.user_message,
        }
    except Exception as e:
        log.exception("LLM test failed")
        return {"error": str(e)}


@app.post("/api/test/full")
async def test_full(req: LLMTestRequest):
    """Full chain: LLM → TTS audio (with error details)"""
    import base64
    try:
        llm = GeminiLLM()
        fake_profile = {
            "profile_sku": req.profile_sku,
            "business_name": req.business_name,
            "open_time": "09:00", "close_time": "21:00",
            "services": ["Consultation", "Blood Test", "ECG"],
            "appointment_types": ["New Patient", "Follow-up"],
        }
        system_prompt = build_system_prompt(fake_profile)
        history = [{"role": "user", "content": req.user_message}]
        response = await llm.generate(system_prompt, history)

        speaker_map = {
            "standard": "priya", "clinic": "shreya",
            "real_estate": "aditya", "premium": "kavya",
        }
        speaker = speaker_map.get(req.profile_sku, "priya")

        # Direct Sarvam call for better error visibility
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={
                    "api-subscription-key": SARVAM_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "inputs": [response],
                    "target_language_code": "te-IN",
                    "speaker": speaker,
                    "model": "bulbul:v3",
                    "speech_sample_rate": 8000,
                    "enable_preprocessing": True,
                    "eng_interpolation_wt": 100,
                }
            )

        if r.status_code == 200:
            data = r.json()
            audio_b64 = data.get("audios", [""])[0]
            return {
                "response": response,
                "audio_b64": audio_b64,
                "audio_bytes": len(base64.b64decode(audio_b64)),
                "speaker": speaker,
            }
        else:
            return {
                "response": response,
                "error": f"TTS failed: Sarvam returned {r.status_code}",
                "sarvam_response": r.text[:500],
                "speaker": speaker,
            }
    except Exception as e:
        import traceback
        return {
            "error": f"{type(e).__name__}: {str(e)}",
            "traceback": traceback.format_exc()[-500:],
        }


TEST_CONSOLE_HTML = """<!DOCTYPE html>
<html>
<head>
  <title>Nikki Pipeline Test Console</title>
  <meta charset="utf-8"/>
  <style>
    body { font-family: -apple-system, sans-serif; background: #070B19; color: #F8FAFC; padding: 40px; max-width: 900px; margin: 0 auto; }
    h1 { background: linear-gradient(135deg,#F59E0B,#00E676); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 40px; margin: 0 0 8px; }
    .sub { color: #9CA3AF; margin-bottom: 32px; }
    .card { background: #111827; border: 1px solid #1F2937; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    .card h2 { margin: 0 0 12px; color: #00E676; font-size: 18px; }
    .card p { color: #9CA3AF; font-size: 14px; margin: 0 0 16px; }
    input, textarea, select { width: 100%; padding: 10px; background: #1A2235; border: 1px solid #1F2937; border-radius: 8px; color: #F8FAFC; margin-bottom: 12px; font-size: 14px; box-sizing: border-box; }
    button { background: linear-gradient(135deg,#F59E0B,#00E676); color: #070B19; padding: 12px 24px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 14px; }
    button:disabled { opacity: 0.5; cursor: wait; }
    .result { margin-top: 16px; padding: 12px; background: #070B19; border-radius: 8px; font-family: monospace; font-size: 13px; color: #F8FAFC; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; }
    .ok { color: #00E676; } .err { color: #EF4444; }
    audio { width: 100%; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>Nikki Pipeline Test Console</h1>
  <div class="sub">Verify each piece of the voice pipeline works independently</div>

  <div class="card">
    <h2>1. Sarvam TTS — Text to Telugu Speech</h2>
    <p>Enter Telugu/Tanglish/English text. Hear it spoken in a chosen voice.</p>
    <textarea id="tts-text" rows="3">నమస్కారం! Ravi Clinic కి కాల్ చేసినందుకు thank you. మీకు ఎలా సహాయపడగలను?</textarea>
    <select id="tts-speaker">
      <option value="priya">Priya (default female)</option>
      <option value="shreya">Shreya (clinic)</option>
      <option value="aditya">Aditya (male)</option>
      <option value="kavya">Kavya (premium)</option>
    </select>
    <button onclick="testTTS()">🔊 Generate Telugu Speech</button>
    <div id="tts-result" class="result" style="display:none"></div>
  </div>

  <div class="card">
    <h2>2. Gemini LLM — Business Response</h2>
    <p>Simulate a caller message. Get Nikki Telugu response.</p>
    <input id="llm-text" value="డాక్టర్ కి appointment కావాలి, రేపు available ఉందా?" />
    <select id="llm-profile">
      <option value="clinic">Clinic</option>
      <option value="standard">Standard Business</option>
      <option value="real_estate">Real Estate</option>
      <option value="premium">Premium</option>
    </select>
    <button onclick="testLLM()">🧠 Generate Response</button>
    <div id="llm-result" class="result" style="display:none"></div>
  </div>

  <div class="card">
    <h2>3. Full Pipeline — TTS + LLM together</h2>
    <p>Feed a Telugu message as if transcribed from a call. Hear audio response back.</p>
    <input id="full-text" value="రేపు 10 గంటలకి appointment బుక్ చేయండి" />
    <button onclick="testFull()">⚡ Run Full Chain</button>
    <div id="full-result" class="result" style="display:none"></div>
  </div>

  <div class="card">
    <h2>4. Health Check</h2>
    <button onclick="testHealth()">✅ Check Server Health</button>
    <div id="health-result" class="result" style="display:none"></div>
  </div>

<script>
async function testTTS() {
  const btn = event.target;
  const div = document.getElementById('tts-result');
  btn.disabled = true;
  div.style.display = 'block';
  div.innerHTML = 'Generating speech...';
  try {
    const r = await fetch('/api/test/tts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        text: document.getElementById('tts-text').value,
        speaker: document.getElementById('tts-speaker').value,
      })
    });
    const data = await r.json();
    if (data.audio_b64) {
      div.innerHTML = '<span class="ok">✓ Success — ' + data.audio_bytes + ' bytes</span><br><audio controls autoplay src="data:audio/wav;base64,' + data.audio_b64 + '"></audio>';
    } else {
      div.innerHTML = '<span class="err">✗ Error: ' + (data.error || 'Unknown') + '</span>';
    }
  } catch (e) { div.innerHTML = '<span class="err">✗ ' + e.message + '</span>'; }
  btn.disabled = false;
}
async function testLLM() {
  const btn = event.target;
  const div = document.getElementById('llm-result');
  btn.disabled = true;
  div.style.display = 'block';
  div.innerHTML = 'Thinking...';
  try {
    const r = await fetch('/api/test/llm', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        user_message: document.getElementById('llm-text').value,
        profile_sku: document.getElementById('llm-profile').value,
        business_name: 'Ravi Clinic, Banjara Hills',
      })
    });
    const data = await r.json();
    if (data.response) {
      div.innerHTML = '<span class="ok">✓ ' + data.model + '</span><br><br><b>Response:</b><br>' + data.response;
    } else {
      div.innerHTML = '<span class="err">✗ ' + (data.error || 'Unknown') + '</span>';
    }
  } catch (e) { div.innerHTML = '<span class="err">✗ ' + e.message + '</span>'; }
  btn.disabled = false;
}
async function testFull() {
  const btn = event.target;
  const div = document.getElementById('full-result');
  btn.disabled = true;
  div.style.display = 'block';
  div.innerHTML = 'Running LLM + TTS chain...';
  try {
    const r = await fetch('/api/test/full', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        user_message: document.getElementById('full-text').value,
        profile_sku: 'clinic',
        business_name: 'Ravi Clinic, Banjara Hills',
      })
    });
    const data = await r.json();
    if (data.audio_b64) {
      div.innerHTML = '<span class="ok">✓ Response:</span> ' + data.response +
        '<br><br><audio controls autoplay src="data:audio/wav;base64,' + data.audio_b64 + '"></audio>';
    } else {
      div.innerHTML = '<span class="err">✗ ' + (data.error || 'Unknown') + '</span>';
    }
  } catch (e) { div.innerHTML = '<span class="err">✗ ' + e.message + '</span>'; }
  btn.disabled = false;
}
async function testHealth() {
  const div = document.getElementById('health-result');
  div.style.display = 'block';
  const r = await fetch('/health');
  div.innerHTML = '<span class="ok">' + JSON.stringify(await r.json(), null, 2) + '</span>';
}
</script>
</body>
</html>"""


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


# ─── Exotel WebSocket bridge ──────────────────────────────
from app.exotel.bridge import handle_exotel_ws, handle_widget_ws
from fastapi import WebSocket as _WebSocket

@app.websocket("/ws/exotel")
async def exotel_ws(ws: _WebSocket):
    await handle_exotel_ws(ws)

@app.websocket("/ws/plivo")
async def plivo_ws(ws: _WebSocket):
    # Same handler, Plivo wire-format adapter. Point a Plivo number's
    # <Stream> answer-URL XML at wss://<host>/ws/plivo to route its calls
    # here. Exotel calls continue to hit /ws/exotel untouched.
    await handle_exotel_ws(ws, provider="plivo")

@app.websocket("/ws/widget")
async def widget_ws(ws: _WebSocket):
    await handle_widget_ws(ws)


# ════════════════════════════════════════════════════════════════
# FREESWITCH mod_audio_stream — WebSocket handler
# Added for Hey Nikki v4.0 — parallel path; Exotel untouched.
#
# FreeSWITCH dialplan sends audio here via:
#   audio_stream data="ws://127.0.0.1:8000/ws/freeswitch/{did}/{caller}/{uuid}"
#
# Wire protocol:
#   1. First message: JSON metadata frame from FreeSWITCH
#   2. Subsequent messages: binary PCM audio (8kHz, 16-bit, mono)
#   3. Send binary audio back to play to caller
#   4. Send JSON {"stop": true} to end the stream cleanly
# ════════════════════════════════════════════════════════════════

import struct
import wave
import io
import tempfile
import time

# Silence detection: ~320ms of silence (320 bytes @ 8kHz 8-bit or 640 bytes @ 16-bit)
_SILENCE_THRESHOLD  = 200        # RMS energy threshold for silence
_SILENCE_FRAMES     = 16         # consecutive silent 20ms frames before STT fires
_MIN_SPEECH_FRAMES  = 3          # minimum speech frames to attempt STT
_FRAME_BYTES        = 320        # bytes per 20ms frame at 8kHz 16-bit mono


def _rms(audio_bytes: bytes) -> float:
    """Compute RMS energy of raw PCM16 audio bytes."""
    if len(audio_bytes) < 2:
        return 0.0
    samples = struct.unpack(f"<{len(audio_bytes)//2}h", audio_bytes[:len(audio_bytes)//2*2])
    if not samples:
        return 0.0
    return (sum(s*s for s in samples) / len(samples)) ** 0.5


def _pcm16_to_wav_bytes(pcm: bytes, sample_rate: int = 8000) -> bytes:
    """Wrap raw PCM16 bytes into a valid WAV container for Sarvam STT."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)       # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


async def _upload_to_r2(local_wav_bytes: bytes, call_id: str, tenant_id: str) -> str:
    """Upload call recording to Cloudflare R2. Returns public URL or ''."""
    # FreeSWITCH mod_audio_stream collects PCM — we receive it here in memory.
    cf_account_id = os.environ.get("CF_ACCOUNT_ID", "")
    r2_access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    r2_secret     = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    r2_bucket     = os.environ.get("R2_BUCKET", "heynikki-recordings")
    r2_public_url = os.environ.get("R2_PUBLIC_URL", "")

    if not all([cf_account_id, r2_access_key, r2_secret]):
        log.warning("[FS] R2 credentials not set — skipping recording upload")
        return ""

    try:
        import boto3
        from botocore.config import Config as _BotoCfg

        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{cf_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=r2_access_key,
            aws_secret_access_key=r2_secret,
            config=_BotoCfg(signature_version="s3v4"),
            region_name="auto",
        )

        object_key = f"{tenant_id}/{call_id}.wav"
        s3.put_object(
            Bucket=r2_bucket,
            Key=object_key,
            Body=local_wav_bytes,
            ContentType="audio/wav",
        )
        public_url = f"{r2_public_url.rstrip('/')}/{object_key}"
        log.info(f"[FS] Recording uploaded to R2: {object_key} ({len(local_wav_bytes):,}B)")
        return public_url
    except ImportError:
        log.error("[FS] boto3 not installed — run: pip install boto3")
        return ""
    except Exception as e:
        log.error(f"[FS] R2 upload failed: {e}")
        return ""


async def _read_platform_config() -> dict:
    """Read platform_config table from Supabase. Returns key→value dict."""
    try:
        db = SupabaseClient()
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(
                f"{db.url}/rest/v1/platform_config",
                headers=db.headers,
                params={"select": "key,value"},
            )
            rows = resp.json() if resp.status_code == 200 else []
            return {r["key"]: r["value"] for r in rows if isinstance(r, dict)}
    except Exception as e:
        log.warning(f"[FS] platform_config read failed: {e}")
        return {}


async def _fire_automation_webhook(event: str, payload: dict, cfg: dict):
    """Fire n8n or Activepieces webhook based on platform_config. Fire-and-forget."""
    engine = cfg.get("automation_engine", "n8n")
    base = (
        cfg.get("n8n_url") or os.environ.get("N8N_WEBHOOK_BASE", "http://localhost:5678/webhook")
        if engine == "n8n"
        else cfg.get("activepieces_url") or os.environ.get("ACTIVEPIECES_WEBHOOK_BASE", "http://localhost:8080/api/v1/webhooks")
    )
    url = f"{base.rstrip('/')}/{event}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(url, json=payload)
        log.info(f"[FS] Automation webhook fired → {engine}: {event}")
    except Exception as e:
        log.warning(f"[FS] Automation webhook failed ({event}): {e}")


# ── FreeSWITCH WebSocket endpoint ────────────────────────────────────────────
@app.websocket("/ws/freeswitch/{did_number}/{caller_number}/{fs_uuid}")
async def freeswitch_ws(
    ws: _WebSocket,
    did_number:    str,
    caller_number: str,
    fs_uuid:       str,
):
    """
    FreeSWITCH mod_audio_stream WebSocket handler.

    Audio flow:
      FS → binary PCM frames → VAD buffer → STT → Gemini → TTS → binary PCM → FS

    Recording flow:
      All inbound PCM accumulated in memory → WAV → Cloudflare R2 on hangup.
    """
    await ws.accept()
    log.info(f"[FS] Connected: did={did_number} caller={caller_number} uuid={fs_uuid}")

    db      = SupabaseClient()
    profile = await db.get_voice_profile(did_number)

    if not profile:
        log.warning(f"[FS] No voice profile for DID: {did_number} — sending 404 and closing")
        await ws.send_text(json.dumps({"error": "no_profile", "did": did_number}))
        await ws.close(code=1008)
        return

    agent = NikkiAgent(profile, caller_number)

    # Override call_id if API server pre-created the record
    # (API server calls /api/v1/call/freeswitch/inbound before connecting)
    agent.call_id = await db.save_call({
        "tenant_id":        profile["tenant_id"],
        "voice_profile_id": profile["id"],
        "caller_number":    caller_number,
        "direction":        "inbound",
        "status":           "active",
        "livekit_room_id":  fs_uuid,   # store FS UUID for ESL lookups
    })

    call_start_ts = time.time()
    recording_pcm = bytearray()   # accumulate all PCM for R2 upload
    speech_buf    = bytearray()   # current utterance buffer
    silence_count = 0
    speech_count  = 0
    cfg           = {}
    disclosure_sent = False

    try:
        # Load platform config for automation routing
        cfg = await _read_platform_config()

        # Send TRAI disclosure audio immediately on connect
        disclosure_audio = await agent.on_call_start()
        if disclosure_audio:
            await ws.send_bytes(disclosure_audio)
        disclosure_sent = True

        # Main audio loop
        while True:
            try:
                message = await asyncio.wait_for(ws.receive(), timeout=120.0)
            except asyncio.TimeoutError:
                log.warning(f"[FS] {fs_uuid}: 120s timeout — hanging up")
                break

            # FreeSWITCH sends disconnect on call end
            if message.get("type") == "websocket.disconnect":
                log.info(f"[FS] {fs_uuid}: WebSocket disconnect received")
                break

            # ── JSON metadata frame (first message from FreeSWITCH) ─────────
            if message.get("type") == "websocket.receive" and message.get("text"):
                try:
                    meta = json.loads(message["text"])
                    log.info(f"[FS] {fs_uuid}: metadata={meta}")
                except Exception:
                    pass
                continue

            # ── Binary audio frame ────────────────────────────────────────────
            if message.get("type") == "websocket.receive" and message.get("bytes"):
                frame = bytes(message["bytes"])

                # Accumulate full recording
                recording_pcm.extend(frame)

                # VAD: compute RMS energy of this frame
                energy = _rms(frame)
                is_speech = energy > _SILENCE_THRESHOLD

                if is_speech:
                    speech_buf.extend(frame)
                    speech_count  += 1
                    silence_count  = 0
                else:
                    silence_count += 1
                    if speech_count > 0:
                        speech_buf.extend(frame)  # include trailing silence

                # Fire STT when we hit silence after speech
                if silence_count >= _SILENCE_FRAMES and speech_count >= _MIN_SPEECH_FRAMES:
                    utterance_pcm = bytes(speech_buf)
                    speech_buf    = bytearray()
                    speech_count  = 0
                    silence_count = 0

                    # Convert raw PCM → WAV for STT
                    wav_bytes = _pcm16_to_wav_bytes(utterance_pcm)

                    # STT → LLM → TTS pipeline (reuse existing NikkiAgent)
                    response_audio = await agent.on_speech(wav_bytes)
                    if response_audio:
                        await ws.send_bytes(response_audio)

    except Exception as e:
        log.error(f"[FS] {fs_uuid}: WebSocket error: {e}")

    finally:
        # ── Call cleanup ───────────────────────────────────────────────────
        duration = int(time.time() - call_start_ts)
        log.info(f"[FS] {fs_uuid}: Call ended, duration={duration}s, pcm={len(recording_pcm)}B")

        # Upload recording to R2 (async, don't block close)
        r2_url = ""
        if recording_pcm:
            wav_bytes = _pcm16_to_wav_bytes(bytes(recording_pcm))
            r2_url = await _upload_to_r2(wav_bytes, agent.call_id or fs_uuid, profile["tenant_id"])

        # Finalize call record
        updates = {
            "status":           "completed",
            "duration_seconds": duration,
            "transcript":       agent.transcript,
            "intent":           agent.intent,
        }
        if r2_url:
            updates["recording_url"] = r2_url
        if agent.call_id:
            await db.update_call(agent.call_id, updates)

        # Fire post-call automation (missed call if < 8s)
        if duration < 8:
            await _fire_automation_webhook("missed-call", {
                "caller_number": caller_number,
                "did_number":    did_number,
                "call_id":       agent.call_id,
                "tenant_id":     profile["tenant_id"],
                "business_name": profile.get("business_name", ""),
            }, cfg)
        elif agent.intent == "appointment":
            await _fire_automation_webhook("appointment-booked", {
                "caller_number": caller_number,
                "tenant_id":     profile["tenant_id"],
                "call_id":       agent.call_id,
            }, cfg)

        log.info(f"[FS] {fs_uuid}: cleanup complete, r2={r2_url or 'skipped'}")


# ── FreeSWITCH REST shim endpoints ───────────────────────────────────────────
# Called by api-server when FreeSWITCH events arrive. Lightweight — just
# acknowledges the call so the API server gets a quick 200 OK.

class FSInboundRequest(BaseModel):
    call_id:          Optional[str] = None
    caller_number:    str
    did_number:       str
    fs_uuid:          str
    tenant_id:        Optional[str] = None
    voice_profile_id: Optional[str] = None

class FSHangupRequest(BaseModel):
    fs_uuid:    str
    call_id:    Optional[str] = None
    tenant_id:  Optional[str] = None

@app.post("/api/v1/call/freeswitch/inbound")
async def fs_inbound(req: FSInboundRequest, x_internal_secret: str = Header(None)):
    """Called by api-server when FreeSWITCH answers a call.
    The actual AI session is handled by the WebSocket endpoint above.
    This shim just acknowledges receipt."""
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    log.info(f"[FS REST] Inbound: uuid={req.fs_uuid} did={req.did_number} caller={req.caller_number}")
    return {"ok": True, "fs_uuid": req.fs_uuid, "ws_url": f"/ws/freeswitch/{req.did_number}/{req.caller_number}/{req.fs_uuid}"}

@app.post("/api/v1/call/freeswitch/hangup")
async def fs_hangup(req: FSHangupRequest, x_internal_secret: str = Header(None)):
    """Called by api-server after FreeSWITCH CHANNEL_HANGUP.
    Recording upload happens inside the WebSocket handler on disconnect;
    this endpoint is a secondary trigger for cases where WS already closed."""
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")
    log.info(f"[FS REST] Hangup: uuid={req.fs_uuid} call_id={req.call_id}")
    return {"ok": True}

