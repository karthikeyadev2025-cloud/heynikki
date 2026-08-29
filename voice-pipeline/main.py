"""
Nikki — Telugu Voice Pipeline
FastAPI + LiveKit Agents + Sarvam STT/TTS + Gemini LLM
Run: uvicorn main:app --host 0.0.0.0 --port 8000
"""

import difflib
import hashlib
import os
import re
import json
import asyncio
from collections import deque
import logging
import pathlib
import base64
import secrets
import httpx
from datetime import datetime, timezone, timedelta
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
            environment=os.environ.get("HEYNIKKI_ENV", "development"),
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

_JANITOR_TASK = None


@app.on_event("startup")
async def _start_janitor() -> None:
    # Reference held module-level: asyncio keeps only a weak one, so an
    # unreferenced task can be garbage-collected mid-sleep and silently stop.
    global _JANITOR_TASK
    try:
        _JANITOR_TASK = asyncio.create_task(_spool_janitor())
        log.info("spool janitor started")
    except Exception as e:  # noqa: BLE001
        log.warning(f"spool janitor not started: {e}")

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
    "retail": """You are the phone assistant for an online jewellery brand. Callers have
ordered, or are about to.

HANDLE:
- Order status: take the order number and the phone used; the team confirms
  by WhatsApp. You CANNOT look up an order.
- Product questions: which categories exist, what a piece is made of.
- Returns: a damaged item can be returned; take the order number and what is
  wrong with it.
- Ordering: they can order over WhatsApp, or the team calls back.

PRICES: the Services list below carries each category's REAL price band from
the live catalogue. Quote it as a range — "earrings seven hundred nunchi rendu
vela varaku" — and offer to send exact prices on WhatsApp. Never quote a
figure for a SPECIFIC item; you have bands, not a per-product catalogue.

NEVER: promise a delivery date, discount or stock; invent an order status;
state where the business is located, ships from, or how long it has existed
unless it is in the block below. An invented location is as damaging as an
invented price. Never give a single exact price for one product.
If you cannot answer: say so and take the number.
"మా team WhatsApp లో confirm చేస్తారు" always closes safely.
Transfer on "human", "manager", "వేరే వ్యక్తి".

""",
    # Hey Nikki's OWN number — the live demo advertised on heynikki.in.
    # A caller here is a prospective customer, not a patient, so this SKU
    # sells the product. Every figure below is taken from the public site;
    # do not add to it. The DID was previously pointed at a "Hey Nikki Test
    # Clinic" profile offering Dental Checkup, so the demo line answered as
    # a fictional dental clinic.
    "heynikki": """You are Nikki, the assistant for Hey Nikki itself — a Telugu AI receptionist
service for Indian businesses, Hyderabad. The caller is a business owner
evaluating it. Answer their question FIRST and fully. Collecting their name,
number and business is secondary — ask once when it fits, never twice in a
row, and never instead of answering what they actually said.

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

PRICING: the live catalogue is injected below under [CURRENT PRICING].
Quote ONLY from it. Never quote a figure that is not there, never say
"unlimited" — plans are metered by minutes — and never add plans together
(see the arithmetic rule above). GST is extra on everything.

NEVER DO ARITHMETIC. Do not add up plans or quote a monthly total for a
combination. Tested with two different models: both got the multiplication
wrong and quoted a total that was off. State each line item at its own
price from the catalogue below, then say the team will send the exact total
on WhatsApp. A wrong total on a sales call is worse than no total.

RULES: anything not above — custom integrations, discounts, contract terms,
go-live dates — say the team will confirm and take their number. Never invent
a feature, price or promise. Never name a vendor you are built on. If asked
outright whether you are an AI, say yes.

""",
    "standard": """You are the receptionist for this business, answering its phone.

You can: book appointments, answer questions about the business, take a
callback, transfer to a person.
Transfer when they ask — "human", "real person", "manager", "వేరే వ్యక్తి":
say you are connecting them, then transfer.
Asked what you are: "మేము automated system ద్వారా పని చేస్తాము."
The call was already disclosed as automated. Do not disclose it again.
Never name a vendor or a technology.

""",
    "clinic": """You are the receptionist at this clinic, answering its phone.

You can: book a doctor's appointment, say when the clinic is open, take a
patient callback.
You cannot: give a price, a diagnosis, or a doctor's availability you were
not told. Say you will check, and offer a callback.
Medical emergency: say "Emergency ki 108 call cheyyandi" immediately, then
transfer.
Never name a vendor or a technology.
""",
    "real_estate": """You are the receptionist for this property business, answering its phone.

You can: arrange a site visit, answer questions about listed properties,
take a callback.
Worth learning when it fits naturally: buying, renting or selling, and
roughly what budget. Never push for it.
You cannot: quote a price or confirm availability you were not told.
Never name a vendor or a technology.
[MIDDLE BLOCK - PROPERTY DETAILS BELOW]
""",
    "premium": """You are the receptionist for this business, answering its phone. Warm and
precise — unhurried rather than stiff.

You can: schedule a meeting, capture what the caller needs, take a callback.
You cannot: quote pricing or an executive's availability you were not told.
Never name a vendor or a technology.
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
    # REWRITTEN. The previous version was 3710 characters of rules added one
    # at a time to patch symptoms, several of which contradicted each other —
    # which is what "sounds unreal" actually was. She was being asked to
    # satisfy instructions that cancel out:
    #
    #   "MAX 15-20 words"            vs "ONE sentence. Two only if..."
    #   "Zero filler. Direct only."  vs "Open naturally: అలాగే, సరే..."
    #   "One answer or one question" vs "say the name back AND carry on"
    #
    # It also literally instructed the token "ఆc" — Telugu ఆ with a Latin c —
    # which she duly said out loud on a call.
    #
    # Written positively now: who she is and how she speaks, rather than
    # fifteen prohibitions. Every negative that remains earned its place by
    # being something that actually went wrong on a real call.
    #
    # Kept short deliberately. Prefill sits on the caller's critical path: a
    # 5841-char prompt measured ~2045ms per turn against ~1004ms for a
    # minimal one. Do not re-add prose without re-measuring.
    "\n\n[HOW YOU SPEAK]"
    "\nThis is a live phone call. Everything you write is spoken aloud, so"
    " talk the way people talk, not the way forms read."
    "\n- One sentence. A second only if it is a question."
    "\n- Lead with the answer."
    "\n- Begin the way a person does — అలాగే, సరే, అవునా, ఓహ్, అర్థమైంది — and"
    " vary it. Never open two replies in a call the same way."
    "\n- React to what they said before you ask anything."
    "\n- Telugu script. Follow the caller into Hindi or English if they go there."
    "\n- Say these in English, as everyone does: appointment, doctor, time,"
    " number, WhatsApp, confirm, booking, address, cancel."
    "\n- Spoken Telugu, never officialese: చెప్పండి, not తెలియజేయండి. Open with"
    " \'చెప్పండి\' — never \'మీకు ఎలా సహాయం చేయగలను\', which is how a call centre"
    " script sounds, not a person."
    "\n- గారు after a name, in Telugu script. Use their name now and then,"
    " not in every sentence."
    "\n- At most two options aloud. No lists, markdown, emoji or asterisks."
    "\n\n[WHAT YOU KNOW FOR CERTAIN]"
    "\nThe business name, working hours, open days and services listed below"
    " are FACTS. State them plainly and confidently — never say you do not"
    " know them, and never guess around them. If a day is not in the open"
    " days, the business is closed that day: say so and offer the next open"
    " one. Today\'s date is given below, so work out what \'tomorrow\' is"
    " before agreeing to it."
    "\nWrite the business name exactly as it is given. Never re-spell it."
    "\n\n[WHAT YOU NEVER DO]"
    "\n- Never invent a price, a doctor\'s availability, or any fact NOT"
    " listed below. Say you will find out, and offer a callback."
    "\n- Never ask for the same thing twice in a row. If they did not answer,"
    " move on — much later, or not at all."
    "\n- Never send a reply they have already heard. A caller repeating"
    " themselves or sounding annoyed is telling you the last one failed."
    "\n- Never claim to be a person. Asked outright, say you are an"
    " assistant, and carry on."
    "\n\n[WHEN IT GOES SIDEWAYS]"
    "\nIf they are confused, joking, testing you, or asking about you rather"
    " than the business, answer THAT in one short sentence and stop — do not"
    " repeat your request in the same breath. \'ఏం మాట్లాడుతున్నావ్\' means you"
    " are not making sense: apologise, say plainly what you can do, and wait."
    "\n\n[REGISTER]"
    "\n- ALWAYS: గారు after every name; -ండి on every imperative (చెప్పండి,"
    " రండి); అండి on bare answers (అవునండి, లేదండి, సరేనండి); మీరు, never నువ్వు."
    "\n- English loans stay English with Telugu suffixes: అపాయింట్‌మెంట్‌కి,"
    " డాక్టర్ గారికి, టైంలో. Never translate them: నియామకం, వైద్యుడు,"
    " ధన్యవాదములు, స్వాగతం, వీడ్కోలు are BANNED — that is a government notice,"
    " not a person."
    "\n- Deflection shape: softener + reason + redirect — \'అదండీ... డాక్టర్"
    " గారు చూశాకే చెప్పగలరండి. అపాయింట్‌మెంట్ పెట్టమంటారా?\' Never a flat no."
    "\n- Bad news or a wrong number opens with అయ్యో or పర్వాలేదండి."
    "\n- Close with \'థాంక్యూ అండి, మంచిది\' or \'ఉంటానండి\' — never a formal"
    " goodbye."
    "\n- Times in words with the day part: పొద్దున పదిన్నరకి, సాయంత్రం నాలుగున్నరకి"
    " — never \'10:30\' or \'PM\'."
    "\n\n[WHAT YOU ARE COLLECTING]"
    "\nHelping comes first; this is secondary. Their name and a 10-digit"
    " number, plus whatever this business needs. Take everything they"
    " volunteer at once and never ask for it again. One item at a time, in"
    " whatever order it comes. Ask for an appointment day only if this"
    " business books appointments. Missed it: \'ఒక్కసారి మళ్ళీ చెప్తారా?\'"
)


_PRICING_CACHE: dict = {"at": 0.0, "text": ""}


async def _refresh_pricing() -> None:
    """Pull the live catalogue so Nikki quotes what the billing page charges.

    Pricing used to be hardcoded here AND in the billing page AND in
    platform_config, which is how a caller ended up quoted Rs 5,999
    "unlimited" for a plan that did not exist. The API server owns it now;
    this only formats it for speech.

    Cached for 10 minutes and failure-tolerant: if the catalogue cannot be
    fetched Nikki simply has no prices to quote, which is far better than
    quoting stale ones.
    """
    if time.time() - _PRICING_CACHE["at"] < 600:
        return
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(f"{API_SERVER_URL}/api/platform/pricing")
        if r.status_code != 200:
            return
        d = r.json()
        rup = lambda p: f"{int(p) // 100:,}"
        # The model recited this header verbatim into a reply — a caller was
        # read the literal words "[CURRENT PRICING — quote only these
        # figures]" followed by the whole tariff. This is reference data, not
        # a script, and on a voice call nobody wants the full price list read
        # at them: say the one plan that fits and stop.
        lines = ["\n\n[REFERENCE — internal price list. NEVER read this heading or the "
                 "whole list aloud. Quote at most ONE plan, only the figure asked for, "
                 "and never invent a plan or a price that is not listed here.]"]
        for t in d.get("tiers", []):
            lines.append(
                f"\n- {t.get('name')}: Rs {rup(t.get('monthly_paise', 0))}/month, "
                f"{t.get('minutes')} minutes, {t.get('numbers')} number(s), "
                f"{t.get('concurrent')} calls at once."
            )
        a = d.get("addons", {})
        lines.append(f"\n- Pay as you go: Rs {int(d.get('per_minute_paise', 350)) / 100:.2f} per minute, no monthly commitment.")
        lines.append(f"\n- Extra CRM seat: Rs {rup(a.get('crm_seat_paise', 0))}/seat/month.")
        lines.append(f"\n- Extra number: Rs {rup(a.get('number_paise', 0))}/number/month.")
        lines.append(f"\n- Extra minutes beyond the plan: Rs {int(d.get('overage_paise', 1500)) / 100:.2f} per minute.")
        lines.append("\nGST extra. Cancel any month.")
        _PRICING_CACHE.update({"at": time.time(), "text": "".join(lines)})
    except Exception as e:  # noqa: BLE001
        log.debug(f"pricing refresh skipped: {e}")


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
    # The weekday, spelled out. Without it the model cannot tell whether
    # "tomorrow" falls on a day the business is shut — it told a caller with
    # toothache to come tomorrow, which was a Sunday, on a Mon-Sat clinic.
    weekday = datetime.now().strftime("%A")
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
Today: {now} ({weekday})

""" + TELUGU_PHONE_PERSONA + _PRICING_CACHE.get("text", "")

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

    def _cache_path(self, text: str, speaker: str, rate: int = 8000) -> str:
        h = hashlib.sha1(f"{speaker}|{rate}|{text}".encode("utf-8")).hexdigest()
        return os.path.join(self._CACHE_DIR, f"{h}.wav")

    async def synthesize(self, text: str, speaker: str = "priya",
                         rate: int = 8000) -> bytes:
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
        key = self._cache_path(text, speaker, rate)
        try:
            if os.path.exists(key) and os.path.getsize(key) > 1000:
                with open(key, "rb") as f:
                    return f.read()
        except OSError:
            pass

        audio = await self._synthesize_uncached(text, speaker, rate)

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

    async def _synthesize_uncached(self, text: str, speaker: str = "priya",
                                   rate: int = 8000) -> bytes:
        # No word cap. The old 20-word truncation amputated the tail of every
        # multi-sentence reply — usually the closing question, which is the
        # part that keeps a conversation moving. Length control belongs to the
        # prompt ("one sentence") and to _speak_chunked, which splits long
        # replies into sentence chunks; discarding words at the TTS layer is
        # a silent mutilation the model never learns about. bulbul accepts
        # 2,500 chars; guard only against that hard limit.
        if len(text) > 2400:
            log.warning(f"TTS input {len(text)} chars — clamping to 2400")
            text = text[:2400]

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
                        # 8000 for the phone, where the trunk is narrowband
                        # anyway; 22050 for a browser. The landing-page agent
                        # was synthesising at 8k and playing it through laptop
                        # speakers — telephone audio on a hi-fi output, which
                        # is thin and metallic and reads as "scary" rather than
                        # as a person.
                        "speech_sample_rate": rate,
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
        # Consecutive turns that fell through to a fallback. A caller hears
        # the SAME stall line every failed turn otherwise, so the second one
        # has to say something different from the first — see _stall_reply.
        self._consecutive_failures = 0
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

        # Backstop for the shape rule above: a trailing model turn is a 400,
        # and a 400 mid-call costs the caller a whole turn — the fallback is
        # keyless, so they just hear "ఒక్క నిమిషం." and nothing follows.
        # Every caller should hand us a history ending on the user turn being
        # answered; trim instead of letting a slip here kill the turn.
        while parts_history and parts_history[-1]["role"] == "model":
            log.warning("Gemini: history ended on a model turn — trimming")
            parts_history.pop()

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
            # ONE retry on a transient failure, before anything the caller hears.
            #
            # A single 8s attempt with no retry meant one slow response — a
            # timeout raises httpx.HTTPError with an empty message, which is
            # exactly what the logs showed — fell straight through to the
            # OpenAI fallback. OPENAI_API_KEY is not set, so that returned
            # nothing too, and the caller was told "I didn't hear you" for a
            # question they had asked perfectly clearly. In an eight-turn test
            # conversation this happened once. Every eighth turn.
            #
            # 7s then 6s, so the worst case is 13s rather than the 16s a naive
            # doubling would give; a retry after a blip usually lands in about
            # a second. Only connect/read failures are retried — a 400 is our
            # own bad request and will fail again identically.
            data = None
            last_exc = None
            for attempt, budget in enumerate((7.0, 6.0)):
                try:
                    async with httpx.AsyncClient(timeout=budget) as client:
                        resp = await client.post(
                            self.base_url,
                            headers=headers,
                            params=params,
                            json=payload
                        )
                        resp.raise_for_status()
                        data = resp.json()
                    break
                except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
                    last_exc = e
                    if attempt == 0:
                        log.warning(f"Gemini transient ({type(e).__name__}) — retrying once")
                        continue
                    raise
            if data is None:
                raise last_exc or RuntimeError("Gemini returned no data")

            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    text = parts[0].get("text", "").strip()
                    # Vendor name filter — strip before TTS
                    for vendor in ["Sarvam", "Gemini", "LiveKit", "Exotel", "Plivo", "supabase", "OpenAI"]:
                        text = text.replace(vendor, "our system")
                    self._consecutive_failures = 0
                    return text
        except httpx.HTTPError as e:
            log.error(f"Gemini error: {e} — trying GPT-4o-mini fallback")
            return await self._openai_fallback(system_prompt, recent)
        except Exception as e:
            log.error(f"Gemini unexpected: {e}")

        return self._stall_reply()


    def _stall_reply(self) -> str:
        """What to say when the model gave us nothing.

        The old answer was "ఒక్క నిమిషం." — one minute — on every failed
        turn. That is a STALL: it promises something is coming. Nothing was,
        so the caller waited, repeated themselves, and got "one minute"
        again. Scored calls show the whole conversation as nothing but that
        line, flagged "call deadlocked in hold loop" and "dead air", and it
        is the single biggest drag on call quality.

        A failure should ask for a retry, not promise an answer. And it must
        not repeat itself: by the second consecutive failure the honest move
        is to stop pretending and offer a callback, which at least ends with
        a number in the CRM rather than a hang-up.
        """
        self._consecutive_failures += 1
        if self._consecutive_failures >= 3:
            return ("క్షమించండి, ఈ కాల్‌లో సమస్య ఉంది. "
                    "మీ ఫోన్ నంబర్ చెప్తే మా టీమ్ మీకు తిరిగి కాల్ చేస్తుంది.")
        if self._consecutive_failures == 2:
            return "క్షమించండి, ఇంకా వినిపించలేదు. కొంచెం నెమ్మదిగా చెప్తారా?"
        return "క్షమించండి, నాకు సరిగ్గా వినిపించలేదు. మళ్ళీ చెప్తారా?"

    async def _openai_fallback(self, system_prompt: str, history: list) -> str:
        """GPT-4o-mini fallback if Gemini fails."""
        try:
            openai_key = os.environ.get("OPENAI_API_KEY", "")
            if not openai_key:
                # No fallback model is configured, so this IS the answer the
                # caller gets. It has to be a usable one.
                return self._stall_reply()
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
        return self._stall_reply()


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

    async def get_caller_history(self, caller_number: str, voice_profile_id: str) -> dict:
        """What we already know about this caller, for a human opening.

        Nothing made Nikki feel more like a machine than greeting a caller
        who had rung five times that day exactly as if he were a stranger.
        A receptionist says "మళ్ళీ కాల్ చేశారు కదా" — recognition is most of
        what makes a business feel like it knows you.

        Returns {} on any failure: a cold greeting is a small loss, a failed
        call is not.
        """
        digits = "".join(c for c in (caller_number or "") if c.isdigit())[-10:]
        if not digits or not voice_profile_id:
            return {}
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(
                    f"{self.url}/rest/v1/calls",
                    headers=self.headers,
                    params={"caller_number": f"like.*{digits}",
                            "voice_profile_id": f"eq.{voice_profile_id}",
                            "select": "id,created_at,intent,status",
                            "order": "created_at.desc", "limit": "5"},
                )
                rows = r.json() if r.status_code == 200 else []
                if not isinstance(rows, list) or not rows:
                    return {}
                return {"previous_calls": len(rows), "last_call_at": rows[0].get("created_at"),
                        "last_intent": next((x.get("intent") for x in rows if x.get("intent")), None)}
        except Exception as e:  # noqa: BLE001
            log.debug(f"caller history lookup failed: {e}")
            return {}

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
# Rolling per-stage timings across ALL calls, for /health percentiles.
# In-memory on purpose: it answers "is the fleet fast right now", and a
# restart resetting it is fine — the per-call truth lives on the call rows.
_TURN_STATS: "deque" = deque(maxlen=500)


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
        self.caller_history: dict = {}
        self.fs_uuid     : str = ""      # set by the FreeSWITCH handler
        self.ring_group  : str = ""      # who to ring on a human request
        self.guard_seconds: int = 20
        self.transfer_requested: bool = False
        self.slots       : dict = {"name": None, "phone": None,
                                   "service": None, "when": None}
        self.call_id     : Optional[str] = None
        # Set when a booking is written mid-call; enriched at call end.
        self.appointment_id: Optional[str] = None
        self.intent      : str = "unknown"
        self.turn_timings: list = []      # per-turn stage ms, saved at hangup
        self.expect_dictation: bool = False
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

    # "నా పేరు కార్తికేయ", "పేరు రవి", "my name is Ravi", "I am Ravi",
    # "myself Ravi", "this is Ravi". Captures 1-3 words — Indian names are
    # commonly two, occasionally three.
    _NAME_RE = re.compile(
        r"(?:నా\s*పేరు|పేరు|my\s+name\s+is|myself|i\s+am|this\s+is)\s+"
        r"([\u0C00-\u0C7FA-Za-z]+(?:\s+[\u0C00-\u0C7FA-Za-z]+){0,2})",
        re.I,
    )
    # Trailing politeness that is not part of the name.
    _NAME_TAIL = re.compile(r"\s*(?:గారు|అండి|అండీ|garu|andi)\s*$", re.I)

    def _harvest_slots(self, text: str) -> None:
        """Pull durable facts out of a turn so they outlive the history window.

        This extracted ONLY the phone number, while claiming to preserve
        durable facts. The name — the single thing a caller most objects to
        repeating — was never kept, so once it scrolled out of the rolling
        window it was gone and Nikki asked again. Scored calls show exactly
        that, with the caller finally saying
        "ఎన్ని సార్లు చెప్పాలి నా పేరు ఫోన్ నెంబరు?" — how many times must I
        say my name and number.

        [FACTS ALREADY COLLECTED — never ask for these again] was already
        being injected every turn. It simply had nothing but a phone number
        to put in it.
        """
        if not self.slots.get("phone"):
            m = self._PHONE_RE.search(re.sub(r"\D", "", text or ""))
            if m:
                self.slots["phone"] = m.group(0)
                log.info(f"slot: phone={m.group(0)}")

        if not self.slots.get("name"):
            name = None
            m = self._NAME_RE.search(text or "")
            if m:
                name = m.group(1)
            else:
                # Bare answer to a direct question: "మీ పేరు?" -> "కార్తికేయ".
                # Only trusted when the PREVIOUS assistant turn actually asked
                # for a name, otherwise any two words become someone's name.
                last_bot = next(
                    (t["content"] for t in reversed(self.transcript)
                     if t.get("role") == "assistant"), "")
                asked_name = bool(re.search(r"పేరు|name", last_bot or "", re.I))
                words = (text or "").strip().split()
                if asked_name and 1 <= len(words) <= 3 and not any(c.isdigit() for c in text):
                    name = " ".join(words)
            if name:
                name = self._NAME_TAIL.sub("", name).strip(" .,!?")
                # Guard against capturing a refusal or a question back.
                if 2 <= len(name) <= 60 and not re.search(r"\?|చెప్పను|తెలియదు", name):
                    self.slots["name"] = name
                    log.info(f"slot: name={name}")

    def _known_facts_block(self) -> str:
        """Re-state confirmed facts every turn, and forbid inventing a booking.

        The rolling window is a cost control, not a memory: anything older than
        it is simply gone. Facts therefore have to be re-injected, and the
        model has to be told explicitly not to claim a booking it cannot
        support — on a live call it twice said "మీ appointment confirm అయింది"
        while holding no phone number at all.
        """
        known = {k: v for k, v in self.slots.items() if v}
        lines = []
        h = self.caller_history or {}
        if h.get("previous_calls"):
            lines.append(
                f"\n\n[THIS CALLER HAS RUNG BEFORE — {h['previous_calls']} time(s)]"
                "\nAcknowledge it once, naturally, early — then move on. Do not "
                "recite their history back at them, and never claim to remember "
                "a detail you were not given below."
            )
        lines.append("\n\n[FACTS ALREADY COLLECTED — never ask for these again]")
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
            # Per-stage wall clock. The industry gap between claimed and
            # production latency is 2-4x, and only per-stage numbers say
            # which leg to fix — Sierra's practice, adopted. Written onto the
            # call row at hangup; percentile summary at /health.
            _t0 = time.monotonic()
            user_text = await self.stt.transcribe(audio_bytes)
            _t_stt = time.monotonic() - _t0
            if not user_text.strip():
                # MUST respect want_text. Returning audio here made
                # _speech_chunks run a regex over bytes — "cannot use a string
                # pattern on a bytes-like object" — which killed the whole turn
                # and gave the caller SILENCE instead of "say that again".
                # Seen 4 times on live calls, including on a request for a human.
                log.info("STT returned nothing — asking the caller to repeat")
                msg = "ఒక్కసారి మళ్ళీ చెప్తారా?"
                return msg if want_text else await self.tts.synthesize(msg, self.voice)

            log.info(f"STT: {user_text}")
            self._harvest_slots(user_text)
            self.transcript.append({"role": "user", "content": user_text, "ts": datetime.now().isoformat()})
            self.history.append({"role": "user", "content": user_text})

            # Intent detection (keyword based, fast, no extra LLM call)
            self.intent = self._detect_intent(user_text)

            # Check for transfer trigger
            if self.intent == "transfer":
                msg = await self._handle_transfer()
                self.history.append({"role": "assistant", "content": msg})
                log.info(f"LLM (transfer): {msg}")
                return msg if want_text else await self.tts.synthesize(msg, self.voice)

            # Generate response
            response = await self.llm.generate(
                self.system_prompt + self._known_facts_block(), self.history)
            _t_llm = time.monotonic() - _t0 - _t_stt
            log.info(f"LLM: {response}")
            # The model often normalises spoken digits ("ట్రిపుల్ ఎయిట్...")
            # into a real number in its reply, so harvest that side too.
            self._harvest_slots(response)

            self.history.append({"role": "assistant", "content": response})
            self.transcript.append({"role": "assistant", "content": response, "ts": datetime.now().isoformat()})

            # Did she just ask for a number? Then the NEXT turn is dictation:
            # a caller reading out a mobile number pauses mid-way ("తొమ్మిది
            # ఎనిమిది నాలుగు ఎనిమిది... ఒక్క నిమిషం..."), and a fixed 400ms
            # window fires in that pause, clips the number in half, and she
            # asks again — the fastest way a call starts feeling broken.
            # LiveKit's turn-detector covers 14 languages, none of them
            # Telugu, so this signal comes from our own side of the dialogue
            # instead: her question tells us what shape the answer will be.
            self.turn_timings.append({
                "stt_ms": round(_t_stt * 1000),
                "llm_ms": round(_t_llm * 1000),
            })
            _TURN_STATS.append((round(_t_stt * 1000), round(_t_llm * 1000)))

            self.expect_dictation = bool(re.search(
                r"నంబర్|ఫోన్|number|mobile|మొబైల్|digits", response, re.I))

            # If appointment booked, handle async (don't delay audio)
            if self.intent == "appointment":
                # Keep a reference: asyncio holds only a weak one, so an
                # unreferenced task can be garbage-collected mid-await and
                # the booking silently lost on a fast hangup.
                _t = asyncio.create_task(
                    self._handle_appointment_booking(user_text, response))
                self._bg_tasks.add(_t)
                _t.add_done_callback(self._bg_tasks.discard)

            # Deterministic anti-loop backstop. Prompt rules are advisory and a
            # small model still repeats itself: on a live call Nikki demanded
            # the caller's phone number six times in a row, in near-identical
            # words, while he was telling her she was not making sense. Compare
            # against the last thing she said and regenerate once if it is
            # essentially the same sentence.
            prev = next((h["content"] for h in reversed(self.history[:-1])
                         if h.get("role") == "assistant"), "")
            if prev and response:
                sim = difflib.SequenceMatcher(None, prev.strip(), response.strip()).ratio()
                if sim > 0.72:
                    log.info(f"anti-loop: reply {sim:.0%} similar to previous — regenerating")
                    # self.history[:-1], NOT self.history. The reply we are about
                    # to discard was appended above, so self.history ends on an
                    # assistant turn, and Gemini answers that with a hard 400:
                    # "Requests ending with a model turn are not supported."
                    # (reproduced against the live API; a LEADING model turn,
                    # which the 24-turn window slice can produce, is accepted —
                    # only a trailing one is fatal.) This regenerate is a second
                    # attempt at the SAME user turn, so the discarded reply has
                    # to come off the end before we re-ask.
                    retry = await self.llm.generate(
                        self.system_prompt + self._known_facts_block() +
                        "\n\nYou JUST said: \"" + prev + "\"\n"
                        "Do not say that again, and do not ask for the same thing "
                        "again. Respond to what the caller actually just said, in "
                        "one short sentence.",
                        self.history[:-1])
                    if retry and retry.strip():
                        response = retry
                        log.info(f"LLM (retry): {response}")
                        # Overwrite the discarded reply that was recorded above.
                        # Leaving it desyncs context from what the caller actually
                        # heard, and the next anti-loop check would then compare
                        # against a sentence that was never spoken — which is the
                        # loop this whole block exists to break.
                        self.history[-1]["content"] = response
                        self.transcript[-1]["content"] = response
                        self._harvest_slots(response)
                    else:
                        log.warning("anti-loop: regenerate returned nothing — "
                                    "keeping the original reply")

            if want_text:
                return response
            audio = await self.tts.synthesize(response, self.voice)
            return audio

        except Exception as e:
            log.exception(f"on_speech error: {e}")   # stack, not just the message
            msg = "క్షమించండి, ఒక్కసారి మళ్ళీ చెప్తారా?"
            return msg if want_text else await self.tts.synthesize(msg, self.voice)

    async def save_recording(self, raw_audio_bytes: bytes) -> Optional[str]:
        """Encrypt call recording with AES-256-GCM and upload to Supabase storage.

        Layout of stored object (binary):
            [ 12-byte nonce ][ ciphertext + GCM tag ]

        Decryption key is per-tenant, sourced from env HEYNIKKI_RECORDING_KEY_<TENANT>
        or a single fallback HEYNIKKI_RECORDING_KEY. Key must be 32 bytes base64-encoded.

        Returns the Supabase storage path or None on failure (never blocks call cleanup).
        """
        if not raw_audio_bytes:
            return None
        if not _HAS_CRYPTO:
            log.error("cryptography library not installed; skipping recording encryption")
            return None

        tenant_id = self.profile.get("tenant_id", "unknown")
        key_b64 = (
            os.getenv(f"HEYNIKKI_RECORDING_KEY_{tenant_id}")
            or os.getenv("HEYNIKKI_RECORDING_KEY")
        )
        if not key_b64:
            log.error("HEYNIKKI_RECORDING_KEY env not set; skipping recording")
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
        # Sarvam returns TELUGU SCRIPT, so Latin keywords never matched what a
        # caller actually says. On a live call he said "హ్యూమన్" three times and
        # then "ట్రాన్స్ఫర్ చేస్తా అన్నారు"; none of them fired, and he was
        # instead quoted the price of the Human CRM Seat. Transliterations are
        # what land here, not English words.
        transfer_words = [
            "human", "person", "manager", "staff", "real", "transfer",
            "హ్యూమన్", "హ్యుమన్", "ట్రాన్స్ఫర్", "ట్రాన్స్‌ఫర్", "స్టాఫ్",
            "మేనేజర్", "వేరే", "నిజంగా", "మనిషి", "మనిషితో", "మాట్లాడాలి",
        ]
        appt_words     = ["appointment","appt","book","schedule","date","time","booking","అపాయింట్మెంట్","బుక్"]
        callback_words = ["call back","callback","later","తర్వాత","మళ్ళీ"]
        emergency_words= ["emergency","urgent","108","ambulance","accident"]

        if any(w in text_lower for w in emergency_words): return "emergency"
        if any(w in text_lower for w in transfer_words):  return "transfer"
        if any(w in text_lower for w in appt_words):      return "appointment"
        if any(w in text_lower for w in callback_words):  return "callback"
        return "enquiry"

    async def _handle_transfer(self):
        """Ask for a real transfer, or say plainly that there is nobody to ring.

        This previously synthesised "connecting you to staff" and returned —
        the comment said the transfer was "handled by LiveKit dispatch rules",
        which stopped being true when the stack moved to FreeSWITCH. It
        promised a human and delivered nothing, which is worse than declining.

        Sets transfer_requested so the websocket handler performs the actual
        uuid_transfer via the API server and closes the leg.
        """
        if not self.ring_group:
            # Never claim a transfer we cannot make.
            return ("క్షమించండి, ఇప్పుడు staff అందుబాటులో లేరు. "
                    "మీ number చెప్తే మా team మీకు callback చేస్తుంది.")
        self.transfer_requested = True
        return "అలాగే, ఒక్క నిమిషం — మా staff కి connect చేస్తున్నాను."

    async def _handle_appointment_booking(self, user_text: str, response: str):
        """Extract appointment details and save + send WhatsApp."""
        try:
            # Written bare on purpose: the caller is mid-sentence and an LLM
            # extraction here would sit on the critical path. The date, time,
            # service and name are filled in at call end by
            # _enrich_appointment, which has the whole transcript and costs
            # the caller nothing.
            appt_id = await self.db.save_appointment({
                "tenant_id":        self.profile["tenant_id"],
                "voice_profile_id": self.profile["id"],
                "call_id":          self.call_id,
                "caller_number":    self.caller_num,
                "caller_name":      self.slots.get("name"),
                "status":           "confirmed",
            })
            self.appointment_id = appt_id

            # Send WhatsApp confirmation.
            #
            # Two things were wrong here and both failed silently.
            #
            # It was gated on the TENANT having a whatsapp_number. That number
            # is a 360dialog "send as" address; on Meta Cloud API the sender is
            # our own platform number, so the gate blocked confirmations for
            # every tenant that had not filled in a field Meta never reads —
            # which is currently all of them.
            #
            # And it called send_whatsapp() above, which posts to WATI_API_URL.
            # That variable is empty, so the function logged "WhatsApp not
            # configured" and returned False. Nothing was ever sent, and the
            # caller was told on the phone that a confirmation was coming.
            #
            # The API server owns messaging: it holds the Meta credentials,
            # picks the approved template (free text is refused outside the
            # 24-hour window, and a phone call never opens one) and writes
            # wa_dispatch_log itself — so this no longer logs it twice.
            sent = False
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    r = await client.post(
                        f"{API_SERVER_URL}/api/whatsapp/appointment-confirm",
                        headers={"X-Internal-Secret": INTERNAL_SECRET},
                        json={
                            "caller_number":    self.caller_num,
                            "business_name":    self.profile.get("business_name") or "",
                            "slot_date":        self.slots.get("date"),
                            "slot_time":        self.slots.get("time"),
                            "service":          self.slots.get("service"),
                            "tenant_id":        self.profile["tenant_id"],
                            "voice_profile_id": self.profile["id"],
                            "call_id":          self.call_id,
                            "appointment_id":   appt_id,
                        },
                    )
                    sent = r.status_code == 200 and bool(r.json().get("ok"))
                    if not sent:
                        log.error(f"[WA] confirmation refused: HTTP {r.status_code} {r.text[:160]}")
            except Exception as e:
                log.error(f"[WA] confirmation send failed: {e}")

            if appt_id:
                await self.db.update_call(self.call_id, {
                    "appointment_created": True,
                    "wa_sent": sent,
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
    # Per-stage latency percentiles over the last 500 turns. The industry
    # gap between claimed and production latency is 2-4x; this is the number
    # that says which it is today. Targets: <800ms p50, <1400ms p95 total.
    def _pct(vals, q):
        return sorted(vals)[int(len(vals) * q)] if vals else None
    stt = [t[0] for t in _TURN_STATS]
    llm = [t[1] for t in _TURN_STATS]
    return {
        "status": "ok",
        "service": "nikki-voice-pipeline",
        "timestamp": datetime.now().isoformat(),
        "circuit_breakers": _cb.all_status(),
        "turn_latency_ms": {
            "turns": len(_TURN_STATS),
            "stt": {"p50": _pct(stt, 0.5), "p95": _pct(stt, 0.95)},
            "llm": {"p50": _pct(llm, 0.5), "p95": _pct(llm, 0.95)},
        },
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

# ── ONBOARDING INTERVIEW ────────────────────────────────────────────
# Read aloud, so it is written to be spoken: short questions, one at a time,
# and no lists. A form asks eleven things at once; a phone call cannot, and
# pretending otherwise is how these calls end with the owner confused about
# which question they are answering.
#
# She asks only what /setup actually stores. Anything else is a question the
# customer answers for nothing.
ONBOARDING_PROMPT = """You are Nikki from HeyNikki, calling {business} — a business
that has just signed up. You are NOT answering their phone. You are asking THEM
about their business so their AI receptionist can be set up for them.

Speak Telugu by default, switching to whatever language they use.

Ask these, ONE AT A TIME, and wait for each answer:
1. What does the business do, in their own words?
2. Which services do customers ask for most? (get 3 to 5)
3. What time do they open and close?
4. Which days are they open? Any weekly off?
5. Do customers book appointments? What kinds?
6. What should Nikki say if she cannot answer something?

Rules:
- One question per turn. Never read a list.
- If an answer is vague, ask once more plainly, then move on. Do not interrogate.
- Do not invent anything. If they skip a question, leave it unanswered.
- Keep every reply under 25 words.
- When you have what you need, thank them, tell them their setup is ready to
  review in the dashboard, and stop.

This call costs them nothing and does not use their free minutes."""


ONBOARDING_EXTRACT = """From this onboarding call transcript, extract what the OWNER
stated about their business. Never infer, never fill gaps.

Return strict JSON:
{{"business_name": string|null, "services": string[], "appointment_types": string[],
  "open_time": "HH:MM"|null, "close_time": "HH:MM"|null, "open_days": string[],
  "fallback_message": string|null, "facts": string[]}}

open_days uses Mon Tue Wed Thu Fri Sat Sun.
If the owner did not answer something, leave it null or empty — a wrong opening
time reaches real callers.

TRANSCRIPT:
{transcript}"""


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
    # Load the live price list before building the prompt.
    #
    # This was called only from the FreeSWITCH path, so the landing-page
    # assistant ran with an EMPTY [CURRENT PRICING] block and answered
    # "what does it cost" by inventing figures — it quoted Starter Rs 999,
    # Growth Rs 2,999 and a "Pro" plan that does not exist, against a real
    # catalogue of Rs 1,999 / Rs 4,999 / Rs 9,999 Starter/Growth/Scale.
    # Prospects were being quoted prices we do not sell, on the page that
    # is meant to sell them. Cached for 10 minutes, so this is a no-op on
    # all but the first turn.
    await _refresh_pricing()

    # Pick voice profile: real tenant profile or fallback demo
    # Product is the DEFAULT now, and the pretend clinic has to be asked for
    # by name. It was the other way round, so any caller that forgot to send a
    # persona — which included the call console on our own landing page — got
    # a receptionist offering "Doctor Consultation" and "Dental Check-up" to a
    # visitor who came to find out what HeyNikki is.
    #
    # The safer default is the one that is true: this is Hey Nikki's own site,
    # and the voice on it should talk about Hey Nikki.
    profile = _DEMO_PROFILE if (req.persona or "") == "clinic_demo" else _PRODUCT_PROFILE
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
            # 22050, not the telephony default: this plays through a laptop or a
            # handset speaker, not down a narrowband trunk. At 8k it is thin and
            # metallic — it reads as eerie rather than as a person.
            audio_bytes = await tts.synthesize(response_text, agent.voice, 22050)
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


class RecordingPresignRequest(BaseModel):
    object_key: str
    expires_in: int = 900          # 15 minutes


@app.post("/api/v1/recording/presign")
async def presign_recording(req: RecordingPresignRequest,
                            x_internal_secret: str = Header(None)):
    """Short-lived download URL for a call recording.

    Lives here rather than in api-server because boto3 is already installed
    and proven on this side; api-server has no S3 client, and adding one to
    presign a URL would be a dependency bought for six lines of signing.

    api-server owns the AUTHORISATION — it checks the caller's JWT and that
    the call belongs to their tenant — and calls this with the internal
    secret. Nothing here is reachable from a browser.

    The URL expires. That is the point: a recording of someone's phone call
    should not sit behind a link that works forever, which is what a public
    bucket gives you.
    """
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")

    cf_account_id = os.environ.get("CF_ACCOUNT_ID", "")
    r2_access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    r2_secret     = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    r2_bucket     = os.environ.get("R2_BUCKET", "heynikki-recordings")
    if not all([cf_account_id, r2_access_key, r2_secret]):
        raise HTTPException(status_code=503, detail="R2 not configured")

    # Clamp: a caller asking for a 30-day link defeats the expiry.
    expires = max(60, min(int(req.expires_in or 900), 3600))

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
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": r2_bucket, "Key": req.object_key},
            ExpiresIn=expires,
        )
        return {"url": url, "expires_in": expires}
    except Exception as e:  # noqa: BLE001
        log.error(f"[recording] presign failed for {req.object_key}: {e}")
        raise HTTPException(status_code=500, detail="Could not sign recording URL")


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


def _greeting_text(profile: dict, history: dict | None = None) -> str:
    """Warm brand greeting, spoken right after the TRAI disclosure.

    Previously the caller heard the disclosure and then silence — she waited
    for them to speak first, which on a phone call reads as a dead line.
    """
    # The business's own words win outright. This is spoken verbatim — not
    # offered to the model, which paraphrased it: a script of "నమస్కారం, శ్రీ
    # రామ్య డెంటల్ క్లినిక్..." came back as "హలో, ..." with a question bolted on.
    # An owner who writes their opening line means that line.
    #
    # A returning caller still gets recognised, but AFTER the scripted
    # opening rather than instead of it, so the business keeps its words and
    # the caller keeps being remembered.
    script = (profile.get("greeting_script") or "").strip()
    if script:
        if (history or {}).get("previous_calls"):
            return f"{script} మళ్ళీ కాల్ చేసినందుకు థాంక్యూ అండి!"
        return script

    biz  = (profile.get("business_name") or "").strip()
    name = _assistant_name(profile)
    # "కి స్వాగతం" is how a website banner talks, not a phone line — the
    # register research puts స్వాగతం on the banned written-register list, and
    # documents the real Hyderabad opening as "హలో, [business] అండి. చెప్పండి".
    # And a bare "ఏం కావాలి?" without అండి is its documented disrespect
    # failure. The first three seconds are the whole first impression.
    #
    # No "నమస్కారం" — the TRAI disclosure just said it; twice reads scripted.
    if (history or {}).get("previous_calls"):
        # Recognition, not a script. A caller who rang before should not be
        # greeted as a stranger — that is the single most machine-like thing
        # a receptionist can do.
        return f"హలో, {biz} అండి — మళ్ళీ కాల్ చేసినందుకు థాంక్యూ! చెప్పండి."
    return f"హలో, {biz} అండి. నేను {name}. చెప్పండి!"


async def _greeting_audio(agent) -> bytes:
    """Greeting audio, cached per profile on first use.

    Cached to the shared spool so every later call on that profile plays it
    instantly instead of paying a TTS round-trip at answer time — the same
    reason the TRAI disclosure is pre-generated. Works for any tenant with
    no per-tenant asset to build.
    """
    pid = str((agent.profile or {}).get("id") or "default")
    # Separate cache entry per variant, or a returning caller would be served
    # the stranger greeting from cache and the recognition would never be heard.
    variant = "back" if (agent.caller_history or {}).get("previous_calls") else "new"
    # The greeting text is part of the key. Without it, an owner editing their
    # greeting_script on /setup would change nothing a caller ever hears — the
    # first call cached a wav under this name and every later call reads it
    # back. Silent, permanent, and exactly the kind of thing discovered weeks
    # later by someone wondering why their new opening never plays.
    text = _greeting_text(agent.profile, agent.caller_history)
    stamp = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    path = pathlib.Path(_TTS_SPOOL) / f"greet_{pid}_{variant}_{stamp}.wav"
    try:
        if path.exists() and path.stat().st_size > 1000:
            return path.read_bytes()
        audio = await agent.tts.synthesize(text, agent.voice)
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


# ── TTS TEXT NORMALISATION ──────────────────────────────────────────
# Everything spoken on the phone passes through here first. Raw LLM output
# contains digits, times and markdown, and bulbul reads them literally:
# "10:30" comes out as "పది ముప్పై", a phone number as one giant number, and
# an asterisk as a word. Real Telugu speech says పదిన్నర, reads phone numbers
# digit-by-digit in two groups of five, and says రెండొందలు for 200.
#
# This is a normalisation layer, not a filter — it rewrites into the spoken
# form the register research documents, and it runs on the PHONE path (the
# browser shows text, where digits are correct).

_TE_DIGIT = {"0": "సున్నా", "1": "ఒకటి", "2": "రెండు", "3": "మూడు", "4": "నాలుగు",
             "5": "ఐదు", "6": "ఆరు", "7": "ఏడు", "8": "ఎనిమిది", "9": "తొమ్మిది"}
_TE_HOUR  = {1: "ఒంటి", 2: "రెండు", 3: "మూడు", 4: "నాలుగు", 5: "ఐదు", 6: "ఆరు",
             7: "ఏడు", 8: "ఎనిమిది", 9: "తొమ్మిది", 10: "పది", 11: "పదకొండు", 12: "పన్నెండు"}
_TE_HALF  = {1: "ఒకటిన్నర", 2: "రెండున్నర", 3: "మూడున్నర", 4: "నాలుగున్నర", 5: "ఐదున్నర",
             6: "ఆరున్నర", 7: "ఏడున్నర", 8: "ఎనిమిదిన్నర", 9: "తొమ్మిదిన్నర",
             10: "పదిన్నర", 11: "పదకొండున్నర", 12: "పన్నెండున్నర"}

def _spoken_phone(m: "re.Match") -> str:
    digits = re.sub(r"\D", "", m.group(0))
    # Digit-by-digit, 5-5 grouped with a pause comma, డబల్ for immediate
    # repeats — exactly how a Hyderabad receptionist reads a mobile number.
    out, i = [], 0
    while i < len(digits):
        if i + 1 < len(digits) and digits[i] == digits[i + 1]:
            out.append("డబల్ " + _TE_DIGIT[digits[i]]); i += 2
        else:
            out.append(_TE_DIGIT[digits[i]]); i += 1
        if sum(2 if w.startswith("డబల్") else 1 for w in out) == 5:
            out.append(",")
    return " ".join(out).replace(" ,", ",")

def _spoken_time(m: "re.Match") -> str:
    h, mi = int(m.group(1)), int(m.group(2))
    h12 = h % 12 or 12
    part = "పొద్దున" if 5 <= h < 12 else "మధ్యాహ్నం" if 12 <= h < 16 \
        else "సాయంత్రం" if 16 <= h < 20 else "రాత్రి"
    # If the sentence already carries a day part just before the time
    # ("సాయంత్రం 6:00"), adding ours would CONTRADICT it — a bare "6:00" has
    # no am/pm, so 6 reads as పొద్దున while the sentence says సాయంత్రం. The
    # words already there outrank a guess derived from a 24h reading.
    before = m.string[max(0, m.start() - 16):m.start()]
    if any(w in before for w in ("పొద్దున", "మధ్యాహ్నం", "సాయంత్రం", "రాత్రి", "ఉదయం")):
        part = ""
    # No trailing case marker: the sentence usually carries its own ("10:30
    # కి" would otherwise become "పదిన్నరకి కి"). A cleanup pass below
    # collapses any doubled marker that still slips through.
    _MIN = {15: "పదిహేను", 20: "ఇరవై", 40: "నలభై", 45: "నలభై ఐదు", 10: "పది", 5: "ఐదు"}
    if mi == 0:  out = f"{part} {_TE_HOUR[h12]} గంటల"
    elif mi == 30: out = f"{part} {_TE_HALF[h12]}"
    elif mi in _MIN:
        # "తొమ్మిది పదిహేను" — how urban speech actually reads 9:15; the
        # classical తొమ్మిదింబావు forms are irregular enough that generating
        # them wrong would sound worse than the plain modern reading.
        out = f"{part} {_TE_HOUR[h12]} {_MIN[mi]}"
    else: out = f"{part} {_TE_HOUR[h12]} {' '.join(_TE_DIGIT[d] for d in str(mi))} నిమిషాల"
    return out.strip()

def _spoken_rupees(m: "re.Match") -> str:
    n = int(m.group(1).replace(",", ""))
    special = {100: "వంద", 200: "రెండొందలు", 300: "మూడొందలు", 400: "నాలుగొందలు",
               500: "ఐదొందలు", 1000: "వెయ్యి", 2000: "రెండు వేలు", 5000: "ఐదు వేలు"}
    if n in special: return special[n] + " రూపాయలు"
    if n % 1000 == 0 and n < 100000:
        return f"{_TE_HOUR.get(n // 1000, str(n // 1000))} వేల రూపాయలు"
    if n % 500 == 0 and 1000 < n < 10000:
        # 4500 -> నాలుగున్నర వేలు: the half-thousand form real speech uses.
        return f"{_TE_HALF[n // 1000]} వేల రూపాయలు"
    return f"{n} రూపాయలు"   # bulbul handles plain smaller numbers acceptably

def normalize_for_tts(text: str) -> str:
    t = _clean_for_speech(text)                       # markdown, emoji, vendor names
    t = re.sub(r"\b[6-9]\d{9}\b", _spoken_phone, t)   # mobile numbers first (longest)
    t = re.sub(r"\b(\d{1,2}):(\d{2})\s*(?:AM|PM|am|pm)?\b", _spoken_time, t)
    t = re.sub(r"(?:Rs\.?|₹)\s*([\d,]+)", _spoken_rupees, t)
    # Commas into any surviving long number so bulbul does not choke
    # (its docs: >4 digits without separators may fail).
    t = re.sub(r"\b(\d)(\d{3})(\d{3,})\b", r"\1,\2,\3", t)
    # Collapse a case marker doubled by substitution ("పదిన్నర కి కి").
    t = re.sub(r"(కి|కు|లో)\s+\1\b", r"\1", t)
    return t


async def _speak_chunked(agent, ws, fs_uuid: str, text: str,
                         seq: int, speaking: dict) -> None:
    """Synthesise chunk N+1 while chunk N is still playing.

    uuid_broadcast INTERRUPTS whatever is playing rather than queueing, so
    each chunk is held until the previous one has actually finished — the
    same reason the greeting had to wait for the disclosure.
    """
    if isinstance(text, (bytes, bytearray)):
        # Should be unreachable now, but a wrong type here used to cost the
        # caller a whole turn of silence. Fail loudly instead of crashing.
        log.error("_speak_chunked got bytes, expected text — dropping turn")
        return
    chunks = _speech_chunks(normalize_for_tts(text))
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
        # dur + 0.05, not dur - 0.15: uuid_broadcast INTERRUPTS, so sending
        # 150ms early cut the tail off every chunk — and phrase-final
        # lengthening is the exact prosodic cue listeners use to parse turn
        # structure. Clipping it on every seam was a per-reply robot tell.
        # The next synthesis already ran concurrently; 150ms buys nothing.
        await asyncio.sleep(dur + 0.05)
        audio = await nxt_task


async def _spool_janitor() -> None:
    """Keep the shared spool from growing without bound.

    /tmp is a 5.6GB TMPFS on this host, so anything left here consumes RAM,
    not disk — a previous incident filled the disk with recordings and took
    FreeSWITCH, the pipeline and the API server down together. Per-clip
    cleanup already runs 60s after each broadcast, but that is a timer inside
    a task: if a turn is cancelled (barge-in cancels turns routinely) the
    timer can go with it. This is the backstop that does not depend on any
    call completing normally.

    Deliberately does NOT touch fillers/ or the TTS cache, which are meant to
    persist and are separately bounded.
    """
    spool = pathlib.Path(_TTS_SPOOL)
    while True:
        try:
            await asyncio.sleep(600)
            cutoff = time.time() - 900          # 15 minutes
            removed = 0
            for f in spool.glob("tts_*.wav"):
                try:
                    if f.stat().st_mtime < cutoff:
                        f.unlink(); removed += 1
                except OSError:
                    pass
            for f in spool.glob("greet_*.wav.part"):
                try: f.unlink()
                except OSError: pass
            if removed:
                log.info(f"spool janitor: removed {removed} stale clip(s)")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a janitor must never kill the app
            log.warning(f"spool janitor: {e}")



async def _enrich_appointment(agent, fs_uuid: str) -> None:
    """Fill in an appointment's date, time and service after the call.

    _handle_appointment_booking writes the row bare — the caller is
    mid-sentence and an LLM call there would sit on the critical path. So
    every appointment ever booked on the phone path holds a tenant, a number
    and status 'confirmed', and nothing else: no date, no time, no service,
    no name. All six in the database look like that.

    That is not merely untidy. The 24h reminder job selects on
    slot_date = tomorrow, so with slot_date null it can never match and no
    reminder could ever be sent, however reliably the scheduler runs. The
    confirmation WhatsApp likewise tells someone their appointment is
    confirmed without saying when.

    Runs at cleanup alongside lead scoring, where the whole transcript is
    available and the caller has already hung up.
    """
    appt_id = getattr(agent, "appointment_id", None)
    if not appt_id or not GEMINI_KEY:
        return
    turns = [t for t in (agent.transcript or []) if t.get("content")]
    if len(turns) < 3:
        return

    dialogue = "\n".join(
        f"{'AGENT' if t.get('role') == 'assistant' else 'CALLER'}: {str(t['content'])[:300]}"
        for t in turns)[:8000]
    # Relative dates are the norm on a call — "రేపు", "next Monday" — and
    # resolving them needs the day the call happened, in IST.
    today = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")

    prompt = (
        "Extract the appointment from this phone call. Return ONLY minified JSON:\n"
        '{"slot_date":"YYYY-MM-DD or null","slot_time":"HH:MM 24h or null",'
        '"service":"string or null","caller_name":"string or null"}\n\n'
        f"Today is {today} (IST). Resolve relative dates against it — రేపు and "
        "tomorrow mean the next day.\n"
        "Use null for anything not actually agreed. A caller who asked about "
        "timings without settling on one has NO slot_date — inventing a time "
        "puts a real person in a diary for an appointment they never made, "
        "which is worse than an empty field.\n\n"
        f"TRANSCRIPT:\n{dialogue}"
    )
    try:
        model = os.getenv("GEMINI_MODEL") or "gemini-flash-lite-latest"
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_KEY}",
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}],
                      "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}})
        if r.status_code != 200:
            log.warning(f"[FS] {fs_uuid}: appointment extract gemini {r.status_code}")
            return
        raw = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return
        d = json.loads(m.group(0))

        patch = {}
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d.get("slot_date") or "")):
            patch["slot_date"] = d["slot_date"]
        if re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(d.get("slot_time") or "")):
            patch["slot_time"] = d["slot_time"]
        if d.get("service"):
            patch["service"] = str(d["service"])[:120]
        name = d.get("caller_name") or agent.slots.get("name")
        if name:
            patch["caller_name"] = str(name)[:120]
        if not patch:
            return

        async with httpx.AsyncClient(timeout=8.0) as c:
            await c.patch(f"{agent.db.url}/rest/v1/appointments",
                          headers=agent.db.headers,
                          params={"id": f"eq.{appt_id}"},
                          json=patch)
        log.info(f"[FS] {fs_uuid}: appointment enriched {patch}")
    except Exception as e:  # noqa: BLE001 - never break cleanup
        log.warning(f"[FS] {fs_uuid}: appointment enrich failed: {e}")


async def _score_and_log_lead(agent, fs_uuid: str, caller_number: str,
                              did_number: str, duration: int) -> None:
    """Rate the conversation and write a lead. Runs AFTER hangup.

    Deliberately off the critical path: the caller is already gone, so an
    extra second of LLM time costs nothing, and a failure here must never
    affect a call. Until now an AI call detected an intent keyword and threw
    it away — the human CRM path mapped dispositions to lead stages, but a
    call Nikki handled produced no lead at all.

    The model returns STRUCTURED JSON, not prose. Scores are clamped and the
    stage is validated against the enum, because a hallucinated stage would
    violate the check constraint and lose the whole lead.
    """
    try:
        turns = [t for t in (agent.transcript or []) if t.get("content")]
        if len(turns) < 2 or duration < 5:
            return                      # a hangup with no conversation is not a lead

        convo = "\n".join(
            f"{'Caller' if t['role'] == 'user' else 'Nikki'}: {t['content']}"
            for t in turns[-24:]
        )
        prompt = (
            "Rate this phone conversation for a business. Reply with ONLY a JSON "
            "object, no markdown fence:\n"
            '{"score":0-100,"stage":"new|contacted|qualified|won|lost",'
            '"intent":"short_snake_case","interest":"what they asked about",'
            '"summary":"one sentence in English"}\n'
            "score: how likely this caller is to become a customer. A booking "
            "or a clear commitment is 80+. A price enquiry is 50-70. A wrong "
            "number, abuse or an immediate hangup is under 20.\n\n"
            f"{convo}"
        )
        raw = await agent.llm.generate("You classify sales calls. Output JSON only.",
                                       [{"role": "user", "content": prompt}])
        txt = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.M).strip()
        m = re.search(r"\{.*\}", txt, re.S)
        if not m:
            log.warning(f"[FS] {fs_uuid}: lead scoring returned no JSON")
            return
        d = json.loads(m.group(0))

        score = max(0, min(100, int(d.get("score") or 0)))
        _VALID_STAGES = ("new", "contacted", "qualified", "won", "lost")
        stage = d.get("stage") if d.get("stage") in _VALID_STAGES else "contacted"

        digits = "".join(c for c in (caller_number or "") if c.isdigit())[-10:]
        prof   = agent.profile or {}
        row = {
            "tenant_id": prof.get("tenant_id"),
            "phone":     digits,
            "name":      (agent.slots or {}).get("name"),
            "intent":    str(d.get("intent") or "")[:64] or None,
            "interest":  str(d.get("interest") or "")[:200] or None,
            "notes":     str(d.get("summary") or "")[:500] or None,
            "stage":     stage,
            "score":     score,
            "source":    "inbound_call",
            "first_call_id": agent.call_id,
        }
        async with httpx.AsyncClient(timeout=6.0) as c:
            r = await c.post(f"{agent.db.url}/rest/v1/leads",
                             headers={**agent.db.headers, "Prefer": "return=minimal"},
                             json=row)
            # leads carries a unique (tenant_id, phone). A returning caller
            # therefore 409s here, and everything this call learned — updated
            # intent, a business name they only gave the second time, a better
            # score — used to be dropped on the floor with a warning. Update
            # the existing lead instead.
            if r.status_code == 409:
                # first_call_id is deliberately excluded: it records the FIRST
                # call and must not drift forward. Nones are dropped too, so a
                # call that failed to capture a name does not blank the name
                # captured last time.
                patch = {k: v for k, v in row.items()
                         if k not in ("tenant_id", "phone", "first_call_id")
                         and v is not None}
                if patch:
                    r = await c.patch(
                        f"{agent.db.url}/rest/v1/leads"
                        f"?tenant_id=eq.{row['tenant_id']}&phone=eq.{digits}",
                        headers={**agent.db.headers, "Prefer": "return=minimal"},
                        json=patch)
                    updated = True
                else:
                    updated = True
            else:
                updated = False
        if r.status_code >= 300:
            log.warning(f"[FS] {fs_uuid}: lead {'update' if updated else 'insert'} "
                        f"{r.status_code} {r.text[:120]}")
        else:
            log.info(f"[FS] {fs_uuid}: lead {'updated' if updated else 'scored'} "
                     f"{score}/100 stage={stage} intent={row['intent']}")

        # Brochure on WhatsApp, but only for a lead that actually qualified.
        #
        # Until now NOTHING fired interested-lead from a phone call: the only
        # caller was the click-to-call disposition endpoint, which an agent
        # triggers by hand. So a caller could hold a full conversation, ask
        # for details and be scored 75/100, and never receive anything.
        #
        # Gated on stage rather than sent to everyone who picks up, because
        # interested_lead_brochure is a MARKETING template at Meta: sending it
        # to uninterested people earns blocks, and enough blocks drop the
        # number's quality rating to Low, which throttles every template
        # including the transactional ones.
        if stage in ("qualified", "won"):
            cfg = await _read_platform_config()
            await _fire_automation_webhook("interested-lead", {
                "caller_number":   digits,
                "tenant_id":       prof.get("tenant_id"),
                "call_id":         agent.call_id,
                "business_name":   prof.get("business_name", "our team"),
                "whatsapp_number": prof.get("whatsapp_number") or digits,
            }, cfg)
            log.info(f"[FS] {fs_uuid}: brochure fired — stage={stage} score={score}")
    except Exception as e:  # noqa: BLE001 - scoring must never break cleanup
        log.warning(f"[FS] {fs_uuid}: lead scoring failed: {e}")


async def _run_turn(agent, ws, fs_uuid: str, utterance_pcm: bytes,
                    seq: int, speaking: dict) -> None:
    """One STT -> LLM -> TTS -> playback turn, as a cancellable task.

    Runs detached so the receive loop keeps reading frames while Nikki is
    talking. That is what makes barge-in possible at all — and it means a
    cancel here must leave the call healthy, so CancelledError is allowed
    to propagate untouched and everything else is swallowed.
    """
    try:
        # The filler waits 1.1s and is cancelled the moment the reply text is
        # ready. Two research findings drove this: fillers on EVERY turn make
        # task agents rate less intelligent (they signal low
        # feeling-of-knowing right before the fact they precede), and a
        # cached-TTS answer used to collide with the filler mid-word — an
        # audible glitch, since uuid_broadcast interrupts. A filler is cover
        # for a genuinely slow turn, not furniture.
        filler_task = asyncio.create_task(_play_filler(fs_uuid, delay=1.1))
        wav_bytes = _pcm16_to_wav_bytes(utterance_pcm)
        reply_text = await agent.on_speech(wav_bytes, want_text=True)
        # Reply ready: if the filler has not fired yet, it never should.
        if not filler_task.done():
            filler_task.cancel()
        if not reply_text:
            return
        # The log showed STT and an LLM reply landing AFTER "Call ended" —
        # work billed against a channel nobody is on any more.
        if getattr(ws, "client_state", None) is not None and \
           str(getattr(ws, "client_state", "")).endswith("DISCONNECTED"):
            log.info(f"[FS] {fs_uuid}: call already ended — dropping reply")
            return
        # speaking["until"] is published inside, before each chunk is sent, so
        # a caller who interrupts immediately still trips the barge-in check.
        await _speak_chunked(agent, ws, fs_uuid, reply_text, seq, speaking)

        if getattr(agent, "transfer_requested", False):
            agent.transfer_requested = False
            log.info(f"[FS] {fs_uuid}: caller asked for a human — transferring")
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
                    await client.post(
                        f"{API_SERVER_URL}/webhooks/freeswitch/transfer-to-human",
                        headers={"X-Internal-Secret": INTERNAL_SECRET},
                        json={"fs_uuid": fs_uuid,
                              "ring_group": agent.ring_group,
                              "guard_seconds": agent.guard_seconds},
                    )
                await ws.close(code=1000)
            except Exception as e:  # noqa: BLE001
                # She has already said she is connecting them, so failing
                # silently here would strand the caller mid-promise.
                log.error(f"[FS] {fs_uuid}: transfer failed: {e}")
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


async def _play_filler(fs_uuid: str, delay: float = 0.0) -> None:
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
        if delay > 0:
            # Cancellable wait: a fast turn cancels this task before the
            # sleep expires and no filler plays at all.
            await asyncio.sleep(delay)
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


async def _save_onboarding_draft(tenant_id: str, agent, db) -> None:
    """Read back what the owner said and propose it as setup fields."""
    transcript = "\n".join(
        f"{'Owner' if t.get('role') == 'user' else 'Nikki'}: {t.get('content', '')}"
        for t in agent.history
    )[:12000]

    raw = await gemini_generate(
        "Return only JSON. Extract nothing that was not said.",
        [{"role": "user", "content": ONBOARDING_EXTRACT.format(transcript=transcript)}],
    )
    # gemini_generate returns prose; the model is asked for JSON but a stray
    # code fence would make json.loads fail and lose the whole interview.
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1].lstrip("json").strip()
    data = json.loads(text)

    # Same whitelist the brochure path uses. A phone call must not be able to
    # propose a field a document cannot.
    allowed = ["business_name", "services", "appointment_types",
               "open_time", "close_time", "open_days", "fallback_message"]
    proposed = {k: data[k] for k in allowed
                if data.get(k) not in (None, "", [], {})}

    async def _post(table: str, payload) -> None:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(f"{db.url}/rest/v1/{table}",
                                  headers=db.headers, json=payload)
            # Checked, not fired and forgotten. The brochure path lost seven
            # extracted facts this way — source_type failed a check constraint
            # and nobody read the response, so it reported success and wrote
            # nothing. An interview is far more expensive to repeat than a
            # re-upload: it means phoning the customer again.
            if r.status_code >= 300:
                raise RuntimeError(f"{table} insert {r.status_code}: {r.text[:200]}")

    facts = [f for f in (data.get("facts") or []) if f][:40]
    if facts:
        await _post("knowledge_base", [{
            "tenant_id": tenant_id,
            "voice_profile_id": agent.profile.get("id"),
            "content": str(f)[:1000],
            "source_type": "document",
            "source_name": f"onboarding_call:{agent.call_id or ''}",
        } for f in facts])

    if proposed:
        await _post("profile_drafts", [{"tenant_id": tenant_id, "proposed": proposed}])
        log.info(f"[onboarding] tenant {tenant_id}: proposed {list(proposed)}")
    else:
        log.info(f"[onboarding] tenant {tenant_id}: owner gave nothing usable")


async def _upload_to_r2(local_wav_bytes: bytes, call_id: str, tenant_id: str) -> str:
    """Upload call recording to Cloudflare R2. Returns public URL or ''."""
    # FreeSWITCH mod_audio_stream collects PCM — we receive it here in memory.
    cf_account_id = os.environ.get("CF_ACCOUNT_ID", "")
    r2_access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    r2_secret     = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    r2_bucket     = os.environ.get("R2_BUCKET", "heynikki-recordings")
    r2_public_url = os.environ.get("R2_PUBLIC_URL", "")

    # r2_public_url is NO LONGER required. The bucket stays private and the
    # dashboard fetches a short-lived presigned URL when someone presses play
    # (GET /api/calls/:id/recording). A public bucket would put every
    # customer's recorded phone call at an unauthenticated URL that never
    # expires, saved in the database and rendered into pages — for recordings
    # of real people's calls that is not a trade worth making for the
    # convenience of a static link.
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
        log.info(f"[FS] Recording uploaded to R2: {object_key} ({len(local_wav_bytes):,}B)")
        # Returns the OBJECT KEY, not a URL. Callers store it in
        # calls.r2_object_key and presign at play time. If a public base is
        # configured anyway, it is still honoured for whoever wants it.
        return f"{r2_public_url.rstrip('/')}/{object_key}" if r2_public_url else object_key
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
    direction:     str = "inbound",
    campaign_id:   str = "",
    onboarding:    str = "",
):
    """
    FreeSWITCH mod_audio_stream WebSocket handler.

    Audio flow:
      FS → binary PCM frames → VAD buffer → STT → Gemini → TTS → binary PCM → FS

    Recording flow:
      All inbound PCM accumulated in memory → WAV → Cloudflare R2 on hangup.
    """
    await ws.accept()
    # The dialplan has always appended ?direction=outbound&campaign_id=... on
    # the campaign path; this handler simply never declared the parameters, so
    # FastAPI dropped them and every campaign call recorded itself as inbound.
    is_outbound = (direction or "inbound").lower() == "outbound"
    campaign_id = (campaign_id or "").strip()
    # Set by the onb_ dialplan extension. When present this is Nikki ringing a
    # business that just signed up, to ask about their business — not Nikki
    # answering as that business.
    onboarding  = (onboarding or "").strip()
    log.info(f"[FS] Connected: did={did_number} caller={caller_number} "
             f"uuid={fs_uuid} direction={'outbound' if is_outbound else 'inbound'}"
             + (f" campaign={campaign_id}" if campaign_id else "")
             + (f" ONBOARDING tenant={onboarding}" if onboarding else ""))

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

    # ── Onboarding interview ────────────────────────────────────────────
    # Same agent, different job. She is not answering this business's phone;
    # she is asking its owner what the business does, so their setup writes
    # itself. Everything else on this path — barge-in, language detection,
    # recording, the hangup webhook — is inherited unchanged, which is the
    # whole reason this reuses the inbound handler.
    if onboarding:
        agent.onboarding_tenant = onboarding
        agent.system_prompt = ONBOARDING_PROMPT.format(
            business=profile.get("business_name") or "your business")

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
                    "direction":     "outbound" if is_outbound else "inbound",
                    "campaign_id":   campaign_id or None,
                },
            )
            if r.status_code == 200:
                routing = r.json()
    except Exception as e:
        log.warning(f"[FS] routing lookup failed ({e}) — defaulting to AI")

    # Give the agent what a mid-call transfer needs. Without this it could
    # only ever promise one: the working path below fires at call START for
    # routing_mode=human and was never reachable when a caller ASKED.
    agent.fs_uuid      = fs_uuid
    agent.ring_group   = routing.get("ring_group") or ""

    # ── Spoken menu ─────────────────────────────────────────────────────
    # routing_mode 'ivr' has been a permitted value since migration 015 and
    # nothing implemented it, so a tenant who chose it got the plain agent.
    #
    # Spoken, not keypad: mod_audio_stream carries audio, not DTMF, so digits
    # would need a second channel — and a voice product asking people to press
    # buttons is arguing against itself. The caller says what they want.
    # ── The business's own script ───────────────────────────────────────
    # greeting_script is spoken as written. It is not offered to the model as
    # a suggestion, because the first line of a call is the one a business is
    # judged on and it should not be reworded on every call.
    #
    # must_ask is a checklist, not a running order for the whole conversation:
    # she has to come away with these answers, and is told explicitly not to
    # interrogate for them. A caller who volunteers everything in one sentence
    # should not then be asked three questions they have already answered.
    _script = (profile.get("greeting_script") or "").strip()
    _must   = [q for q in (profile.get("must_ask") or []) if str(q).strip()]
    if _script or _must:
        block = "\n\n[THIS BUSINESS'S SCRIPT]\n"
        if _script:
            # Spoken as audio before the model is ever consulted, so this only
            # tells it what the caller already heard — repeating it would have
            # the caller greeted twice.
            block += (f'You have ALREADY said this out loud: "{_script}" '
                      f'Do not repeat it or greet them again.\n')
        if _must:
            block += ("Before the call ends you must have answers to:\n"
                      + "\n".join(f"  {i+1}. {q}" for i, q in enumerate(_must))
                      + "\nAsk for whatever is still missing, naturally, as the "
                        "conversation allows. Never ask for something they have "
                        "already told you, and never ask two of these in one breath.\n")
        agent.system_prompt += block
        log.info(f"[FS] script: greeting={'yes' if _script else 'no'} must_ask={len(_must)}")

    _ivr = routing.get("ivr") or None
    if _ivr and _ivr.get("options"):
        _opts = [o for o in _ivr["options"] if o.get("say")]
        _lines = "\n".join(
            f"- If they want {o.get('label') or o['say']} (they may say "
            f"\"{o['say']}\"): " +
            ("transfer them to a person." if o.get("action") == "transfer"
             else "handle it yourself as usual.")
            for o in _opts
        )
        agent.system_prompt += (
            "\n\n[CALL MENU]\n"
            f"Open with: {_ivr.get('greeting') or 'How can I help you today?'}\n"
            "Then listen. Do not read the options as a list unless they ask.\n"
            f"{_lines}\n"
            "If what they want is not on this list, help them normally. "
            "Never make someone repeat themselves twice — if the second answer "
            "is still unclear, just help them yourself."
        )
        log.info(f"[FS] IVR menu active: {len(_opts)} options")
    agent.guard_seconds = routing.get("missed_call_seconds", 20)

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
            "direction":        "outbound" if is_outbound else "inbound",
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
    barge_frames   = 0            # consecutive voiced frames while Nikki speaks
    vad_threshold  = float(_SILENCE_THRESHOLD)
    noise_win: "deque" = deque(maxlen=250)   # ~5s of frame RMS while she is silent
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

        # Load before greeting so a returning caller is recognised in the
        # very first sentence, which is where it actually lands.
        try:
            await _refresh_pricing()
            agent.caller_history = await db.get_caller_history(
                caller_number, (profile or {}).get("id", ""))
            if agent.caller_history.get("previous_calls"):
                log.info(f"[FS] {fs_uuid}: returning caller — "
                         f"{agent.caller_history['previous_calls']} previous call(s)")
        except Exception as e:  # noqa: BLE001
            log.debug(f"[FS] caller history skipped: {e}")

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

                # VAD: compute RMS energy of this frame.
                #
                # The threshold ADAPTS to this call's noise floor rather than
                # trusting a fixed 200. A clinic speakerphone near a road can
                # idle at RMS 300+ (fixed threshold = permanent speech, VAD
                # storm); a soft speaker on a quiet line can peak under 200
                # (fixed threshold = deaf). Production systems (Vapi) run a
                # dynamic baseline off a rolling percentile for exactly this.
                # The floor only updates while Nikki is NOT speaking, so her
                # own audio bleeding back never raises it.
                energy = _rms(frame)
                if time.monotonic() >= speaking["until"]:
                    noise_win.append(energy)
                    if len(noise_win) >= 50:            # ~1s of samples
                        floor = sorted(noise_win)[int(len(noise_win) * 0.85)]
                        vad_threshold = max(_SILENCE_THRESHOLD, floor * 1.5)
                is_speech = energy > vad_threshold

                if is_speech:
                    speech_buf.extend(frame)
                    speech_count  += 1
                    silence_count  = 0
                else:
                    silence_count += 1
                    if speech_count > 0:
                        speech_buf.extend(frame)  # include trailing silence

                # ── BARGE-IN, with a confirmation window ─────────────────
                # The caller started talking while Nikki is still speaking.
                # Cut her off, exactly as a person would be cut off.
                #
                # But NOT on a single 20ms frame. One frame above the RMS
                # threshold is a cough, a TV, a horn on speakerphone — and
                # PolyAI's production doctrine is that a false barge-in is
                # MORE damaging than a missed one: an agent that stops
                # mid-word for background noise reads as broken in a way a
                # briefly-talked-over agent does not. Vapi ships 200ms of
                # sustained voice as its default for exactly this reason.
                #
                # ~240ms of consecutive voiced frames (12 x 20ms) is required
                # before she yields. A caller genuinely interrupting sustains
                # voice for far longer; a cough does not. The frames are
                # already accumulating in speech_buf either way, so nothing
                # the caller says during the window is lost.
                if is_speech and time.monotonic() < speaking["until"]:
                    barge_frames += 1
                    if barge_frames >= max(3, round(0.24 / (frame_secs or 0.02))):
                        speaking["until"] = 0.0
                        barge_frames = 0
                        asyncio.create_task(_esl_api(f"uuid_break {fs_uuid} all"))
                        if turn_task and not turn_task.done():
                            turn_task.cancel()
                        log.info(f"[FS] {fs_uuid}: barge-in — caller interrupted (confirmed)")
                elif not is_speech:
                    barge_frames = 0

                # Fire STT when we hit silence after speech
                # Triple the wait while a number is being dictated (~1.2s
                # instead of ~400ms) — correct endpointing behaviour EXTENDS
                # under dictation rather than shaving the base window.
                _need = silence_needed * (3 if getattr(agent, "expect_dictation", False) else 1)
                if silence_count >= _need and speech_count >= speech_needed:
                    utterance_pcm = bytes(speech_buf)
                    speech_buf    = bytearray()
                    speech_count  = 0
                    silence_count = 0

                    # Drop an in-flight turn only if this is a REAL new
                    # utterance. On a live call the caller said "ఓకే", "ఉమ్",
                    # "Human" while Nikki was still working, and each one
                    # cancelled the answer in flight — so four of his turns got
                    # no reply at all, including two requests for a human.
                    # Backchannels are not new questions.
                    words = len(utterance_pcm) / (8000 * 2)
                    if turn_task and not turn_task.done():
                        if words >= 0.7:
                            turn_task.cancel()
                        else:
                            log.info(f"[FS] {fs_uuid}: short backchannel "
                                     f"({words:.1f}s) — letting the reply finish")
                            speech_buf = bytearray()
                            continue

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
            # With a private bucket _upload_to_r2 returns the object key, so
            # it goes in r2_object_key and the dashboard presigns it on play.
            # recording_url stays for a public base, which some deployments
            # still configure — the column that is set tells you which mode
            # produced the row.
            if r2_url.startswith("http"):
                updates["recording_url"] = r2_url
            else:
                updates["r2_object_key"]   = r2_url
                updates["storage_provider"] = "r2"
                updates["recording_size_bytes"] = len(wav_bytes)
        if agent.call_id:
            await db.update_call(agent.call_id, updates)
            if getattr(agent, "turn_timings", None):
                log.info(f"[FS] {fs_uuid}: stage ms per turn: {agent.turn_timings}")

        # ── Turn the interview into the same draft a brochure produces ──
        # Deliberately the SAME profile_drafts table and the same confirm
        # screen. An owner should not have to learn two different ways to
        # accept what Nikki worked out about their business, and a phone
        # answer is no more authoritative than a PDF — both are evidence, and
        # both get confirmed before anything reaches a live call.
        if onboarding and len(agent.history) >= 4:
            try:
                await _save_onboarding_draft(onboarding, agent, db)
            except Exception as e:
                log.error(f"[onboarding] draft failed: {e}")

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
            # The event name is the n8n webhook path, and the workflow has
            # always listened on "appointment-confirmed" — matching the
            # approved Meta template of the same name. Firing
            # "appointment-booked" hit a path no workflow served, so the
            # confirmation WhatsApp could never have gone out. business_name
            # is included because the template reads it into {{1}}.
            await _fire_automation_webhook("appointment-confirmed", {
                "caller_number": caller_number,
                "tenant_id":     profile["tenant_id"],
                "call_id":       agent.call_id,
                "business_name": profile.get("business_name", ""),
            }, cfg)

        log.info(f"[FS] {fs_uuid}: cleanup complete, r2={r2_url or 'skipped'}")

        # Rate the conversation and create the lead. After cleanup on purpose:
        # the recording upload matters more than the score, and this must not
        # delay it.
        await _score_and_log_lead(agent, fs_uuid, caller_number, did_number, duration)
        await _enrich_appointment(agent, fs_uuid)


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

