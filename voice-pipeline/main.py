"""
Nikki — Telugu Voice Pipeline
FastAPI + LiveKit Agents + Sarvam STT/TTS + Gemini LLM
Run: uvicorn main:app --host 0.0.0.0 --port 8000
"""

import hashlib
import os
import re
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
API_SERVER_URL = os.environ.get("API_SERVER_URL", "http://127.0.0.1:4000")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("nikki")

# Also log to a file on a mounted volume. Docker keeps container logs inside
# the container, so `docker compose up -d` after a rebuild DESTROYS them —
# twice now a real call's transcript was lost to a deploy minutes later,
# leaving nothing to debug with. Rotating, capped, and outside the image.
try:
    from logging.handlers import RotatingFileHandler as _RFH
    _LOG_DIR = os.getenv("PIPELINE_LOG_DIR", "/app/logs")
    os.makedirs(_LOG_DIR, exist_ok=True)
    _fh = _RFH(os.path.join(_LOG_DIR, "pipeline.log"),
               maxBytes=20 * 1024 * 1024, backupCount=5)
    _fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    _fh.setLevel(logging.INFO)
    logging.getLogger().addHandler(_fh)
    log.info(f"file logging -> {_LOG_DIR}/pipeline.log")
except Exception as _e:  # noqa: BLE001 - logging must never break startup
    log.warning(f"file logging unavailable: {_e}")

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
    # Online retail / D2C. A jewellery caller asks "has my order shipped",
    # "do you have mangalsutras", "can I return this" — NOT for a 3pm slot.
    # The default persona ends with "WHAT YOU NEED FROM THEM: name, phone,
    # service, day/time", which turns a shop into a clinic. This SKU replaces
    # that goal with order enquiry + callback capture.
    "retail": """[FROZEN BLOCK - CACHED]
You are the phone assistant for an online jewellery brand. Callers have
ordered, or are about to.

HANDLE:
- Order status: take the order number and the phone used; the team confirms
  by WhatsApp. You CANNOT look up an order.
- Product questions: which categories exist, what a piece is made of.
- Returns: a damaged item can be returned; take the order number and what is
  wrong with it.
- Ordering: they can order over WhatsApp, or the team calls back.

NEVER: quote a price (no catalogue); promise a delivery date, discount or
stock; invent an order status; state where the business is located, ships
from, or how long it has existed unless it is in the block below. An invented
location is as damaging as an invented price.
If you cannot answer: say so and take the number.
"మా team WhatsApp లో confirm చేస్తారు" always closes safely.
Transfer on "human", "manager", "వేరే వ్యక్తి".

[MIDDLE BLOCK - BUSINESS CONTEXT INJECTED BELOW]
""",
    # Hey Nikki's OWN number — the live demo advertised on heynikki.in.
    # A caller here is a prospective customer, not a patient, so this SKU
    # sells the product. Every figure below is taken from the public site;
    # do not add to it. The DID was previously pointed at a "Hey Nikki Test
    # Clinic" profile offering Dental Checkup, so the demo line answered as
    # a fictional dental clinic.
    "heynikki": """[FROZEN BLOCK - CACHED]
You are Nikki, the assistant for Hey Nikki itself — a Telugu AI receptionist
service for Indian businesses, Hyderabad. The caller is a business owner
evaluating it. Answer their question, then get name, number and what business
they run, and book a demo or callback.

WHAT IT DOES (state only these):
- Answers a business's existing number in real Telugu; switches to Hindi or
  English the moment the caller does.
- Books appointments, captures numbers, sends WhatsApp confirmation.
- Appointments to a dashboard; recordings and transcripts stored.
- Missed call with no answer triggers automatic follow-up.
- AI brain and human brain on ONE number, decided per call: routine bookings
  to the AI; a caller asking for a person goes to a telecaller who already
  has their history on screen.
- 24/7 including Sundays and festivals. First reply under 700ms.
- Keep your existing number — forward or port it. Live in ~60 seconds.

PRICING (never quote a figure not listed):
- AI Telecaller: Rs 5,999/month. Unlimited inbound on one number,
  Telugu/Hindi/English, dashboard, WhatsApp confirmation, recordings.
- Human CRM Seat: Rs 1,999/seat/month. Click-to-call, caller history before
  pickup, disposition notes, shared pipeline.
- Dedicated Business Number: Rs 1,999/number/month. New or ported number,
  masked outbound caller ID, carrier failover.
- GST extra. Cancel any month. Recordings stay the customer's.

RULES: anything not above — custom integrations, discounts, contract terms,
go-live dates — say the team will confirm and take their number. Never invent
a feature, price or promise. Never name a vendor you are built on. If asked
outright whether you are an AI, say yes.

[MIDDLE BLOCK - BUSINESS CONTEXT INJECTED BELOW]
""",
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


# Shared by BOTH the phone path (build_system_prompt) and the browser demo.
# This used to be inlined in browser_chat and labelled [WEB CALL CONTEXT], so
# real phone calls never received ANY of it — they got only PROFILE_PROMPTS,
# whose clinic variant literally asks for "formal Tanglish". The result on a
# live call was textbook-formal Telugu, no name, no garu, and the exact
# opener this text bans ("మీకు ఎలా సహాయం చేయగలను"). The BOOKING_CONFIRMED
# sentinel is deliberately NOT part of this: only browser_chat parses it, so
# on a phone call the model would emit it and TTS would read it aloud.
TELUGU_PHONE_PERSONA = (
    # Compressed deliberately. Measured against Gemini flash-lite: a 5841-char
    # system prompt cost ~2045ms per turn vs ~1004ms for a minimal one —
    # prefill scales with prompt size and it sits on the caller's critical
    # path. Every RULE below is retained; the human-facing justification for
    # each one was removed, because the model needs the instruction, not the
    # argument for it. Do not re-add prose here without re-measuring.
    "\n\n[LIVE CALL PERSONA]"
    "\nYou are on a live phone call. Everything you write is spoken aloud."
    "\n- Reply in TELUGU SCRIPT. Switch to Hindi/English only if the caller does."
    "\n- ONE sentence. Two only if the second is a question."
    "\n- Put the ANSWER first. No preamble."
    "\n- Open naturally: అలాగే, సరే, ఆc, అవునా, ఓహ్, హా."
    "\n- Say గారు after names, in Telugu script — never the Latin \'garu\'."
    "\n- Keep these English: appointment, doctor, time, number, WhatsApp, "
    "confirm, booking, address, cancel."
    "\n- Spoken Telugu, not written: చెప్పండి not తెలియజేయండి. If it sounds like "
    "a government notice, rewrite it."
    "\n- React before asking. Say a name back before the next question."
    "\n- Never more than two options aloud."
    "\n- No emoji, asterisks, bullets, markdown or numbered lists."
    "\n- Never say you are an AI unless asked outright."
    "\n\nAVOID: repeating the question back; ధన్యవాదాలు every turn; formal openers "
    "like \'మీకు ఎలా సహాయం చేయగలను\' (say \'చెప్పండి\'); listing options like a menu; "
    "narrating what you are about to do."
    "\n\nCOLLECT: their name and a 10-digit phone number, plus whatever this "
    "business needs. Do NOT ask for an appointment day/time unless the business "
    "books appointments. One at a time, in whatever order they volunteer. Take "
    "all of it if they say several at once and never ask again. Answer their "
    "actual question first, then continue. Never invent a name, number or fact. "
    "Didn\'t catch it? \'ఒక్కసారి మళ్ళీ చెప్తారా?\'"
)


def build_system_prompt(profile: dict) -> str:
    """Inject business context into the frozen prompt template."""
    sku = profile.get("profile_sku", "standard")
    # Hey Nikki's own demo line sells the product rather than acting as a
    # tenant business. It cannot use profile_sku for this: the column has a
    # CHECK constraint limiting it to standard/clinic/real_estate/premium
    # (supabase/001_schema.sql:48), so "heynikki" is rejected at the DB.
    # Keyed on business_name until a migration widens that constraint —
    # see supabase/016_heynikki_profile_sku.sql.
    _bn = (profile.get("business_name") or "").strip().lower()
    if _bn == "hey nikki":
        sku = "heynikki"
    elif "jewellery" in _bn or "jewelry" in _bn:
        sku = "retail"
    frozen = PROFILE_PROMPTS.get(sku, PROFILE_PROMPTS["standard"])

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    open_t  = profile.get("open_time", "09:00")
    close_t = profile.get("close_time", "21:00")
    open_days = ", ".join(profile.get("open_days", ["Mon","Tue","Wed","Thu","Fri","Sat"]))
    services = ", ".join(profile.get("services", []))
    appt_types = ", ".join(profile.get("appointment_types", []))

    return f"""{frozen}
Your name: {profile.get('display_name') or 'నిక్కి'} (this is what you call yourself)
Business: {profile.get('business_name', 'Our Business')}
Working Hours: {open_days}, {open_t} – {close_t}
Services: {services or 'General services'}
Appointment Types: {appt_types or 'General appointment'}
Current Time: {now}

[LIVE BLOCK - conversation history appended here, max 5 turns]
""" + TELUGU_PHONE_PERSONA

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

    _CACHE_DIR = "/tmp/recordings/ttscache"
    _CACHE_MAX = 400          # ~400 short clips, tmpfs-friendly

    def _cache_path(self, text: str, speaker: str) -> str:
        h = hashlib.sha1(f"{speaker}|{text}".encode("utf-8")).hexdigest()
        return os.path.join(self._CACHE_DIR, f"{h}.wav")

    async def synthesize(self, text: str, speaker: str = "priya") -> bytes:
        """Synthesise, reusing a cached clip when this exact text was said before.

        Sarvam has a floor of roughly 700ms even for a few words, and that sits
        on the caller's critical path. Conversation is repetitive — greetings,
        "మీ పేరు చెప్పండి", "ఒక్కసారి మళ్ళీ చెప్తారా?", the fallback line — so
        the same string is synthesised over and over across calls. Cached
        clips return in microseconds.

        Keyed on speaker+text, so changing voice never serves the wrong one.
        Cache lives on the shared spool, which is tmpfs here: it survives
        container restarts, is capped, and losing it costs only latency.
        """
        key = self._cache_path(text, speaker)
        try:
            if os.path.exists(key) and os.path.getsize(key) > 1000:
                with open(key, "rb") as f:
                    return f.read()
        except OSError:
            pass

        audio = await self._synthesize_uncached(text, speaker)

        if audio and len(audio) > 1000:
            try:
                os.makedirs(self._CACHE_DIR, exist_ok=True)
                # Cheap bound: clear the cache wholesale rather than tracking
                # LRU. It refills on demand and only costs one slow turn.
                if len(os.listdir(self._CACHE_DIR)) >= self._CACHE_MAX:
                    for fn in os.listdir(self._CACHE_DIR):
                        try: os.remove(os.path.join(self._CACHE_DIR, fn))
                        except OSError: pass
                tmp = key + ".part"
                with open(tmp, "wb") as f:
                    f.write(audio)
                os.replace(tmp, key)      # atomic: never serve a half-written clip
            except OSError as e:
                log.debug(f"tts cache write skipped: {e}")
        return audio

    async def _synthesize_uncached(self, text: str, speaker: str = "priya") -> bytes:
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
                        "pace": 1.1,
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
        self.base_url = (
            # GEMINI_MODEL holds a MODEL NAME, not a URL — compose the URL
            # from it. gemini-2.0-flash-exp is retired and 404s;
            # gemini-2.5-flash / -flash-lite are closed to new keys. Of what
            # this key can reach, gemini-3.6-flash is a reasoning model and
            # took 17.6s for one short reply (measured) — unusable mid-call,
            # and it rejects thinkingBudget:0 so thinking cannot be disabled.
            # gemini-flash-lite-latest answers the same prompt in 0.85s.
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{os.getenv('GEMINI_MODEL') or 'gemini-flash-lite-latest'}"
            ":generateContent"
        )

    async def generate(self, system_prompt: str, history: list[dict]) -> str:
        # 12 exchanges, not 4. A booking needs name, phone, service and time;
        # at 4 exchanges the earliest facts fell out of context mid-call and
        # the model re-asked for them. Slot state above is the real fix, but
        # the window also has to be wide enough to hold the thread of the
        # conversation itself.
        recent = history[-24:] if len(history) > 24 else history

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
                # 300, not 60. Telugu script costs FAR more tokens per
                # character than English — a normal one-sentence reply
                # like "అలాగే కార్తీక్ గారు, రేపు ఉదయం పదకొండు గంటలకి
                # appointment confirm చేశానండి" blows a 60-token budget
                # and gets truncated mid-word. The symptom is Nikki
                # replying with half a sentence, which reads like a
                # broken model rather than a budget ceiling.
                #
                # This does not make her verbose — brevity is enforced by
                # the prompt, which is the right place for it. The token
                # cap is a safety limit, not a style control.
                "maxOutputTokens": 300,
                "temperature": 0.15,  # lowered from 0.3 for more literal, less improvised answers
                "topP": 0.8,
            }
        }

        try:
            # x-goog-api-key works for BOTH key formats, so no branching.
            # The previous code sent AQ./IQ./EQ. keys as Authorization: Bearer,
            # which this key is rejected with 401. Measured against the live
            # API with one AQ. key:
            #     Authorization: Bearer  -> 401
            #     ?key=<key>             -> 200
            #     x-goog-api-key: <key>  -> 200
            # Bearer is for OAuth access tokens, not API keys.
            headers = {"Content-Type": "application/json",
                       "x-goog-api-key": self.api_key}
            params: dict = {}
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
        # Facts survive OUTSIDE the rolling history window. Without this the
        # caller's name and number scrolled out after 4 exchanges and Nikki
        # asked for them again — on a real call the caller ended up saying
        # "ఎన్ని సార్లు చెప్పాలి నా పేరు ఫోన్ నెంబరు?" and Nikki invented
        # "సిస్టమ్ లో సేవ్ అవ్వలేదు" to explain it.
        self._bg_tasks   : set = set()
        self.slots       : dict = {"name": None, "phone": None,
                                   "service": None, "when": None}
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
        # Measured across all 14 Telugu-capable Sarvam voices (median F0 /
        # pitch spread): most cluster at 208-253Hz. simran is 208Hz with a
        # 42Hz spread — deeper than average AND more expressive, which is
        # what reads as husky-but-alive rather than husky-but-flat. neha is
        # deeper still (172Hz) if a darker voice is ever wanted.
        sku_voices = {
            "standard":    "simran",
            "clinic":      "shreya",  # calm, professional — healthcare
            "real_estate": "aditya",  # confident male voice
            "premium":     "kavya",   # distinct, polished — luxury/high-value
        }
        self.voice = sku_voices.get(profile.get("profile_sku","standard"), "simran")
        # Hey Nikki's own line is one brand voice regardless of SKU.
        if (profile.get("business_name") or "").strip().lower() == "hey nikki":
            self.voice = "simran"

    async def on_call_start(self) -> bytes:
        """Called when call connects. Play TRAI disclosure first.

        Loads pre-recorded disclosure WAV if available (saves ~500ms +
        Sarvam credits per call). Falls back to runtime TTS synthesis if
        the WAV is missing (dev environments, or before
        generate_trai_disclosure.py has been run).
        """
        # Only insert if the FreeSWITCH handler has not already created the
        # row. It sets call_id from /webhooks/freeswitch/inbound, which is the
        # row carrying livekit_room_id=fs_uuid — the one the hangup webhook
        # later completes. An unconditional insert here created a SECOND row
        # with no fs_uuid: transcript and intent landed on one row, status and
        # duration on the other, and nothing could join them.
        # Skip only the INSERT — never the disclosure below. An earlier
        # version returned here outright, and because the FreeSWITCH handler
        # sets call_id from /webhooks/freeswitch/inbound BEFORE calling this,
        # that meant the TRAI disclosure was skipped on every real call.
        if not self.call_id:
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

    _PHONE_RE = re.compile(r"[6-9]\d{9}")

    def _harvest_slots(self, text: str) -> None:
        """Pull durable facts out of a turn so they outlive the history window."""
        if not self.slots.get("phone"):
            m = self._PHONE_RE.search(re.sub(r"\D", "", text or ""))
            if m:
                self.slots["phone"] = m.group(0)
                log.info(f"slot: phone={m.group(0)}")

    def _known_facts_block(self) -> str:
        """Re-state confirmed facts every turn, and forbid inventing a booking.

        The rolling window is a cost control, not a memory: anything older than
        it is simply gone. Facts therefore have to be re-injected, and the
        model has to be told explicitly not to claim a booking it cannot
        support — on a live call it twice said "మీ appointment confirm అయింది"
        while holding no phone number at all.
        """
        known = {k: v for k, v in self.slots.items() if v}
        lines = ["\n\n[FACTS ALREADY COLLECTED — never ask for these again]"]
        for k, v in known.items():
            lines.append(f"\n- {k}: {v}")
        # Only assert what was actually extracted. An earlier version also
        # listed the un-harvested slots as "still missing", which was simply
        # false once the caller had said them — it contradicted the model's
        # own context and is exactly the kind of thing that makes it re-ask.
        if not known:
            lines.append("\n- (nothing extracted yet — rely on the conversation above)")
        lines.append(
            "\nNever invent a reason you lost their details, and never say the "
            "system failed to save something. If a fact is listed here, you "
            "have it. Only say the appointment is booked once the caller has "
            "actually given you a name, a phone number, a service and a time "
            "in this conversation — never before, and never twice."
        )
        return "".join(lines)

    async def on_speech(self, audio_bytes: bytes, want_text: bool = False):
        """Process one turn: STT -> detect intent -> LLM -> TTS.

        want_text=True returns the reply TEXT instead of synthesised audio, so
        the caller can synthesise sentence by sentence and start playback
        before the whole reply is spoken. Measured: TTS is ~1950ms of a
        ~3970ms turn and scales with reply length, so waiting for the full
        reply is the single largest avoidable delay.
        """
        try:
            user_text = await self.stt.transcribe(audio_bytes)
            if not user_text.strip():
                return await self.tts.synthesize("మళ్ళీ చెప్పగలరా?", self.voice)

            log.info(f"STT: {user_text}")
            self._harvest_slots(user_text)
            self.transcript.append({"role": "user", "content": user_text, "ts": datetime.now().isoformat()})
            self.history.append({"role": "user", "content": user_text})

            # Intent detection (keyword based, fast, no extra LLM call)
            self.intent = self._detect_intent(user_text)

            # Check for transfer trigger
            if self.intent == "transfer":
                return await self._handle_transfer()

            # Generate response
            response = await self.llm.generate(
                self.system_prompt + self._known_facts_block(), self.history)
            log.info(f"LLM: {response}")
            # The model often normalises spoken digits ("ట్రిపుల్ ఎయిట్...")
            # into a real number in its reply, so harvest that side too.
            self._harvest_slots(response)

            self.history.append({"role": "assistant", "content": response})
            self.transcript.append({"role": "assistant", "content": response, "ts": datetime.now().isoformat()})

            # If appointment booked, handle async (don't delay audio)
            if self.intent == "appointment":
                # Keep a reference: asyncio holds only a weak one, so an
                # unreferenced task can be garbage-collected mid-await and
                # the booking silently lost on a fast hangup.
                _t = asyncio.create_task(
                    self._handle_appointment_booking(user_text, response))
                self._bg_tasks.add(_t)
                _t.add_done_callback(self._bg_tasks.discard)

            if want_text:
                return response
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

# The landing-page wake-word agent talks about Hey Nikki itself, not about a
# pretend clinic. _DEMO_PROFILE below is the simulated INBOUND CALL demo (a
# customer ringing a business), which is a different product story — note its
# business_name is "Hey Nikki Demo", which does not match the "hey nikki"
# routing in build_system_prompt, so it correctly stays a generic receptionist.
_PRODUCT_PROFILE: dict = {
    "id":            "product",
    "tenant_id":     "demo",
    "profile_sku":   "standard",     # business_name routes it to the heynikki SKU
    "display_name":  "నిక్కి",
    "business_name": "Hey Nikki",
    "open_time":     "00:00",
    "close_time":    "23:59",
    "open_days":     ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    "services":      ["AI Telecaller", "Human CRM Seat", "Dedicated Business Number"],
    "appointment_types": ["Demo", "Callback"],
    "missed_call_guard_enabled": False,
}

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

_EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\u2190-\u21FF\u2B00-\u2BFF]",
    flags=re.UNICODE,
)

def _clean_for_speech(text: str) -> str:
    """
    Strip anything a TTS engine would vocalise as junk.

    Neural TTS does not silently skip an asterisk or a bullet — it
    pronounces it, or inserts an unnatural pause where the symbol sat.
    A reply peppered with "*", "-", "1." is the single most reliable
    way to make a voice sound like it is reading a document aloud
    rather than talking, so it gets removed here regardless of what
    the model produced.
    """
    if not text:
        return ""
    s = _EMOJI_RE.sub("", text)
    s = re.sub(r"[*_`#>|]+", " ", s)                    # markdown emphasis / fences
    s = re.sub(r"^\s*[-•–]\s+", "", s, flags=re.M)      # bullet leaders
    s = re.sub(r"^\s*\d+[.)]\s+", "", s, flags=re.M)    # numbered list leaders
    s = re.sub(r"\n{2,}", "\n", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


class BrowserChatRequest(BaseModel):
    text:        str
    session_id:  str
    tenant_id:   Optional[str] = None   # if authenticated visitor, use real profile
    tts:         bool = False            # True = also return Sarvam TTS audio bytes
    # "product" = the landing-page assistant explaining Hey Nikki's own
    # features and pricing. Anything else keeps the inbound-call demo.
    persona:     Optional[str] = None

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
    profile = _PRODUCT_PROFILE if (req.persona or "") == "product" else _DEMO_PROFILE
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

    # ── System prompt ────────────────────────────────────────────
    # This is where "sounds like a bot reading a script" is won or lost.
    #
    # The previous version told the model to march the caller through
    # name → phone → service → time in that fixed order and to answer
    # "in English or Telugu/Tanglish". Two problems: an ordered
    # interrogation is exactly what makes a receptionist sound like a
    # form, and Tanglish in Latin script means Sarvam's Telugu TTS is
    # handed English letters to pronounce — so it produced an English
    # voice doing a Telugu impression.
    #
    # Now: Telugu script out (so Bulbul speaks real Telugu), and the
    # model gathers the same four facts in whatever order the caller
    # volunteers them, the way a human receptionist actually does.
    system_prompt = (
        build_system_prompt(profile) +
        # persona now lives in build_system_prompt; only the web-only
        # BOOKING_CONFIRMED contract is added here.
        "\n\nWHEN COMPLETE:"
        "\nOnce you have all four, confirm warmly in Telugu AND append on a new line: "
        "BOOKING_CONFIRMED: <name> | <phone> | <service> | <time>"
    )

    # A first turn with no caller speech yet — the console opens the
    # line and Nikki greets first, exactly like a real answered call.
    is_call_start = req.text.strip() == "__CALL_START__"
    if is_call_start:
        req.text = (
            "[The call has just connected. The caller has not spoken yet. "
            "Greet them in Telugu the way a receptionist answers a business "
            "line, say which business this is, and ask how you can help. "
            "One sentence.]"
        )

    history = list(agent.history)
    history.append({"role": "user", "content": req.text})

    llm = GeminiLLM()
    response_text = await llm.generate(system_prompt, history)

    # Update agent history. The synthetic call-start instruction is NOT
    # stored — it's stage direction for one turn, and leaving it in the
    # transcript would have the model referring back to it later.
    if not is_call_start:
        agent.history.append({"role": "user", "content": req.text})
    agent.history.append({"role": "assistant", "content": response_text})

    # Detect booking confirmation
    booking_confirmed = "BOOKING_CONFIRMED:" in response_text
    booking_summary = ""
    if booking_confirmed:
        booking_summary = response_text.split("BOOKING_CONFIRMED:")[-1].strip()
        response_text = response_text.split("BOOKING_CONFIRMED:")[0].strip()
        if not response_text:
            response_text = "మీ appointment confirm అయింది. ధన్యవాదాలు!"

    # Belt-and-braces cleanup before this reaches a text-to-speech engine.
    # The prompt forbids emoji and markdown, but models drift, and every
    # stray asterisk or bullet gets pronounced out loud as literal noise —
    # which is precisely the "reading a document" sound we're removing.
    response_text = _clean_for_speech(response_text)

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
                    "pace": 1.1,
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
            # Label only — llm.generate() decides the real model.
            "model": os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest"),
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


def _wav_to_pcm16(audio: bytes) -> bytes:
    """Strip a RIFF/WAV container down to raw little-endian PCM16 samples.

    Sarvam TTS (and the Azure fallback, which requests
    riff-8khz-16bit-mono-pcm) both return a WAV container. mod_audio_stream
    plays RAW L16 only, so the 44-byte header has to come off or it is
    rendered as a click followed by shifted audio.
    """
    if not audio:
        return b""
    if audio[:4] != b"RIFF":
        return audio  # already raw
    try:
        with wave.open(io.BytesIO(audio), "rb") as wf:
            return wf.readframes(wf.getnframes())
    except Exception as e:  # noqa: BLE001 - never let playback kill the call
        log.warning(f"[FS] WAV parse failed ({e}); sending payload as-is")
        return audio


_TTS_SPOOL = "/tmp/recordings"


async def _esl_api(command: str, timeout: float = 5.0) -> str:
    """Minimal async ESL client — enough to issue one api command.

    The pipeline is network_mode: host, so FreeSWITCH's event socket is on
    127.0.0.1:8021 (it binds loopback only; see event_socket.conf.xml).
    """
    host = os.getenv("FREESWITCH_ESL_HOST", "127.0.0.1")
    port = int(os.getenv("FREESWITCH_ESL_PORT", "8021"))
    pw   = os.getenv("FREESWITCH_ESL_PASSWORD", "ClueCon")
    reader, writer = await asyncio.open_connection(host, port)
    try:
        await asyncio.wait_for(reader.readuntil(b"\n\n"), timeout)      # auth/request
        writer.write(f"auth {pw}\n\n".encode())
        await writer.drain()
        await asyncio.wait_for(reader.readuntil(b"\n\n"), timeout)      # +OK accepted
        writer.write(f"api {command}\n\n".encode())
        await writer.drain()
        hdr = await asyncio.wait_for(reader.readuntil(b"\n\n"), timeout)
        body = b""
        for line in hdr.split(b"\n"):
            if line.lower().startswith(b"content-length:"):
                n = int(line.split(b":")[1].strip())
                body = await asyncio.wait_for(reader.readexactly(n), timeout)
        return body.decode("utf-8", "replace").strip()
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass


# Fillers ship inside the pipeline image, but uuid_broadcast is executed by
# FreeSWITCH in a DIFFERENT container, which has no /app. The only path both
# containers share is /tmp/recordings (docker-compose.yml). Copy them there
# once at startup and hand FreeSWITCH a path it can actually open — the first
# attempt broadcast /app/assets/... and silently played nothing.
_FILLER_SRC = pathlib.Path(__file__).resolve().parent / "assets" / "fillers"
_FILLER_DIR = pathlib.Path(_TTS_SPOOL) / "fillers"


def _stage_fillers() -> list:
    try:
        _FILLER_DIR.mkdir(parents=True, exist_ok=True)
        for src in sorted(_FILLER_SRC.glob("*.wav")):
            dst = _FILLER_DIR / src.name
            if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                dst.write_bytes(src.read_bytes())
        return sorted(_FILLER_DIR.glob("*.wav"))
    except Exception as e:  # noqa: BLE001
        log.warning(f"[FS] could not stage fillers: {e}")
        return []


_FILLERS = _stage_fillers()


def _demo_limit_for(profile: dict) -> int:
    """Per-profile demo cap, 0 = uncapped."""
    pid = str(profile.get("id") or "")
    per = os.getenv(f"DEMO_CALL_LIMIT_{pid[:8]}")
    val = per or os.getenv("DEMO_CALL_LIMIT", "")
    try:
        return int(val)
    except ValueError:
        return 0


async def _calls_so_far(db, voice_profile_id: str) -> int:
    """Count calls already taken on this profile. Fails OPEN.

    A demo that refuses to answer because a count query failed is far worse
    than one extra call, so any error here returns 0.
    """
    if not voice_profile_id:
        return 0
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(
                f"{db.url}/rest/v1/calls",
                headers={**db.headers, "Prefer": "count=exact", "Range": "0-0"},
                params={"voice_profile_id": f"eq.{voice_profile_id}", "select": "id"},
            )
            rng = r.headers.get("content-range", "")
            return int(rng.split("/")[-1]) if "/" in rng else 0
    except Exception as e:  # noqa: BLE001
        log.warning(f"[FS] demo count failed ({e}) — allowing the call")
        return 0


async def _play_demo_exhausted(fs_uuid: str, profile: dict) -> None:
    """Say the demo is over rather than dropping the caller into silence."""
    try:
        tts = SarvamTTS()
        msg = ("ధన్యవాదాలు. ఈ demo call limit అయిపోయింది. "
               "మా team మీకు త్వరలో contact చేస్తారు.")
        audio = await tts.synthesize(msg, "simran")
        if audio:
            await _send_audio_to_freeswitch(None, audio, fs_uuid, 99)
            await asyncio.sleep(_wav_duration_secs(audio) + 0.5)
    except Exception as e:  # noqa: BLE001
        log.error(f"[FS] demo-exhausted message failed: {e}")


def _assistant_name(profile: dict) -> str:
    """What she calls herself. Per-tenant, not always "Nikki"."""
    return (profile.get("display_name") or "నిక్కి").strip()


def _greeting_text(profile: dict) -> str:
    """Warm brand greeting, spoken right after the TRAI disclosure.

    Previously the caller heard the disclosure and then silence — she waited
    for them to speak first, which on a phone call reads as a dead line.
    """
    biz  = (profile.get("business_name") or "").strip()
    name = _assistant_name(profile)
    return (f"నమస్కారం! Welcome to {biz}. నేను {name}. "
            f"చెప్పండి, మీకు ఏం కావాలి?")


async def _greeting_audio(agent) -> bytes:
    """Greeting audio, cached per profile on first use.

    Cached to the shared spool so every later call on that profile plays it
    instantly instead of paying a TTS round-trip at answer time — the same
    reason the TRAI disclosure is pre-generated. Works for any tenant with
    no per-tenant asset to build.
    """
    pid = str((agent.profile or {}).get("id") or "default")
    path = pathlib.Path(_TTS_SPOOL) / f"greet_{pid}.wav"
    try:
        if path.exists() and path.stat().st_size > 1000:
            return path.read_bytes()
        audio = await agent.tts.synthesize(_greeting_text(agent.profile), agent.voice)
        if audio:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(audio)
        return audio or b""
    except Exception as e:  # noqa: BLE001 - never block the call on a greeting
        log.warning(f"greeting failed: {e}")
        return b""


_SENT_SPLIT = re.compile(r"(?<=[.!?\u0964])\s+")


def _speech_chunks(text: str, first_max: int = 55, max_chunks: int = 4) -> list:
    """Split a reply for playback, keeping the FIRST chunk deliberately short.

    Time-to-first-audio is governed entirely by how long the first chunk
    takes to synthesise, and Sarvam's latency scales with input length.
    Splitting on sentence boundaries alone is not enough — measured, a
    single long Telugu sentence still produced 5.3s of audio and ~1.9s of
    synthesis, i.e. no better than sending the whole reply.

    So the first chunk is capped at ~55 characters, falling back through
    sentence -> clause (comma) -> word boundary. Everything after it is
    synthesised while it plays, so only this first cut is on the critical
    path. Chunks are never split mid-word: Sarvam would pronounce the
    fragments as separate utterances.
    """
    text = (text or "").strip()
    if not text:
        return []

    sentences = [p.strip() for p in _SENT_SPLIT.split(text) if p.strip()]
    head = sentences[0] if sentences else text
    rest = " ".join(sentences[1:]) if len(sentences) > 1 else ""

    if len(head) > first_max:
        cut = head.rfind(",", 0, first_max + 1)
        if cut < first_max // 2:
            cut = head.rfind(" ", 0, first_max + 1)
        if cut > 0:
            rest = (head[cut + 1:].strip() + " " + rest).strip()
            head = head[:cut + 1].strip()

    chunks = [head] + ([rest] if rest else [])
    if len(chunks) <= max_chunks:
        return [c for c in chunks if c]
    return chunks[:max_chunks - 1] + [" ".join(chunks[max_chunks - 1:])]


async def _speak_chunked(agent, ws, fs_uuid: str, text: str,
                         seq: int, speaking: dict) -> None:
    """Synthesise chunk N+1 while chunk N is still playing.

    uuid_broadcast INTERRUPTS whatever is playing rather than queueing, so
    each chunk is held until the previous one has actually finished — the
    same reason the greeting had to wait for the disclosure.
    """
    chunks = _speech_chunks(text)
    if not chunks:
        return
    audio = await agent.tts.synthesize(chunks[0], agent.voice)
    sub = 0
    for i, nxt in enumerate(chunks[1:] + [None]):
        if not audio:
            return
        dur = _wav_duration_secs(audio)
        speaking["until"] = time.monotonic() + dur
        await _send_audio_to_freeswitch(ws, audio, fs_uuid, seq * 10 + sub)
        sub += 1
        if nxt is None:
            return
        # Synthesise the next chunk DURING playback of this one.
        nxt_task = asyncio.create_task(agent.tts.synthesize(nxt, agent.voice))
        await asyncio.sleep(max(0.0, dur - 0.15))
        audio = await nxt_task


async def _run_turn(agent, ws, fs_uuid: str, utterance_pcm: bytes,
                    seq: int, speaking: dict) -> None:
    """One STT -> LLM -> TTS -> playback turn, as a cancellable task.

    Runs detached so the receive loop keeps reading frames while Nikki is
    talking. That is what makes barge-in possible at all — and it means a
    cancel here must leave the call healthy, so CancelledError is allowed
    to propagate untouched and everything else is swallowed.
    """
    try:
        asyncio.create_task(_play_filler(fs_uuid))
        wav_bytes = _pcm16_to_wav_bytes(utterance_pcm)
        reply_text = await agent.on_speech(wav_bytes, want_text=True)
        if not reply_text:
            return
        # speaking["until"] is published inside, before each chunk is sent, so
        # a caller who interrupts immediately still trips the barge-in check.
        await _speak_chunked(agent, ws, fs_uuid, reply_text, seq, speaking)
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        log.error(f"[FS] {fs_uuid}: turn failed: {e}")


def _wav_duration_secs(audio: bytes) -> float:
    try:
        with wave.open(io.BytesIO(audio), "rb") as wf:
            return wf.getnframes() / float(wf.getframerate() or 8000)
    except Exception:  # noqa: BLE001
        return len(audio) / (8000.0 * 2)


async def _play_filler(fs_uuid: str) -> None:
    """Say "I heard you" the instant speech ends, while the turn is computed.

    Measured on a live call: 0.52s VAD + ~1.0s STT + 1.23s LLM + 1.29s TTS
    = roughly 4.2s of pure silence before Nikki said anything. A human
    receptionist never goes quiet that long — they say "హా.." and keep the
    line alive. This is perceived latency, not real latency: the turn takes
    just as long, but the caller stops feeling ignored and stops repeating
    themselves into the gap.

    Fired and forgotten — it must never delay or fail the actual reply. A
    different filler each turn, because the same one every time sounds more
    robotic than silence.
    """
    if not _FILLERS or not fs_uuid:
        return
    try:
        pick = _FILLERS[int.from_bytes(os.urandom(2), "big") % len(_FILLERS)]
        await _esl_api(f"uuid_broadcast {fs_uuid} {pick} aleg")
    except Exception as e:  # noqa: BLE001 - cosmetic only
        log.debug(f"[FS] filler skipped: {e}")


async def _send_audio_to_freeswitch(ws, audio: bytes, fs_uuid: str, seq: int = 0) -> None:
    """Play TTS audio to the caller.

    IMPORTANT: mod_audio_stream in this build is CAPTURE-ONLY. Its symbol
    table has switch_core_media_bug_read but no write-replace, no
    switch_core_file_* and no broadcast - it can stream audio out to this
    websocket but cannot inject any back into the call. ws.send_bytes() was
    silently discarded, and so was a correctly-formed streamAudio JSON frame
    (no spool file was ever written). That is why the caller heard nothing
    while Sarvam TTS returned 200 OK.

    So playback goes through FreeSWITCH itself: write the WAV to the volume
    both containers share (/tmp/recordings, see docker-compose.yml) and ask
    FreeSWITCH to play it into the A-leg via uuid_broadcast. The file is
    removed once queued - /tmp is tmpfs here, so leaving them would consume
    RAM against a 5.6GB ceiling.
    """
    if not audio or not fs_uuid:
        return
    path = os.path.join(_TTS_SPOOL, f"tts_{fs_uuid}_{seq}.wav")
    try:
        os.makedirs(_TTS_SPOOL, exist_ok=True)
        with open(path, "wb") as f:
            f.write(audio)
            f.flush()
            os.fsync(f.fileno())
        res = await _esl_api(f"uuid_broadcast {fs_uuid} {path} aleg")
        if not res.startswith("+OK"):
            log.warning(f"[FS] {fs_uuid}: uuid_broadcast returned {res!r}")
    except Exception as e:  # noqa: BLE001 - playback must never kill the call
        log.error(f"[FS] {fs_uuid}: playback failed: {e}")
    finally:
        # Queued by FreeSWITCH by now; broadcast reads it asynchronously, so
        # give it a moment before reclaiming the tmpfs space.
        async def _cleanup(p: str) -> None:
            await asyncio.sleep(60)
            try:
                os.remove(p)
            except OSError:
                pass
        asyncio.create_task(_cleanup(path))


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

    # r2_public_url included deliberately: without it the upload succeeds but
    # recording_url is stored as "/tenant/call.wav" — a relative path no
    # dashboard can play, and nothing errors to tell you.
    if not all([cf_account_id, r2_access_key, r2_secret, r2_public_url]):
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

    # ── DEMO CALL CAP ────────────────────────────────────────────────────
    # A client demo profile is capped so it cannot be dialled indefinitely
    # (or run up API cost) after the meeting. Counted from the calls table
    # rather than memory, so it survives a container restart. Set
    # DEMO_CALL_LIMIT_<profile-id-prefix> or the global DEMO_CALL_LIMIT.
    limit = _demo_limit_for(profile)
    if limit:
        used = await _calls_so_far(db, profile.get("id"))
        if used >= limit:
            log.warning(f"[FS] demo cap reached for {profile.get('business_name')}: "
                        f"{used}/{limit} — playing closing message")
            await _play_demo_exhausted(fs_uuid, profile)
            await ws.close(code=1000)
            return
        log.info(f"[FS] demo call {used + 1}/{limit} for {profile.get('business_name')}")

    agent = NikkiAgent(profile, caller_number)

    # ── Routing decision + call record (single source of truth) ──
    # The API server owns both: it resolves DID → tenant → routing_mode,
    # creates the calls row, and tells us how this call should be
    # handled. Previously the pipeline created its own row and ignored
    # routing_mode entirely, so a DID configured for human agents still
    # got the bot, and /webhooks/freeswitch/inbound was dead code.
    routing = {}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.post(
                f"{API_SERVER_URL}/webhooks/freeswitch/inbound",
                headers={"X-Internal-Secret": INTERNAL_SECRET},
                json={
                    "did_number":    did_number,
                    "caller_number": caller_number,
                    "fs_uuid":       fs_uuid,
                },
            )
            if r.status_code == 200:
                routing = r.json()
    except Exception as e:
        log.warning(f"[FS] routing lookup failed ({e}) — defaulting to AI")

    # Hand the call to human agents when the DID says so. The API server
    # has already checked there is somebody to ring; if there wasn't, it
    # returns "ai" instead so the caller never lands in silence.
    if routing.get("routing_mode") == "human" and routing.get("ring_group"):
        log.info(f"[FS] {fs_uuid}: routing_mode=human — transferring to ring group")
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                await client.post(
                    f"{API_SERVER_URL}/webhooks/freeswitch/transfer-to-human",
                    headers={"X-Internal-Secret": INTERNAL_SECRET},
                    json={
                        "fs_uuid":       fs_uuid,
                        "ring_group":    routing["ring_group"],
                        "guard_seconds": routing.get("missed_call_seconds", 20),
                    },
                )
        except Exception as e:
            log.error(f"[FS] human transfer failed: {e} — continuing with AI")
        else:
            await ws.close(code=1000)
            return

    agent.call_id = routing.get("call_id")
    if not agent.call_id:
        # API server unreachable — still log the call so it isn't lost.
        agent.call_id = await db.save_call({
            "tenant_id":        profile["tenant_id"],
            "voice_profile_id": profile["id"],
            "caller_number":    caller_number,
            "direction":        "inbound",
            "status":           "active",
            "livekit_room_id":  fs_uuid,
        })

    call_start_ts = time.time()
    recording_pcm = bytearray()   # accumulate all PCM for R2 upload
    speech_buf    = bytearray()   # current utterance buffer
    silence_count = 0
    speech_count  = 0
    turn_seq       = 0            # unique suffix per TTS clip for this call
    turn_task      = None         # in-flight STT->LLM->TTS turn (cancellable)
    # Mutable so the detached turn task can publish when her audio will
    # finish; a plain local could not be written from inside the task.
    speaking       = {"until": 0.0}
    frame_secs     = None         # measured from the first frame received
    silence_needed = _SILENCE_FRAMES
    speech_needed  = _MIN_SPEECH_FRAMES
    cfg           = {}
    disclosure_sent = False

    try:
        # Load platform config for automation routing
        cfg = await _read_platform_config()

        # Send TRAI disclosure audio immediately on connect
        disclosure_audio = await agent.on_call_start()
        if disclosure_audio:
            await _send_audio_to_freeswitch(ws, disclosure_audio, fs_uuid, 0)
            # uuid_broadcast returns as soon as the clip is QUEUED, not when
            # it finishes. Without waiting, the greeting cuts the disclosure
            # off mid-sentence — and the disclosure is the regulatory part.
            await asyncio.sleep(_wav_duration_secs(disclosure_audio) + 0.2)
        disclosure_sent = True

        greet = await _greeting_audio(agent)
        if greet:
            await _send_audio_to_freeswitch(ws, greet, fs_uuid, 1)
            speaking["until"] = time.monotonic() + _wav_duration_secs(greet)
            turn_seq = 1

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

                # Derive the VAD counters from the ACTUAL frame duration
                # rather than assuming 20ms. mod_audio_stream's
                # STREAM_BUFFER_SIZE (320 in the dialplan) is milliseconds,
                # not bytes, so frames arrive far longer than 20ms. The
                # hard-coded _SILENCE_FRAMES=16 therefore demanded ~5.1s of
                # CONTINUOUS silence before STT fired — longer than any
                # natural pause, which is why STT never fired once in
                # production. Deriving from len(frame) is correct whatever
                # the unit turns out to be.
                if frame_secs is None:
                    frame_secs = max(len(frame) / (8000 * 2), 0.001)
                    # 0.40s, down from 0.60s. Barge-in makes an early start
                    # recoverable — the caller simply talks over her and she
                    # stops — whereas a long pause is dead air on every turn.
                    silence_needed = max(1, round(0.40 / frame_secs))
                    speech_needed  = max(1, round(0.06 / frame_secs))
                    log.info(
                        f"[FS] {fs_uuid}: frame={len(frame)}B "
                        f"({frame_secs*1000:.0f}ms) silence_needed={silence_needed} "
                        f"speech_needed={speech_needed}"
                    )

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

                # ── BARGE-IN ──────────────────────────────────────────────
                # The caller started talking while Nikki is still speaking.
                # Cut her off, exactly as a person would be cut off. This is
                # only possible because the turn below runs as a task: the
                # previous code awaited it inline, so this loop was blocked
                # for the whole reply and the caller's audio just queued —
                # she physically could not be interrupted.
                if is_speech and time.monotonic() < speaking["until"]:
                    speaking["until"] = 0.0
                    asyncio.create_task(_esl_api(f"uuid_break {fs_uuid} all"))
                    if turn_task and not turn_task.done():
                        turn_task.cancel()
                    log.info(f"[FS] {fs_uuid}: barge-in — caller interrupted")

                # Fire STT when we hit silence after speech
                if silence_count >= silence_needed and speech_count >= speech_needed:
                    utterance_pcm = bytes(speech_buf)
                    speech_buf    = bytearray()
                    speech_count  = 0
                    silence_count = 0

                    # Drop an in-flight turn: its answer is to a question the
                    # caller has already moved on from.
                    if turn_task and not turn_task.done():
                        turn_task.cancel()

                    turn_seq += 1
                    turn_task = asyncio.create_task(
                        _run_turn(agent, ws, fs_uuid, utterance_pcm,
                                  turn_seq, speaking))

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
        # Disabled: api-server/src/index.ts fires the same "missed-call" event
        # from /webhooks/freeswitch/hangup, where billsec and hangup_cause are
        # both available. Firing here too ran the tenant's follow-up flow twice
        # for one call.
        if False and duration < 8:
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

