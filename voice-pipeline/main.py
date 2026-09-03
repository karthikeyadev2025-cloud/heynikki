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

from fastapi import (FastAPI, HTTPException, Header, Request, Response,
                     WebSocket as _WebSocket)
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


GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite"

# GEMINI_MODEL is an operator setting and any value not listed here is used
# as given. These specific ones are refused because each produces a
# CALLER-VISIBLE FAULT rather than a slower or costlier preference, and a
# deployment that sets one is not expressing a trade-off, it is broken:
#
#   - the "thinking" tiers bill reasoning tokens against maxOutputTokens, so
#     at our 300 the visible reply arrives cut off mid-word;
#   - the retired ids simply error, which costs the caller the whole turn.
#
# All measured against this account on 2026-09-01 (see GeminiLLM.base_url).
# Refusing loudly beats a production line quietly answering in half
# sentences because an env var outlived the model it named.
_GEMINI_REFUSED = {
    "gemini-flash-latest":      "thinks before answering — replies arrive truncated mid-word; 1.91s p50 TTFT vs 0.86s",
    "gemini-3.5-flash":         "same truncation; 2.43s p50 TTFT",
    "gemini-3.6-flash":         "same truncation; 2.01s p50 TTFT",
    "gemini-3.7-flash":         "leaked prompt text into a reply and returned nothing on another turn",
    "gemini-2.5-flash":         "retired — the API answers 'no longer supported'",
    "gemini-2.5-flash-lite":    "retired",
    "gemini-2.0-flash-exp":     "retired — 404",
    "gemini-1.5-flash":         "retired",
    "gemini-1.5-flash-latest":  "retired",
}


_gemini_warned_for: str = ""


def resolve_gemini_model() -> str:
    """The model to call, with a known-broken GEMINI_MODEL refused."""
    want = (os.getenv("GEMINI_MODEL") or "").strip()
    if not want:
        return GEMINI_DEFAULT_MODEL
    why = _GEMINI_REFUSED.get(want)
    if why:
        # Once per distinct value, not once per turn. This is called on every
        # LLM call, and a CRITICAL line per caller utterance would bury the
        # actual incidents this log level exists for — the misconfiguration
        # is one fact about the deployment, not news on every turn.
        global _gemini_warned_for
        if _gemini_warned_for != want:
            _gemini_warned_for = want
            log.critical(
                f"GEMINI_MODEL={want} REFUSED: {why}. "
                f"Falling back to {GEMINI_DEFAULT_MODEL}. "
                f"Unset or correct the environment variable to silence this."
            )
        return GEMINI_DEFAULT_MODEL
    return want

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
number and business is secondary — ask ONCE in the whole conversation, when
they show intent (demo, callback, signup), never twice, and never instead of
answering what they actually said.

MIRROR THEIR LANGUAGE. Reply in the language of their MOST RECENT message:
an English question gets an English answer, a Telugu question gets Telugu,
Hindi gets Hindi. Many evaluators are English-first — answering an English
"What is Hey Nikki?" in Telugu loses exactly the person the reply exists to
convince. (This outranks the Telugu-default rule below, which is written for
answering a business's own callers.)

WHAT IT DOES (state only these):
- Answers a business's existing number in real Telugu; switches to Hindi or
  English the moment the caller does.
- Books appointments, captures numbers, sends WhatsApp confirmation.
- Appointments to a dashboard; recordings and transcripts stored.
- Missed call with no answer triggers automatic follow-up.
- AI brain and human brain on ONE number, decided per call: routine bookings
  to the AI; a caller asking for a person goes to a telecaller who already
  has their history on screen.
- 24/7 including Sundays and festivals. She acknowledges in about half a
  second and answers fully in a couple more.
- Keep your existing number — forward or port it. Live the same day.
  (NOT "in 60 seconds" — a number is assigned after verification, and the
  landing page stopped promising instant go-live for the same reason.)

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
    " \'చెప్పండి\'. \'మీకు ఎలా సహాయం చేయగలను\' is BANNED everywhere — not as an"
    " opener, not tacked onto the end of an answer, not anywhere. It is how a"
    " call centre script sounds, not a person."
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
    "\n- The address and the town are facts like any other. If they are not"
    " listed below, say you will confirm the address and send it — do NOT"
    " name a place. On one call she gave two different towns for the same"
    " clinic in the same conversation, which is worse than not knowing."
    "\n- If you did not understand what they said, ASK. Never agree with a"
    " sentence you cannot make sense of. A caller once said something the"
    " speech recogniser mangled and got \'అవునండి\' plus a promise to do it"
    " — agreeing to nonsense sounds far worse than \'అర్థం కాలేదండి, ఒక్కసారి"
    " చెప్తారా?\'."
    "\n- Never ask for the same thing twice in a row. If they did not answer,"
    " move on — much later, or not at all."
    "\n- Never send a reply they have already heard. A caller repeating"
    " themselves or sounding annoyed is telling you the last one failed."
    "\n- Never claim to be a person. Asked outright, say you are an"
    " assistant, and carry on."
    # A caller asked "location share చేస్తారా?" and she answered "ఖచ్చితంగా
    # మీ నంబర్‌కి వాట్సాప్‌లో లొకేషన్ పంపిస్తానండి" — definitely, I will send it.
    # Nothing in this system can send a location: the only WhatsApp templates
    # that exist are appointment confirmation, missed-call follow-up and the
    # brochure. He is still waiting. A promise that quietly never arrives
    # costs more trust than saying no, because he stops checking his phone
    # only after he has already decided you are unreliable.
    "\n- Never promise to SEND something this system cannot send. You can:"
    " book an appointment, send a WhatsApp confirmation of one, send the"
    " brochure, take a callback, and pass a caller to a person. You CANNOT"
    " send a location pin, a photo, a map, a document, a prescription, a"
    " price list or an email — do not say you will, and do not offer to send"
    " them \'on WhatsApp\' either. WhatsApp carries the confirmation and the"
    " brochure, nothing else."
    "\n- Refuse those the way a receptionist does — \'అది పంపలేనండి\' — then say"
    " what you CAN do. Never explain yourself in terms of a system or"
    " software; a person saying \'ఈ సిస్టమ్ ద్వారా కుదరదు\' is the illusion"
    " breaking."
    "\n- Asked for the address or directions: read out the address from the"
    " facts below if it is there. If it is not, say you will have someone"
    " send it and take their number — never say you will send it yourself."
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
    "\n- A phone number is read digit by digit in two groups, సున్నా for zero,"
    " డబల్ for a repeated digit — never as one long number."
    "\n- Money in round Telugu forms: రెండొందలు, మూడొందలు, వెయ్యి — not \'Rs 300\'."
    "\n- Dates as \'సెప్టెంబర్ రెండో తారీఖు\'."
    "\n- Match their energy. Someone in a hurry gets a shorter answer and no"
    " opener; someone confused or elderly gets one fact per turn, confirmed"
    " before the next."
    # Retell's NO_RESPONSE_NEEDED pattern. Without this she answers "ఒక్క
    # నిమిషం" with chatter, which is the one thing a caller asking for
    # silence does not want. Handled in on_speech and browser_chat: the
    # sentinel is swallowed, never synthesised.
    # Without this a booked caller and a booked Nikki sit on an open line
    # waiting for the other to give up. Gated in code on a real appointment
    # row, so emitting it early costs nothing but a log line.
    "\n\n[THEIR PHONE NUMBER]"
    "\nYou already have it — they are calling from it, and it is listed in"
    " the facts below. NEVER ask them to read it out. Confirm it instead:"
    " \'మీరు కాల్ చేస్తున్న ఈ నంబర్‌కే వాట్సాప్ పంపమంటారా?\' Ask for a number only"
    " if they tell you to use a different one."
    "\n\n[ENDING THE CALL]"
    "\nOnce the appointment is CONFIRMED and they have nothing else, say your"
    " closing line — \'సరేనండి, థాంక్యూ అండి, మంచిది\' — and then, on the same"
    " line, add the token END_CALL. It is never spoken; it tells the line to"
    " hang up after your goodbye finishes."
    "\nOnly then. Not while anything is still being agreed, not if they have"
    " just asked something, and never merely because they said ok."
    "\nNever ask a question in the same reply as your closing line. If you are"
    " asking, you are not closing — wait for their answer first. Confirming"
    " their number and saying goodbye in one breath leaves them answering a"
    " question to a dead line."
    "\n\n[IF THEY ASK YOU TO HOLD]"
    "\nఆగండి / ఒక్క నిమిషం / hold on — reply with exactly SILENT and nothing"
    " else. It is a signal to stop talking, not a word to say aloud."
    # Vapi's guidance: three transcripts encode register more reliably than
    # any number of abstract rules. Happy path, deflection, recovery.
    # These teach REGISTER only. They deliberately state no hours, prices or
    # business name: this persona is shared by every tenant, and a few-shot
    # is copied readily enough that a concrete fact here would surface in
    # some other business's call as a confidently wrong one.
    "\n\n[EXAMPLES — how she sounds, not scripts to reuse verbatim]"
    "\nC: డాక్టర్ గారు రేపు ఉంటారా? అపాయింట్మెంట్ కావాలి."
    "\nN: అవునండి, ఉంటారండి. మీ పేరు చెప్తారా సర్?"
    "\nC: దీనికి ఎంత అవుతుందండి?"
    "\nN: అదండీ... డాక్టర్ గారు ఒకసారి చూశాకే కరెక్ట్‌గా చెప్పగలరండి. అపాయింట్‌మెంట్ పెట్టమంటారా?"
    "\nC: హలో, సురేష్ ట్రావెల్స్ ఆ?"
    "\nN: కాదండి, నంబర్ తప్పు పడినట్టుందండి."
    "\n\n[WHAT YOU ARE COLLECTING]"
    "\nHelping comes first; this is secondary. Their name and a 10-digit"
    " number, plus whatever this business needs. Take everything they"
    " volunteer at once and never ask for it again. One item at a time, in"
    " whatever order it comes. Ask for an appointment day only if this"
    " business books appointments. Missed it: \'ఒక్కసారి మళ్ళీ చెప్తారా?\'"
)


LANG_NAMES = {"te-IN": "Telugu", "hi-IN": "Hindi",
              "bn-IN": "Bengali", "en-IN": "Indian English"}


def _neutral_persona(lang: str) -> str:
    """The behaviour rules, without the Telugu register pack.

    Deliberately NOT a translation of TELUGU_PHONE_PERSONA. That document is
    a register pack — honorific particles, banned officialese, spoken number
    forms, three sample dialogues — built from research into how Telugu
    receptionists actually speak. Machine-translating it into Bengali would
    produce confident nonsense about a language nobody here has tested, and
    the failure mode would be a tenant's callers hearing subtly wrong
    politeness for months.

    So this carries only what is language-independent — length, honesty,
    not repeating, not inventing, the hold sentinel — and asks the model to
    be a natural receptionist in the target language. It is a floor, not a
    match for the Telugu one. Any language that gets real volume deserves
    its own pack written the same way Telugu's was.
    """
    name = LANG_NAMES.get(lang, "the caller's language")
    return (
        f"\n\n[HOW YOU SPEAK]"
        f"\nThis is a live phone call and everything you write is spoken"
        f" aloud. Speak {name}, the way a receptionist at this business"
        f" actually speaks it — not the way a form reads."
        f"\n- One sentence. A second only if it is a question."
        f"\n- Lead with the answer, then ask."
        f"\n- React to what they said before you ask anything."
        f"\n- Use the polite register and the honorifics a receptionist would"
        f" use with a stranger on the phone. English loan words that people"
        f" genuinely use — appointment, doctor, time, number, WhatsApp,"
        f" confirm, booking, address, cancel — stay in English."
        f"\n- Follow the caller if they switch language; answer in whatever"
        f" they used."
        f"\n- Say times, prices and phone numbers as WORDS, never as digits,"
        f" and give a time its part of day."
        f"\n- At most two options aloud. No lists, markdown, emoji or asterisks."
        "\n\n[WHAT YOU KNOW FOR CERTAIN]"
        "\nThe business name, working hours, open days and services below are"
        " FACTS. State them plainly, never say you do not know them. If a day"
        " is not in the open days the business is shut that day: say so and"
        " offer the next open one. Today's date is below — work out what"
        " 'tomorrow' is before agreeing to it. Write the business name exactly"
        " as given."
        "\n\n[WHAT YOU NEVER DO]"
        "\n- Never invent a price, a doctor's availability, or any fact NOT"
        " listed below. Say you will find out, and offer a callback."
        "\n- Never ask for the same thing twice in a row."
        "\n- Never send a reply they have already heard."
        "\n- Never claim to be a person. Asked outright, say you are an"
        " assistant, and carry on."
        "\n- Never promise to SEND something this system cannot send. You can:"
        " book an appointment, send a WhatsApp confirmation of one, send the"
        " brochure, take a callback, and pass a caller to a person. You CANNOT"
        " send a location pin, a photo, a map, a document, a prescription, a"
        " price list or an email — and do not offer to send them 'on WhatsApp'"
        " either. Refuse plainly, the way a receptionist would, and never in"
        " terms of a system or software."
        "\n- Asked for the address: read it out from the facts below if it is"
        " there. Never say you will send it yourself."
        "\n\n[THEIR PHONE NUMBER]"
        "\nYou already have it — they are calling from it, and it is listed in"
        " the facts below. NEVER ask them to read it out. Confirm it instead:"
        " ask whether WhatsApp should go to the number they are calling from."
        " Ask for a number only if they tell you to use a different one."
        "\n\n[ENDING THE CALL]"
        "\nOnce the appointment is CONFIRMED and they have nothing else, say"
        " your closing line and then, on the same line, add the token"
        " END_CALL. It is never spoken; it tells the line to hang up after"
        " your goodbye finishes. Only then — not while anything is still"
        " being agreed, and never merely because they said ok."
        "\nNever ask a question in the same reply as your closing line. If you"
        " are asking, you are not closing — wait for their answer first."
        "\n\n[IF THEY ASK YOU TO HOLD]"
        "\nIf they ask you to wait or hold on, reply with exactly SILENT and"
        " nothing else. It is a signal to stop talking, not a word to say."
        "\n\n[WHAT YOU ARE COLLECTING]"
        "\nHelping comes first; this is secondary. Their name and a 10-digit"
        " number, plus whatever this business needs. Take everything they"
        " volunteer at once and never ask for it again."
    )


def _persona_for(lang: str) -> str:
    """Telugu gets the researched register pack; everything else the floor."""
    return TELUGU_PHONE_PERSONA if lang == "te-IN" else _neutral_persona(lang)


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


# IST, always, regardless of the container's clock. The pipeline image sets
# no TZ, so datetime.now() is UTC — and between 18:30 and 24:00 UTC (which is
# 00:00-05:30 IST) that is YESTERDAY'S date to everyone on the call.
#
# This was not theoretical. On the 02:26 IST call from 8885490495, the prompt
# said "Today: 2026-09-02" so Nikki told the caller "రేపు సెప్టెంబర్ మూడో తారీఖు"
# — tomorrow, the 3rd. _enrich_appointment, which already resolved dates in
# IST, read the same "రేపు" as the 4th and wrote slot_date 2026-09-04. She
# said one date out loud and booked another, then WhatsApped the second one.
# A patient arrives on the wrong day and the clinic is not expecting them.
# ── Tenant language ───────────────────────────────────────────────────────
# MUSKAN CLINIC is in Uttar Dinajpur, West Bengal. Its patients were being
# answered in Telugu, because TELUGU_PHONE_PERSONA was applied to every
# tenant unconditionally and te-IN was hardcoded into both STT and TTS. The
# model knew: on call d3b61bf3 it opened with "নమస్కారం" — a Bengali ন welded
# onto a Telugu word, which bulbul cannot say.
#
# Defaults to te-IN, and reads the column defensively, so this ships safely
# BEFORE supabase/041_tenant_language.sql is applied: until the column
# exists every profile simply has no `language` key and nothing changes.
LANG_DEFAULT = "te-IN"
SUPPORTED_LANGS = {"te-IN", "hi-IN", "bn-IN", "en-IN"}


def _tenant_lang(profile: dict | None) -> str:
    lang = ((profile or {}).get("language") or "").strip()
    return lang if lang in SUPPORTED_LANGS else LANG_DEFAULT


def _valid_mobile(num: str | None) -> str | None:
    """The last 10 digits, if they look like an Indian mobile.

    Caller ID arrives in several shapes — 9848012345, 09848012345,
    +919848012345 — and can be absent or withheld entirely, in which case
    everything here must fall back to the old ask-them behaviour rather than
    confirming a number nobody has.
    """
    digits = re.sub(r"\D", "", str(num or ""))
    if len(digits) >= 10:
        digits = digits[-10:]
        if digits[0] in "6789":
            return digits
    return None


def _now_ist() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


def build_system_prompt(profile: dict, knowledge: list[str] | None = None) -> str:
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

    now = _now_ist().strftime("%Y-%m-%d %H:%M")
    # The weekday, spelled out. Without it the model cannot tell whether
    # "tomorrow" falls on a day the business is shut — it told a caller with
    # toothache to come tomorrow, which was a Sunday, on a Mon-Sat clinic.
    weekday = _now_ist().strftime("%A")
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
{_knowledge_block(knowledge)}{_negotiation_block(profile.get('negotiation'))}
""" + _persona_for(_tenant_lang(profile)) + _PRICING_CACHE.get("text", "")


def _negotiation_block(policy: dict | None) -> str:
    """What this business has authorised her to agree to.

    Callers to an Indian small business haggle; it is the normal shape of the
    conversation. With no policy she used to either refuse to engage — which
    sounds like a form, not a receptionist — or improvise a discount nobody
    authorised, which the owner then discovers at the counter.

    So: nothing here is invented. Every number comes from what the business
    typed, and the absence of a policy produces an explicit refusal rather
    than silence, because a model with no instruction will negotiate anyway.
    """
    p = policy or {}
    if not p.get("enabled"):
        # One line, not a paragraph. Every character here is prefill on the
        # caller's critical path and this is the case that applies to almost
        # every business.
        return ("\n[ON PRICE] State only prices you were given. If pushed for a "
                "discount, say the owner decides pricing and offer a callback.\n")

    lines = [
        "\n[NEGOTIATING — what this business lets you agree to]",
        "The caller may haggle. That is normal; engage with it like a person, "
        "not a policy document. Hear the number they want before you answer.",
    ]
    if p.get("floor_note"):
        lines.append(f"- The lowest you may ever agree to: {p['floor_note']}. "
                     "Never go below it, never imply you could if they pushed harder, "
                     "and never say what your limit is.")
    if p.get("max_discount_pct"):
        lines.append(f"- You may come down at most {p['max_discount_pct']}% from the "
                     "stated price, and only if they ask. Do not open with it.")
    offers = [o for o in (p.get("offers") or []) if str(o).strip()]
    if offers:
        lines.append("- Prefer offering these over cutting the price — most "
                     "negotiations settle on one: " + "; ".join(str(o) for o in offers) + ".")
    lines += [
        "- Concede ONCE. If they push again after your best offer, hold it kindly "
        "and suggest speaking to the owner rather than sliding further.",
        "- Never invent a discount, a scheme or a deadline that was not given to you.",
        "- If they agree, say the final figure back plainly so there is no doubt.",
    ]
    if p.get("close_line"):
        lines.append(f"- When they accept, say: {p['close_line']}")
    return "\n".join(lines) + "\n"


def _knowledge_block(knowledge: list[str] | None) -> str:
    """Facts the business taught Nikki — brochures, Teach Nikki, uploads.

    This existed end to end EXCEPT for being read: knowledge_base was
    written by the brochure extractor and the Teach Nikki page, embeddings
    were generated, match_knowledge() was defined — and the phone path never
    called any of it. Businesses uploaded documents and Nikki could not
    quote a word of them.

    Retrieval is deliberately not used. A small business has tens of facts,
    not thousands; embedding the caller's question would add an API round
    trip to every single turn of a live conversation to choose between forty
    short lines that all fit in the prompt anyway. Give her the facts and
    let the model pick.
    """
    facts = [f.strip() for f in (knowledge or []) if f and f.strip()]
    if not facts:
        return ""
    kept = facts[:40]
    if len(facts) > len(kept):
        log.info(f"[knowledge] {len(facts)} facts, using first {len(kept)}")
    lines = "\n".join(f"- {f[:300]}" for f in kept)
    return ("\n[THIS BUSINESS TOLD YOU]\n"
            f"{lines}\n")

# ── SHARED HTTP POOL for the caller's critical path ─────────────────
# STT, Gemini and TTS each opened a fresh AsyncClient per request, paying a
# full TCP + TLS handshake to a US/Mumbai endpoint on every single turn —
# three handshakes per turn, ~100-300ms each. The research measured
# flash-lite's real first-token time at ~240-290ms against our ~1s, and
# named cold connections as the recoverable difference. One pooled client
# with keep-alive makes every request after the first ride a warm socket.
#
# Only the three latency-critical call sites use it. Webhooks and other
# housekeeping keep their throwaway clients: a leaked handshake there costs
# nobody anything, and sharing one pool everywhere couples failure domains.
_POOL = httpx.AsyncClient(
    timeout=httpx.Timeout(15.0, connect=5.0),
    limits=httpx.Limits(max_keepalive_connections=10, max_connections=24,
                        keepalive_expiry=90.0),
)

_SARVAM_402_AT: float = 0.0   # last time Sarvam said 402 — /health shows it
_TTS_VENDOR: str = "sarvam"   # which vendor last spoke; /health shows it

# ── SARVAM STT ───────────────────────────────────────────
class SarvamSTT:
    """Sarvam Saaras V3 STT. Language comes from the tenant, not a constant."""

    def __init__(self, lang: str = LANG_DEFAULT):
        self.api_key = SARVAM_KEY
        self.lang = lang
        self.base_url = "https://api.sarvam.ai/speech-to-text"

    async def transcribe(self, audio_bytes: bytes) -> str:
        try:
            resp = await _POOL.post(
                self.base_url,
                headers={"api-subscription-key": self.api_key},
                files={"file": ("audio.wav", audio_bytes, "audio/wav")},
                data={
                    "model": "saaras:v3",
                    # te-IN + codemix. codemix is what handles the English
                    # words inside Telugu speech (39.7% of tokens), writing
                    # them in Latin script; the language pin is what stops
                    # the OTHER failure — with "unknown", short fragments
                    # came back transcribed as Hindi, Punjabi and Kannada in
                    # one synthetic call, a per-segment language lottery.
                    "language_code": self.lang,
                    "mode": "codemix",
                    "with_timestamps": "false",
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("transcript", "")
        except httpx.HTTPError as e:
            if "402" in str(e):
                # Out of Sarvam credits. This is an OUTAGE, not an error to
                # absorb quietly: every caller on every tenant is now deaf.
                global _SARVAM_402_AT
                _SARVAM_402_AT = time.time()
                log.critical("SARVAM CREDITS EXHAUSTED — every call is deaf until topped up")
            else:
                log.error(f"Sarvam STT error: {e} — switching to Google fallback")
            return await self._google_fallback(audio_bytes)
        except Exception as e:
            log.error(f"Sarvam STT unexpected error: {e}")
            return ""

    async def _google_fallback(self, audio_bytes: bytes) -> str:
        """Google Cloud STT Chirp 2 — fallback for Sarvam failures."""
        # The real calls that exposed this had ?key= — EMPTY — in the log:
        # the fallback has never once worked, and each attempt added ~400ms
        # of guaranteed 403 to a turn that was already failing.
        if not os.environ.get("GOOGLE_STT_KEY"):
            return ""
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
                            # NOT chirp_2. Chirp and Chirp 2 exist only on the
                            # v2 API, which is a different host, needs a
                            # recognizer resource, and does not accept API keys
                            # at all — so this request would have been rejected
                            # for the model even once a key was set, and the
                            # error would have looked like a bad key.
                            # "telephony" is the v1 model built for 8kHz
                            # narrowband call audio, which is exactly what
                            # arrives here.
                            "model": "telephony",
                            "useEnhanced": True,
                        },
                        "audio": {"content": base64.b64encode(audio_bytes).decode()}
                    }
                )
                if resp.status_code == 200:
                    results = resp.json().get("results", [])
                    if results:
                        return results[0]["alternatives"][0]["transcript"]
                    log.warning("Google STT returned no results")
                else:
                    # Say what Google actually objected to. A silent fallback
                    # that fails is worse than no fallback: it looks configured.
                    log.error(f"Google STT {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            log.error(f"Google STT fallback also failed: {e}")
        return ""


# ── SARVAM STREAMING STT ────────────────────────────────────────────
# The batch POST above pays its whole round-trip AFTER the caller stops
# speaking — the expensive pattern (Coval measured 1-2s of serial post-turn
# STT across vendors). This client holds a WebSocket open for the call and
# is fed the same 20ms frames the FreeSWITCH handler already receives, so
# the transcript is essentially ready the moment the silence window closes.
#
# Fails OPEN to batch: any error marks the stream dead and the turn falls
# back to SarvamSTT.transcribe with the buffered utterance. A streaming
# outage must never cost a caller their call.
class SarvamStreamingSTT:
    # Built per instance, not as a class attribute: the language is the
    # tenant's, and a class attribute is evaluated once at import with no
    # tenant in scope.
    @staticmethod
    def _url(lang: str) -> str:
        return ("wss://api.sarvam.ai/speech-to-text/ws"
                f"?model=saaras:v3&language_code={lang}&mode=codemix&sample_rate=8000"
                "&input_audio_codec=pcm_s16le&flush_signal=true&vad_signals=false")

    _FLUSH = object()          # queue sentinel: flush ordered after prior audio

    def __init__(self, lang: str = LANG_DEFAULT):
        self.lang = lang
        self._ws = None
        self._segments: list = []
        self._recv_task = None
        self._send_task = None
        # One ordered queue, one sender task. Spawning a task per frame gives
        # no ordering guarantee across tasks — out-of-order 20ms frames
        # garble transcription silently. put_nowait from the frame loop also
        # means a network stall can never block the loop handling barge-in.
        self._q: "asyncio.Queue" = asyncio.Queue(maxsize=600)
        self._flush_evt = asyncio.Event()
        self.dead = False

    async def start(self) -> bool:
        try:
            import websockets
            log.info("[sttws] connecting...")
            self._ws = await asyncio.wait_for(
                websockets.connect(
                    self._url(self.lang),
                    additional_headers={"Api-Subscription-Key": SARVAM_KEY},
                    max_size=2 ** 22,
                ),
                timeout=4.0,
            )
            self._recv_task = asyncio.create_task(self._recv_loop())
            self._send_task = asyncio.create_task(self._send_loop())
            log.info("[sttws] connected")
            return True
        except Exception as e:  # noqa: BLE001
            log.warning(f"[sttws] connect failed ({e}) — batch fallback for this call")
            self.dead = True
            return False

    async def _recv_loop(self):
        import base64  # noqa: F401
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                data = msg.get("data") or {}
                if isinstance(data, dict) and data.get("transcript") is not None:
                    log.info(f"[sttws] segment: {str(data['transcript'])[:60]!r}")
                    self._segments.append(str(data["transcript"]))
                    # Any transcript after a flush means the flush answered.
                    self._flush_evt.set()
                elif msg.get("type") == "error":
                    log.warning(f"[sttws] server error: {str(msg)[:160]}")
        except Exception as e:  # noqa: BLE001
            if not self.dead:
                log.debug(f"[sttws] recv loop ended: {e}")
        finally:
            self.dead = True
            self._flush_evt.set()

    def feed(self, pcm: bytes) -> None:
        """Queue one chunk of raw 8kHz s16le PCM. Never blocks, never raises."""
        if self.dead:
            return
        try:
            self._q.put_nowait(pcm)
        except asyncio.QueueFull:
            # 600 x 20ms = 12s of backlog: the socket is not keeping up, and
            # batch fallback will carry the call from here.
            log.warning("[sttws] queue full — batch fallback")
            self.dead = True

    async def _send_loop(self):
        import base64
        try:
            while not self.dead:
                item = await self._q.get()
                if item is self._FLUSH:
                    await self._ws.send(json.dumps({"type": "flush"}))
                    continue
                await self._ws.send(json.dumps({
                    "audio": {
                        "data": base64.b64encode(item).decode(),
                        # Live-server enum: only 'audio/wav' passes; the raw
                        # format is carried by the connection-level
                        # input_audio_codec=pcm_s16le.
                        "encoding": "audio/wav",
                        "sample_rate": 8000,
                    },
                }))
        except Exception as e:  # noqa: BLE001
            if not self.dead:
                log.warning(f"[sttws] send loop ended ({e}) — batch fallback")
            self.dead = True

    async def finish_turn(self, timeout: float = 1.2) -> str:
        """Flush, wait briefly for the final segment, return + reset."""
        if self.dead or not self._ws:
            return ""
        try:
            self._flush_evt.clear()
            # Through the queue, so the flush lands AFTER every frame already
            # queued — sending it around them would finalise early.
            self._q.put_nowait(self._FLUSH)
            try:
                await asyncio.wait_for(self._flush_evt.wait(), timeout=timeout)
                # Grace drain: a caller's LAST word often rides a segment that
                # finalises a beat after the first flush response — observed
                # live as "సోమవారం సరే నా పేరు." with the name itself arriving
                # just after return and being thrown away with the reset.
                await asyncio.sleep(0.15)
            except asyncio.TimeoutError:
                # Segments that arrived DURING speech are still usable; only
                # the tail is at risk, and batch fallback would cost more
                # than it saves at this point.
                pass
            out = " ".join(x for x in self._segments if x).strip()
            log.info(f"[sttws] finish_turn -> {len(out)} chars, dead={self.dead}")
            self._segments = []
            return out
        except Exception as e:  # noqa: BLE001
            log.warning(f"[sttws] flush failed ({e})")
            self.dead = True
            return ""

    async def close(self):
        self.dead = True
        try:
            if self._send_task:
                self._send_task.cancel()
            if self._recv_task:
                self._recv_task.cancel()
            if self._ws:
                await self._ws.close()
        except Exception:  # noqa: BLE001
            pass


# ── SARVAM TTS ───────────────────────────────────────────
# Last synthesis time, so a turn can report what the caller waited for.
_SarvamTTS_LAST: dict = {"ms": 0.0}


class SarvamTTS:
    """Sarvam Bulbul V3 TTS — 8kHz telephony, Mulaw output."""

    def __init__(self, lang: str = LANG_DEFAULT):
        self.api_key = SARVAM_KEY
        self.lang = lang

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
                    _SarvamTTS_LAST["ms"] = 0.0     # a cache hit costs nothing
                    return f.read()
        except OSError:
            pass

        _t = time.monotonic()
        audio = await self._synthesize_uncached(text, speaker, rate)
        _SarvamTTS_LAST["ms"] = (time.monotonic() - _t) * 1000

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

    async def _synthesize_ws(self, text: str, speaker: str, rate: int) -> bytes:
        """bulbul over WebSocket: measured 75ms to first audio after a 195ms
        connect, against a ~700ms floor per REST request. Chunks arrive as
        complete RIFF WAVs; their PCM is concatenated and re-wrapped, because
        playback is file-based (uuid_broadcast) and needs one clip.
        Raises on any problem — the caller falls back to REST."""
        import websockets
        uri = "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3&send_completion_event=true"
        pcm = bytearray()
        async with websockets.connect(
            uri, additional_headers={"Api-Subscription-Key": self.api_key},
            open_timeout=3.0, max_size=2 ** 22,
        ) as ws:
            await ws.send(json.dumps({"type": "config", "data": {
                "target_language_code": self.lang, "speaker": speaker,
                "pace": 1.0, "speech_sample_rate": rate,
                "enable_preprocessing": True, "output_audio_codec": "wav",
                "min_buffer_size": 30, "max_chunk_length": 120,
            }}))
            await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
            await ws.send(json.dumps({"type": "flush"}))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=6.0)
                m = json.loads(raw)
                t = m.get("type")
                if t == "audio":
                    import base64
                    b = base64.b64decode(m["data"]["audio"])
                    pcm.extend(b[44:] if b[:4] == b"RIFF" else b)
                elif t == "error":
                    raise RuntimeError(str(m)[:200])
                else:
                    # completion / event frame — synthesis is done.
                    break
        if not pcm:
            raise RuntimeError("ws synthesis returned no audio")
        return _pcm16_to_wav_bytes(bytes(pcm), rate)

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

        # WebSocket first on the phone path — it is what turns the ~700ms
        # REST floor into ~300ms end to end for a short chunk. REST stays as
        # the fallback and as the browser path (22050 works fine there and a
        # web turn is not latency-critical to the same degree).
        if rate == 8000:
            try:
                return await self._synthesize_ws(text, speaker, rate)
            except Exception as e:  # noqa: BLE001
                log.warning(f"[ttsws] fell back to REST: {e}")

        try:
            resp = await _POOL.post(
                "https://api.sarvam.ai/text-to-speech",
                headers={
                    "api-subscription-key": self.api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "inputs": [text],
                    "target_language_code": self.lang,
                    "speaker": speaker,
                    "model": "bulbul:v3",
                    "pace": 1.0,
                    # 8000 for the phone, where the trunk is narrowband
                    # anyway; 22050 for a browser. The landing-page agent
                    # was synthesising at 8k and playing it through laptop
                    # speakers — telephone audio on a hi-fi output, which
                    # is thin and metallic and reads as "scary" rather than
                    # as a person.
                    "speech_sample_rate": rate,
                    "enable_preprocessing": True,
                    "eng_interpolation_wt": 100,
                },
                timeout=15.0,
            )
            resp.raise_for_status()
            import base64
            data = resp.json()
            audio_b64 = data.get("audios", [""])[0]
            # Failing over is only half the job; coming back is the other
            # half. A top-up should restore the real voice on the next line
            # without anyone restarting anything.
            global _TTS_VENDOR
            if _TTS_VENDOR != "sarvam":
                log.critical(f"TTS RECOVERED — back on sarvam from {_TTS_VENDOR}")
                _TTS_VENDOR = "sarvam"
            return base64.b64decode(audio_b64)
        except httpx.HTTPError as e:
            if "402" in str(e):
                global _SARVAM_402_AT
                _SARVAM_402_AT = time.time()
                log.critical("SARVAM CREDITS EXHAUSTED — falling back for speech")
            else:
                log.error(f"Sarvam TTS error: {e} — falling back")
            return await self._fallback_tts(text, rate)
        except Exception as e:  # noqa: BLE001
            # Any failure at all, not only an HTTP one: a DNS blip or a
            # timeout leaves the caller in exactly the same silence.
            log.error(f"Sarvam TTS unexpected: {e} — falling back")
            return await self._fallback_tts(text, rate)

    async def _fallback_tts(self, text: str, rate: int = 8000) -> bytes:
        """Speak when Sarvam cannot.

        Sarvam ran out of credits mid-day and every caller heard the cached
        greeting followed by silence, because the only fallback here needed
        an Azure key nobody had set — it returned b"" and said nothing about
        why. A fallback that is never exercised is not a fallback; it is a
        comment.

        So: try each configured vendor in turn, say in the log which one
        served the line, and record that we are degraded so /health can show
        it. Order is deliberate — Azure's te-IN neural voice is markedly
        closer to Sarvam's than Google's standard voice, so a caller mid-call
        hears less of a change.
        """
        global _TTS_VENDOR
        for name, fn, configured in (
            ("azure",  self._azure_fallback, bool(os.environ.get("AZURE_SPEECH_KEY"))),
            ("google", self._google_tts,     bool(os.environ.get("GOOGLE_TTS_KEY")
                                                  or os.environ.get("GOOGLE_STT_KEY"))),
        ):
            if not configured:
                continue
            try:
                audio = await fn(text, rate) if name == "google" else await fn(text)
                if audio and len(audio) > 1000:
                    if _TTS_VENDOR != name:
                        log.critical(f"TTS FAILING OVER to {name} — Sarvam is not answering")
                        _TTS_VENDOR = name
                    return audio
                log.error(f"[tts] {name} returned nothing usable")
            except Exception as e:  # noqa: BLE001
                log.error(f"[tts] {name} fallback failed: {e}")

        log.critical(
            "TTS DOWN — Sarvam is failing and no fallback vendor is configured. "
            "Callers will hear cached lines only. Set AZURE_SPEECH_KEY or GOOGLE_TTS_KEY."
        )
        return b""

    async def _google_tts(self, text: str, rate: int = 8000) -> bytes:
        """Google Cloud TTS, te-IN. Uses an API key, so it needs no service
        account — and the same key works for the STT fallback if both APIs
        are enabled on the project, which is one key to obtain rather than
        two."""
        key = os.environ.get("GOOGLE_TTS_KEY") or os.environ.get("GOOGLE_STT_KEY", "")
        if not key:
            return b""
        resp = await _POOL.post(
            "https://texttospeech.googleapis.com/v1/text:synthesize",
            params={"key": key},
            json={
                "input": {"text": text[:2400]},
                # Standard-A is the female te-IN voice, the closest match to
                # the bulbul speakers used everywhere else.
                "voice": {"languageCode": "te-IN", "name": "te-IN-Standard-A"},
                "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": rate},
            },
            timeout=12.0,
        )
        if resp.status_code != 200:
            log.error(f"[tts] google {resp.status_code}: {resp.text[:180]}")
            return b""
        import base64 as _b64
        audio = _b64.b64decode(resp.json().get("audioContent", ""))
        # LINEAR16 comes back as a RIFF container, but wrap defensively: the
        # playback path writes the bytes to a file FreeSWITCH plays, and raw
        # PCM with no header is played as noise rather than refused.
        if audio[:4] != b"RIFF":
            audio = _pcm16_to_wav_bytes(audio, sample_rate=rate)
        return audio

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
            # from it.
            #
            # Re-measured 2026-09-01 against this key, streaming, with the
            # real persona and this payload (300 tokens, no thinkingConfig),
            # 20 Telugu turns per model. TTFT p50 / p95:
            #
            #   gemini-3.5-flash-lite      0.86s / 1.04s   <- chosen
            #   gemini-flash-lite-latest   0.86s / 1.13s
            #   gemini-3.1-flash-lite      1.04s / 1.56s
            #   gemini-flash-latest        1.91s / 2.44s   truncates (below)
            #   gemini-3.5-flash           2.43s / 2.83s   truncates (below)
            #   gemini-3.6-flash           2.01s / 2.52s   truncates (below)
            #
            # 3.5-flash-lite ties on p50 and wins the tail, which is the
            # number that matters — variance is what reads as robotic, not
            # the median. It also held register better: flash-lite-latest
            # emitted "అరటిపండులా మాట్లాడటం లేదండి" (…like a banana) on a
            # confused-caller turn, and the 3.1 tier still drifts into the
            # banned "మీకు ఎలా సహాయం చేయగలను".
            #
            # Do NOT "upgrade" to a full flash tier. They think before
            # answering, thinking tokens are billed against maxOutputTokens,
            # and at our 300 they burn the budget and return a reply cut off
            # mid-word — the exact broken-model symptom the 300 was raised to
            # fix. They are also 2-3x slower to first token.
            #
            # Corrections to what this comment used to say, both verified
            # against the live API: gemini-2.5-flash is not "closed to new
            # keys", it is retired outright ("no longer supported"); and
            # thinkingBudget:0 is rejected by flash-lite-latest and
            # 3.5-flash-lite too, not only by 3.6-flash. We send no
            # thinkingConfig at all, so that rejection never fires here.
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{resolve_gemini_model()}"
            ":generateContent"
        )

    async def generate(self, system_prompt: str, history: list[dict],
                       temperature: float | None = None,
                       first_clause_cb=None) -> str:
        """first_clause_cb: called ONCE with the first clause (~sentence or
        ~55 chars at a comma) as soon as the token stream produces it, while
        the rest is still generating. The phone path uses it to start TTS on
        the opening clause immediately — the tail of generation leaves the
        caller's critical path. Falls back to the batch request on any
        streaming error; the callback simply never fires and the turn
        proceeds exactly as before."""
        if first_clause_cb is not None:
            try:
                return await self._generate_streaming(
                    system_prompt, history, temperature, first_clause_cb)
            except Exception as e:  # noqa: BLE001
                log.warning(f"Gemini stream failed ({e}) — batch fallback")
        return await self._generate_batch(system_prompt, history, temperature)

    async def _generate_streaming(self, system_prompt, history, temperature,
                                  first_clause_cb) -> str:
        payload = self._payload(system_prompt, history, temperature)
        url = self.base_url.replace(":generateContent", ":streamGenerateContent")
        headers = {"Content-Type": "application/json",
                   "x-goog-api-key": self.api_key}
        text, fired = "", False
        async with _POOL.stream("POST", url, headers=headers,
                                params={"alt": "sse"}, json=payload,
                                timeout=12.0) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    j = json.loads(line[6:])
                    piece = j["candidates"][0]["content"]["parts"][0]["text"]
                except Exception:  # noqa: BLE001 — keepalives, finish chunks
                    continue
                text += piece
                if not fired:
                    cut = self._first_clause_cut(text)
                    if cut:
                        fired = True
                        try:
                            first_clause_cb(text[:cut])
                        except Exception as e:  # noqa: BLE001
                            log.debug(f"first_clause_cb error: {e}")
        for vendor in ["Sarvam", "Gemini", "LiveKit", "Exotel", "Plivo",
                       "supabase", "OpenAI"]:
            text = text.replace(vendor, "our system")
        if text.strip():
            self._consecutive_failures = 0
            return text.strip()
        raise RuntimeError("empty stream")

    @staticmethod
    def _first_clause_cut(text: str) -> int:
        """Index to cut the opening clause at, or 0 if not yet determined.
        A sentence end wins; a comma after enough words is good enough —
        Telugu's agglutinative words make sub-clause cuts risky, so nothing
        shorter than a clause is ever dispatched."""
        m = re.search(r"[.!?\u0964]\s", text)
        if m and m.start() >= 12:
            return m.start() + 1
        if len(text) >= 55:
            c = text.rfind(",", 25, 90)
            if c > 0:
                return c + 1
        return 0

    def _payload(self, system_prompt: str, history: list[dict],
                 temperature: float | None = None) -> dict:
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
                # 300 let her answer "what do you do?" with 353 characters —
                # nine and a half seconds of the caller listening, and 4.4
                # seconds of synthesis before any of it started. The persona
                # says one sentence; nothing enforced it. 150 is comfortably
                # more than a real one-sentence Telugu reply needs (a booking
                # confirmation measures ~40 tokens) and makes a monologue
                # impossible rather than merely discouraged.
                "maxOutputTokens": 150,
                # 0.15 default; callers may pin it. The web product persona
                # passes 0.0 so identical questions from different visitors
                # produce identical replies — which is what lets the
                # api-server's TTS cache actually hit. Phone calls keep 0.15:
                # their history differs every turn, so variety never depended
                # on sampling noise anyway.
                "temperature": 0.15 if temperature is None else temperature,
                "topP": 0.8,
            }
        }
        return payload

    async def _generate_batch(self, system_prompt: str, history: list[dict],
                              temperature: float | None = None) -> str:
        payload = self._payload(system_prompt, history, temperature)
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
                    # Warm pooled connection — the research put flash-lite's
                    # real first-token at ~240-290ms against our measured ~1s,
                    # and a fresh TLS handshake per call was the named suspect.
                    resp = await _POOL.post(
                        self.base_url,
                        headers=headers,
                        params=params,
                        json=payload,
                        timeout=budget,
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

    async def get_campaign_script(self, campaign_id: str) -> str:
        """The script the business wrote for this campaign."""
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(
                    f"{self.url}/rest/v1/outbound_campaigns",
                    headers=self.headers,
                    params={"select": "script", "id": f"eq.{campaign_id}", "limit": "1"},
                )
                if r.status_code != 200 or not r.json():
                    return ""
                return (r.json()[0].get("script") or "").strip()
        except Exception as e:  # noqa: BLE001
            log.warning(f"[campaign] script fetch failed: {e}")
            return ""

    async def get_knowledge(self, voice_profile_id: str) -> list[str]:
        """Everything this business has taught Nikki, newest first."""
        if not voice_profile_id:
            return []
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(
                    f"{self.url}/rest/v1/knowledge_base",
                    headers=self.headers,
                    params={"select": "content", "voice_profile_id": f"eq.{voice_profile_id}",
                            "order": "created_at.desc", "limit": "60"},
                )
                if r.status_code != 200:
                    log.warning(f"[knowledge] fetch {r.status_code}: {r.text[:120]}")
                    return []
                return [row["content"] for row in r.json() if row.get("content")]
        except Exception as e:  # noqa: BLE001
            # Knowledge is an enhancement; a call must never fail for it.
            log.warning(f"[knowledge] fetch failed: {e}")
            return []

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

    def __init__(self, profile: dict, caller_number: str,
                 knowledge: list[str] | None = None):
        self.profile     = profile
        self.caller_num  = caller_number
        # The caller's own number is the best number we will ever have on
        # this call: the network gave it to us, so it cannot be misheard.
        # Asking for it anyway is how call 00ed83a6 spent two of its three
        # minutes — she asked, STT mangled "6303076432" into "30 3076432",
        # she read back a hallucinated "8328199 62", and after five more
        # attempts gave up and transferred to a human. The number was in the
        # call record the entire time.
        # The tenant's language, resolved once. Falls back to te-IN until
        # supabase/041_tenant_language.sql adds the column.
        self.lang        = _tenant_lang(profile)
        self.stt         = SarvamSTT(self.lang)
        self.tts         = SarvamTTS(self.lang)
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
        self.end_call_requested: bool = False
        self.slots       : dict = {"name": None, "phone": None,
                                   "service": None, "when": None}
        # Seed the phone from caller ID. The booking, the WhatsApp and the
        # lead all read this slot, so seeding it means a caller who never
        # mentions a number still gets a complete record — and
        # _known_facts_block then lists it under "never ask for these
        # again", which is what actually stops her asking.
        self.slots["phone"] = _valid_mobile(caller_number)
        self.call_id     : Optional[str] = None
        # Set when a booking is written mid-call; enriched at call end.
        self.appointment_id: Optional[str] = None
        self.intent      : str = "unknown"
        self.turn_timings: list = []      # per-turn stage ms, saved at hangup
        self.expect_dictation: bool = False
        self.transcript  : list[dict] = []
        self.knowledge   : list[str] = list(knowledge or [])
        self.system_prompt = build_system_prompt(profile, self.knowledge)

        # Voice speaker based on profile SKU
        # NOTE: must be real bulbul:v2 speaker IDs — see SKU_VOICE in
        # app/widget.py for the verified source of truth. This dict
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

    def _harvest_slots(self, text: str, from_caller: bool = True) -> None:
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

        # A NAME may only come from the caller. Harvesting it from Nikki's own
        # reply captured her words instead of theirs: when she said
        # "సత్యసన గారు, మీ పేరు నోట్ చేసుకున్నానండి", the pattern matched
        # పేరు followed by "నోట్ చేసుకున్నానండి" and filed *that* as the
        # caller's name — which is what the lead for a real call now reads.
        # The phone is different and the assistant side is genuinely useful
        # there, because the model turns spoken digits into a real number.
        if from_caller and not self.slots.get("name"):
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
                if asked_name and 1 <= len(words) <= 4 and not any(c.isdigit() for c in text):
                    # Drop a leading pronoun or filler. A caller answering
                    # "your name?" says "మీరు Karthikeya" or "నేను కార్తికేయ"
                    # as often as the bare name, and the lead for a real call
                    # was filed as "మీరు Karthikeya" — "you Karthikeya".
                    while words and words[0].lower().strip(".,") in (
                        "మీరు", "నేను", "నా", "అది", "ఇది", "my", "i", "am", "me", "this", "is", "it"):
                        words = words[1:]
                    if 1 <= len(words) <= 3:
                        name = " ".join(words)
            if name:
                name = self._NAME_TAIL.sub("", name).strip(" .,!?")
                # Guard against capturing a refusal or a question back.
                if (2 <= len(name) <= 60
                        and not re.search(r"\?|చెప్పను|తెలియదు", name)
                        and not _is_junk_name(name)):
                    self.slots["name"] = name
                    log.info(f"slot: name={name}")
                elif name:
                    log.info(f"slot: name rejected as junk: {name!r}")

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
        # Caller ID, stated as a fact and as an instruction. A withheld or
        # malformed CLI falls through to asking, which is the old behaviour.
        cli = _valid_mobile(self.caller_num)
        if cli:
            lines.append(
                f"\n\n[THEY ARE CALLING FROM {cli}]"
                "\nThis is their number — the network gave it to us and it cannot"
                " be misheard. NEVER ask them to read out their phone number."
                " When you need it, confirm this one instead: say the last four"
                " digits and ask if WhatsApp should go to this number."
                " Only if they say to use a DIFFERENT number do you ask for one."
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

    async def on_speech(self, audio_bytes: bytes, want_text: bool = False,
                        transcript_override: str | None = None,
                        first_clause_cb=None):
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
            if transcript_override:
                # The per-call streaming socket transcribed WHILE the caller
                # spoke; the batch round-trip is off the critical path
                # entirely. Anything falsy falls through to batch — a
                # streaming outage costs milliseconds, never the turn.
                user_text = transcript_override
            else:
                user_text = await self.stt.transcribe(audio_bytes)
            _t_stt = time.monotonic() - _t0
            if not user_text.strip():
                # MUST respect want_text. Returning audio here made
                # _speech_chunks run a regex over bytes — "cannot use a string
                # pattern on a bytes-like object" — which killed the whole turn
                # and gave the caller SILENCE instead of "say that again".
                # Seen 4 times on live calls, including on a request for a human.
                self._stt_failures = getattr(self, "_stt_failures", 0) + 1
                if self._stt_failures >= 3:
                    # Three deaf turns is an outage, not a mumble. The real
                    # 402 calls show her asking "మళ్ళీ చెప్తారా?" five and six
                    # times at people speaking perfectly clearly — the honest
                    # move is one apology and a promised callback, once.
                    log.error("STT failed 3x this call — apologising instead of looping")
                    msg = ("క్షమించండి అండి, లైన్‌లో టెక్నికల్ సమస్య ఉంది. "
                           "మీ నంబర్ నోట్ అయింది, మా టీమ్ మీకు కాల్ బ్యాక్ చేస్తుంది.")
                    self._stt_failures = -100    # say it once, then stay quiet
                elif self._stt_failures < 0:
                    return "" if want_text else b""
                else:
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
                self.system_prompt + self._known_facts_block(), self.history,
                first_clause_cb=first_clause_cb)
            _t_llm = time.monotonic() - _t0 - _t_stt
            log.info(f"LLM: {response}")
            # The model often normalises spoken digits ("ట్రిపుల్ ఎయిట్...")
            # into a real number in its reply, so harvest that side too.
            self._harvest_slots(response, from_caller=False)

            # Strip before anything records or speaks it: the sentinel must
            # not reach the transcript the owner reads, the history the model
            # sees next turn, or bulbul.
            # Enforce the register BEFORE anything records or speaks it, so
            # the corrected line is what the caller hears, what the owner
            # reads in the transcript, and what the model sees as its own
            # previous turn — which stops it re-using the banned phrasing.
            response, _reg_hits = _enforce_register(response, self.lang)
            if _reg_hits:
                log.warning("register filter rewrote %d banned phrase(s): %s",
                            len(_reg_hits), _reg_hits)

            _prev_bot = next(
                (t["content"] for t in reversed(self.transcript)
                 if t.get("role") == "assistant"), "")
            response, _dropped_q = _drop_repeated_question(response, _prev_bot)
            if _dropped_q:
                log.info("dropped a closing question that repeated the last turn")

            response, wants_end = _split_end_sentinel(response)
            if wants_end:
                # The model does not get to decide this on its own. Ending a
                # call is irreversible and the cost of doing it early — a
                # caller cut off mid-question — is far higher than the cost of
                # a few seconds of extra line time. Honoured only once a
                # booking actually exists in the database.
                if self.appointment_id:
                    self.end_call_requested = True
                    log.info("end-call sentinel accepted — appointment %s is booked",
                             str(self.appointment_id)[:8])
                else:
                    log.info("end-call sentinel IGNORED — no appointment on this call yet")

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
            # tts_ms was missing, which meant the only stage the caller
            # actually waits through — her voice being made and played — was
            # the one nobody measured. Two of these numbers described work
            # the caller never experiences.
            self.turn_timings.append({
                "stt_ms": round(_t_stt * 1000),
                "llm_ms": round(_t_llm * 1000),
                "tts_ms": round(_SarvamTTS_LAST["ms"]),
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
                        self._harvest_slots(response, from_caller=False)
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
        # An IVR menu may route different requests to different numbers —
        # "billing" to one phone, "doctor" to another. Match the caller's
        # last words against the option phrases and re-point the ring group
        # before committing.
        tmap = getattr(self, "ivr_transfer_map", None)
        if tmap:
            last = ""
            for turn in reversed(self.history):
                if turn.get("role") == "user":
                    last = str(turn.get("content", "")).lower()
                    break
            for phrase, digits in tmap.items():
                if phrase and phrase in last:
                    self.ring_group = f"sofia/gateway/jio_primary/{digits}"
                    break
        if not self.ring_group:
            # Never claim a transfer we cannot make.
            return ("క్షమించండి, ఇప్పుడు staff అందుబాటులో లేరు. "
                    "మీ number చెప్తే మా team మీకు callback చేస్తుంది.")
        self.transfer_requested = True
        return "అలాగే, ఒక్క నిమిషం — మా staff కి connect చేస్తున్నాను."

    async def _handle_appointment_booking(self, user_text: str, response: str):
        """Extract appointment details and save + send WhatsApp."""
        # One booking, one row. self.intent is recomputed from keywords on
        # EVERY turn, and this fires whenever it reads 'appointment' — so a
        # caller who says "appointment" three times got three rows. Five of
        # the six appointments in the live database share a single call_id,
        # and _enrich_appointment only ever patches the last one, so the
        # earlier duplicates keep null date, time and service forever and the
        # business sees five blank bookings for one caller.
        if self.appointment_id:
            return
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
                # PENDING, not confirmed. This row is opened the moment
                # booking intent appears — before any date or time exists,
                # because extracting them here would sit on the caller's
                # critical path. Nithin's row (call d3b61bf3) was written
                # "confirmed" with slot_time NULL and stayed that way: the
                # clinic saw a confirmed appointment with no time on it, and
                # no way to tell it apart from a real one. _enrich_appointment
                # promotes it once a date or time is actually known.
                "status":           "pending",
            })

            # 'pending' needs supabase/041_tenant_language.sql, which widens
            # the appointments status check constraint. save_appointment
            # swallows a constraint violation and returns None, so on a box
            # where the code is deployed and the migration is not, every
            # booking would vanish silently — the worst possible failure for
            # the one thing this product exists to do. Fall back to the old
            # value and say so loudly.
            if not appt_id:
                log.critical(
                    "appointment insert rejected with status='pending' — "
                    "apply supabase/041_tenant_language.sql. Falling back to "
                    "'confirmed' so the booking is not lost.")
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
            # HOLD the confirmation when the slot is still unknown. This
            # runs mid-call, before _enrich_appointment has read the
            # transcript, so self.slots is usually empty — and the message
            # went out reading "Date: soon, Time: TBD", which is worse than
            # no message: the caller was told in Telugu that a confirmation
            # was coming and then received one that confirmed nothing.
            # _enrich_appointment sends it once the date is actually known.
            if not (self.slots.get("date") or self.slots.get("time")):
                log.info("[FS] confirmation held — slot not captured yet, will send after enrichment")
                return

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

# ── /outbound is GONE ────────────────────────────────────────────────────
# It was the Exotel-era dispatch endpoint and could never have served a
# request: it called ob.config_status(), ob.place_outbound_call(),
# ob.mark_recipient_dispatched() and ob.mark_recipient_failed(), but `ob`
# (app/exotel/outbound.py) was deleted with the rest of the Exotel bridge
# and was never imported here. Every call raised NameError -> 500.
#
# Nothing called it. Outbound origination moved to the API server, which
# goes straight to FreeSWITCH over ESL: jobs/outbound-dispatcher.ts
# dispatchCall() -> fsl.originateOutbound() (esl.ts), landing on the
# camp_ / onb_ extensions in infra/freeswitch/conf/dialplan/heynikki.xml.
# Its docstring claiming outbound-dispatcher.ts "has always called" this
# endpoint stopped being true when that move happened.


class RecordingPurgeRequest(BaseModel):
    keys: list


@app.post("/api/v1/recording/purge")
async def purge_recordings(req: RecordingPurgeRequest,
                           x_internal_secret: str = Header(default="")):
    """Delete recordings from R2. Lives here for the same reason presign
    does: boto3 and the R2 credentials are already in this container.

    Internal-only and bounded — the retention job sends at most a couple
    hundred keys per run, and a wildcard or empty key is refused outright:
    a purge endpoint that can be talked into deleting everything is a
    disaster with an API."""
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")
    keys = [str(k) for k in (req.keys or []) if isinstance(k, str)
            and 8 < len(k) < 300 and "*" not in k and ".." not in k]
    if not keys or len(keys) > 500:
        raise HTTPException(status_code=400, detail="1-500 concrete keys required")
    cf_account_id = os.environ.get("CF_ACCOUNT_ID", "")
    r2_access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    r2_secret     = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    r2_bucket     = os.environ.get("R2_BUCKET", "heynikki-recordings")
    if not all([cf_account_id, r2_access_key, r2_secret]):
        raise HTTPException(status_code=503, detail="R2 not configured")
    import boto3
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{cf_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=r2_access_key,
        aws_secret_access_key=r2_secret,
        region_name="auto",
    )
    resp = await asyncio.to_thread(
        s3.delete_objects,
        Bucket=r2_bucket,
        Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True},
    )
    errors = resp.get("Errors", [])
    log.info(f"[purge] deleted {len(keys) - len(errors)}/{len(keys)} recordings")
    return {"deleted": len(keys) - len(errors),
            "errors": [e.get("Key") for e in errors][:10]}


@app.get("/health")
async def health():
    from app import circuit_breaker as _cb
    # Per-stage latency percentiles over the last 500 turns. The industry
    # gap between claimed and production latency is 2-4x; this is the number
    # that says which it is today. Targets: <800ms p50, <1400ms p95 total.
    def _pct(vals, q):
        return sorted(vals)[int(len(vals) * q)] if vals else None
    stt = [t[0] for t in _TURN_STATS]
    llm = [t[1] for t in _TURN_STATS]
    sarvam_out = _SARVAM_402_AT and (time.time() - _SARVAM_402_AT) < 1800
    return {
        "status": "degraded" if sarvam_out else "ok",
        # Half an hour of memory: a top-up clears it by simply working.
        "sarvam_credits_exhausted": bool(sarvam_out),
        # Which vendor last spoke a fresh line. Anything but "sarvam" means we
        # are running on a fallback and someone should know.
        "tts_vendor": _TTS_VENDOR,
        "tts_fallbacks_configured": [
            n for n, ok in (("azure",  bool(os.environ.get("AZURE_SPEECH_KEY"))),
                            ("google", bool(os.environ.get("GOOGLE_TTS_KEY")
                                            or os.environ.get("GOOGLE_STT_KEY"))))
            if ok
        ],
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

# The [IF THEY ASK YOU TO HOLD] sentinel. A caller who says "ఒక్క నిమిషం"
# wants the line to go quiet, and answering that with chatter is the one
# response they explicitly did not ask for. The model is told to emit the
# bare token; both the phone path and the website path swallow it here
# rather than synthesising the literal word "SILENT" at the caller.
# Tolerant of the punctuation and stray casing models wrap sentinels in.
_SILENT_RE = re.compile(r"^\W*silent\W*$", re.I)


def _is_hold_sentinel(text: str) -> bool:
    return bool(text) and bool(_SILENT_RE.match(text.strip()))


# The end-of-call sentinel. A caller whose appointment is booked and who has
# nothing else to ask should not be left holding an open line waiting for one
# side to give up — that dead air is the last thing they remember of the call.
#
# Written as a token the model appends AFTER its closing line, so the closing
# line is still spoken normally. Tolerant of the punctuation and casing models
# wrap markers in, and of the model helpfully translating the brackets away.
# END_CALL, END CALL, END-CALL, [END_CALL], <end call>. Models are
# inconsistent about the separator and about wrapping markers in brackets,
# and every variant we fail to match gets pronounced at the caller in
# English right after their appointment is booked.
_END_CALL_RE = re.compile(
    r"[\s\[\]<>(){}*_.,!?-]*END[\s_-]?CALL[\s\[\]<>(){}*_.,!?-]*$", re.I)


# ── Register enforcement ──────────────────────────────────────────────────
# The persona has banned స్వాగతం and "మీకు ఎలా సహాయం చేయగలను" since before this
# file was rewritten. On call 00ed83a6 the greeting was:
#
#   "Bismillah Clinic కి స్వాగతం. చెప్పండి, మీకు ఎలా సహాయం చేయగలను?"
#
# Both banned phrases, in one sentence, from a prompt that forbids each of
# them explicitly and repeatedly. A prompt rule is a tendency; this is the
# guarantee. Rewriting is deterministic and costs nothing — regenerating
# would put a second LLM round trip on the caller's critical path, which is
# a worse trade than a substitution we control.
#
# TELUGU ONLY. These are Telugu strings; running them over a Bengali or
# Hindi reply would corrupt it.
_REGISTER_FIXES: list[tuple[re.Pattern, str]] = [
    # "<business> కి స్వాగతం" is the whole banned greeting shape. Keep the
    # business name, drop the banner language: "X అండి" is what a real
    # receptionist says.
    (re.compile(r"\s*కి\s*స్వాగతం"), " అండి"),
    (re.compile(r"\s*కు\s*స్వాగతం"), " అండి"),
    (re.compile(r"స్వాగతం"), ""),
    # The call-centre line, in the shapes it actually appears in.
    (re.compile(r"మీకు\s*ఎలా\s*(సహాయం|హెల్ప్)\s*చే\S*\s*\??"), "చెప్పండి"),
    (re.compile(r"నేను\s*మీకు\s*ఎలా\s*\S*\s*చే\S*\s*\??"), "చెప్పండి"),
    # Written/official register the register pack bans outright.
    (re.compile(r"ధన్యవాదములు"), "థాంక్యూ"),
    (re.compile(r"నియామకం"), "అపాయింట్‌మెంట్"),
    (re.compile(r"వైద్యుడు"), "డాక్టర్ గారు"),
    (re.compile(r"వీడ్కోలు"), ""),
    (re.compile(r"తెలియజేయండి"), "చెప్పండి"),
    (re.compile(r"తెలియజేయగలరు"), "చెప్పగలరు"),
    (re.compile(r"దయచేసి\s*వేచి\s*(ఉండండి|యుండగలరు)"), "ఒక్క నిమిషం ఉండండి"),
    (re.compile(r"సందర్శించండి"), "రండి"),
]


def _enforce_register(text: str, lang: str = LANG_DEFAULT) -> tuple[str, list[str]]:
    """Rewrite banned phrases. Returns (text, what was replaced)."""
    if not text or lang != "te-IN":
        return text, []
    hits: list[str] = []
    out = text
    for pat, repl in _REGISTER_FIXES:
        new = pat.sub(repl, out)
        if new != out:
            hits.append(pat.pattern)
            out = new
    if hits:
        # Tidy the seams a substitution leaves. These are not cosmetic: a
        # replacement lands next to text that already said the same thing.
        #   "చెప్పండి, మీకు ఎలా సహాయం చేయగలను?"  ->  "చెప్పండి, చెప్పండి"
        #   "వైద్యుడు గారు"                      ->  "డాక్టర్ గారు గారు"
        # Collapsing an immediately repeated word fixes both, and bulbul
        # would otherwise say each of them twice.
        out = re.sub(r"(\S+)[,\s]+\1(?=[\s,.।!?]|$)", r"\1", out)
        out = re.sub(r"\s{2,}", " ", out)
        out = re.sub(r"\s+([।.,!?])", r"\1", out)
        out = re.sub(r"^[\s,.।]+", "", out).strip()
    return out, hits


# Asking the same closing question after every single answer is what makes a
# voice agent read as a machine. On call 39e7055b she ended seven consecutive
# turns with a variant of "shall I fix the appointment?" — appended to the
# clinic address, to the services list, to the lab-price answer. The caller
# had already said no twice.
#
# The prompt asks her not to. This makes it so, the same way _enforce_register
# does: strip a trailing question that repeats the previous turn's trailing
# question, and keep the part that actually answered them. She still asks it
# once; she just stops asking it every time.
_QUESTION_END = re.compile(r"[?？]\s*$")
# Particles and politeness carry no topic, so they must not make two different
# questions look alike.
_Q_STOPWORDS = {
    "అండి", "గారు", "మీకు", "మీరు", "నేను", "ఒక", "ఏమైనా", "ఏదైనా", "ఇంకా",
    "సరే", "అలాగే", "కదా", "నా", "ఆ", "ఈ", "కి", "కు", "లో", "తో",
    "shall", "would", "you", "your", "the", "a", "an", "do", "i", "we", "is",
}


def _question_topic(q: str) -> frozenset:
    """The content words of a question, as a comparable set."""
    words = re.findall(r"[\w\u0C00-\u0C7F\u0900-\u097F\u0980-\u09FF]+", (q or "").lower())
    return frozenset(w for w in words if len(w) >= 3 and w not in _Q_STOPWORDS)


def _split_trailing_question(text: str) -> tuple[str, str]:
    """Split a reply into (everything before the final question, that question)."""
    t = (text or "").strip()
    if not _QUESTION_END.search(t):
        return t, ""
    # Sentence boundaries in the scripts we speak, plus the Latin full stop.
    parts = re.split(r"(?<=[.।!?])\s+", t)
    if len(parts) < 2:
        return t, ""
    return " ".join(parts[:-1]).strip(), parts[-1].strip()


def _drop_repeated_question(text: str, prev_assistant: str) -> tuple[str, bool]:
    """Remove a closing question that just repeats the previous turn's.

    Only when something else was actually said this turn — a reply that is
    nothing but the question still needs to ask it, or she says nothing at
    all. Returns (text, dropped).
    """
    body, question = _split_trailing_question(text)
    if not question or len(body) < 15:
        return text, False
    _, prev_question = _split_trailing_question(prev_assistant or "")
    if not prev_question:
        return text, False
    now, before = _question_topic(question), _question_topic(prev_question)
    if not now or not before:
        return text, False
    if len(now & before) / len(now | before) >= 0.5:
        return body, True
    # Jaccard alone misses the exact shape that went wrong, because she varies
    # the verb and the time words while asking the identical thing:
    #   "రేపు పొద్దున తొమ్మిది గంటలకి అపాయింట్‌మెంట్ పెట్టమంటారా?"
    #   "అపాయింట్‌మెంట్ ఫిక్స్ చేయమంటారా?"
    # Same subject, same "shall I …?" form, two shared words out of eight. So
    # also treat it as a repeat when the two questions share a content noun
    # AND are both the -ంటారా "shall I" offer. Deliberately narrow: a
    # wh-question ("ఏ రోజుకి …?") or a different request ("మీ పేరు చెప్తారా?")
    # does not end that way, so asking for the date or the name still gets
    # through even though it also mentions the appointment.
    shared_nouns = {w for w in (now & before) if len(w) >= 6}
    both_offers  = question.rstrip("?？ ").endswith("ంటారా") and \
                   prev_question.rstrip("?？ ").endswith("ంటారా")
    if shared_nouns and both_offers:
        return body, True
    return text, False


def _split_end_sentinel(text: str) -> tuple[str, bool]:
    """Return (speakable text, caller-should-be-hung-up).

    The sentinel is REMOVED, never spoken. bulbul would happily pronounce
    "END CALL" in English at someone who just booked an appointment.
    """
    if not text:
        return text, False
    stripped = _END_CALL_RE.sub("", text)
    return (stripped.strip(), True) if stripped != text else (text, False)


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
    response_text = await llm.generate(
        system_prompt, history,
        temperature=0.0 if (req.persona or "") == "product" else None)

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

    # A visitor on the website can ask her to hold exactly like a caller can,
    # and the sentinel must not be read out as the literal word "SILENT".
    if _is_hold_sentinel(response_text):
        # `hold` is explicit rather than implied by an empty response: the API
        # server substitutes a stand-in line for an empty reply, which would
        # turn "stay quiet" back into chatter.
        return {"response": "", "spoken_text": "", "hold": True,
                "audio_b64": None, "booking_confirmed": False,
                "booking_summary": "", "intent": agent.intent,
                "turn": len(agent.history) // 2}

    # Belt-and-braces cleanup before this reaches a text-to-speech engine.
    # The prompt forbids emoji and markdown, but models drift, and every
    # stray asterisk or bullet gets pronounced out loud as literal noise —
    # which is precisely the "reading a document" sound we're removing.
    response_text = _clean_for_speech(response_text)

    # The spoken form of the reply, always computed — never only when this
    # endpoint synthesises. The website's real audio is made by the API
    # server, which calls this with tts:false and then sends `response`
    # straight to bulbul; returning `spoken_text` is what lets that path
    # speak the same normalised Telugu the phone line speaks, without a
    # second Telugu number-words implementation in TypeScript drifting
    # against this one.
    #
    # This path used to hand raw model output to TTS while the phone path ran
    # it through normalize_for_tts first, so the website said "10:30", read a
    # ten-digit mobile as one long number, and pronounced the business name
    # however the model happened to spell it — the three defects the phone
    # path had already fixed.
    #
    # `response` stays the READABLE form: it is rendered as a chat bubble on
    # the page, and digit-by-digit phone numbers are right for the ear and
    # wrong for the eye.
    spoken_text = normalize_for_tts(
        response_text, (profile or {}).get("pronunciation_map"),
        _tenant_lang(profile))

    # Optional TTS via Sarvam (for richer voice experience)
    audio_b64 = None
    if req.tts:
        try:
            tts = SarvamTTS()
            # 22050, not the telephony default: this plays through a laptop or a
            # handset speaker, not down a narrowband trunk. At 8k it is thin and
            # metallic — it reads as eerie rather than as a person.
            audio_bytes = await tts.synthesize(spoken_text, agent.voice, 22050)
            import base64 as _b64
            audio_b64 = _b64.b64encode(audio_bytes).decode() if audio_bytes else None
        except Exception as e:
            log.warning(f"[widget] TTS failed (will use browser TTS): {e}")

    return {
        "response": response_text,
        "spoken_text": spoken_text,
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
            "source":        "widget",
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
                            "source":            "widget",
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
                    "pace": 1.0,
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
            "model": resolve_gemini_model(),
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


# ─── Website voice widget ─────────────────────────────────
# NOTE: the `WebSocket as _WebSocket` import that used to sit in this block
# moved to the fastapi import at the top of the file — freeswitch_ws below
# annotates its socket with it, so deleting it here would have failed at
# import time and taken down every phone call, not just the widget.
#
# /ws/widget is GONE, along with handle_widget_ws. It could never have
# served a request: the handler referenced twelve names that do not exist
# in app/widget.py (Session, SYSTEM_PROMPT, DEFAULT_VOICE, _handle_utterance,
# GEMINI_KEY, SARVAM_KEY, cb, io, wave, PIPE_SR, MAX_HISTORY_TURNS,
# WebSocketDisconnect) — leftovers from app/exotel/bridge.py, which the
# widget was lifted out of without its dependencies. Any browser reaching
# it got a NameError on the first audio frame.
#
# Nothing referenced it: no route in web/ or super-admin/ connects to
# /ws/widget. The website's live voice path is the API server's
# /api/public/voice-turn, which calls /api/v1/browser/chat below.


# ════════════════════════════════════════════════════════════════
# FREESWITCH mod_audio_stream — WebSocket handler
# The only telephony path there is.
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
# The missed-call message the dialplan plays when a human transfer rings
# out or, as now, cannot even be attempted. It used to be spoken by flite —
# a robotic English voice — to callers on Telugu-configured lines, straight
# after five minutes of natural Sarvam speech. These are rendered in the
# tenant's own language in Nikki's voice and handed to FreeSWITCH as a file.
_FALLBACK_DEFAULT_EN = ("Thank you for calling. All our representatives are "
                        "busy. We will call you back shortly.")
_FALLBACK_BY_LANG = {
    "te-IN": "క్షమించండి, ప్రస్తుతం మా staff అందుబాటులో లేరు. "
             "మేము త్వరలో మీకు తిరిగి call చేస్తాము. ధన్యవాదాలు.",
    "hi-IN": "क्षमा करें, अभी हमारा स्टाफ़ उपलब्ध नहीं है। "
             "हम आपको जल्द ही वापस कॉल करेंगे। धन्यवाद।",
    "bn-IN": "দুঃখিত, এই মুহূর্তে আমাদের স্টাফ পাওয়া যাচ্ছে না। "
             "আমরা শীঘ্রই আপনাকে ফিরে কল করব। ধন্যবাদ।",
    "en-IN": _FALLBACK_DEFAULT_EN,
}


async def _prepare_missed_call_audio(agent, fs_uuid: str, profile: dict) -> None:
    """Render the missed-call message and point the dialplan at it.

    Fire and forget, at call start rather than at transfer time: by the time
    a transfer rings out the websocket is already gone, so nothing in the
    pipeline is left to speak. Setting the channel variable here means the
    file is ready long before it can be needed, and the dialplan falls back
    to its old flite line whenever the variable is empty.
    """
    if not fs_uuid:
        return
    try:
        lang   = (profile.get("language") or "te-IN").strip()
        custom = (profile.get("fallback_message") or "").strip()
        # Respect a message the business actually wrote; ignore the English
        # placeholder every profile ships with.
        text = custom if custom and custom != _FALLBACK_DEFAULT_EN else \
            _FALLBACK_BY_LANG.get(lang, _FALLBACK_BY_LANG["te-IN"])
        audio = await agent.tts.synthesize(text, agent.voice)
        if not audio:
            return
        os.makedirs(_TTS_SPOOL, exist_ok=True)
        path = os.path.join(_TTS_SPOOL, f"fallback_{fs_uuid}.wav")
        with open(path, "wb") as f:
            f.write(audio)
            f.flush()
            os.fsync(f.fileno())
        await _esl_api(f"uuid_setvar {fs_uuid} nikki_fallback_audio {path}")
        log.info(f"[FS] {fs_uuid}: missed-call audio ready ({lang})")
    except Exception as e:  # noqa: BLE001 - cosmetic; flite still covers us
        log.warning(f"[FS] {fs_uuid}: missed-call audio not prepared: {e}")


# Words a caller says AT the question rather than in answer to it. Without
# this, "మీ పేరు చెప్పండి?" -> "cut" booked an appointment for "కట్ గారు"
# (Mr. Cut) on the 12:52 call, and an earlier call filed "ఏం పేరు Madam" —
# the caller repeating the question back — as somebody's name.
_JUNK_NAME_WORDS = {
    # English fillers, commands and STT artefacts
    "cut", "stop", "wait", "hold", "hello", "hi", "hey", "yes", "no", "ok",
    "okay", "hmm", "hm", "what", "sorry", "please", "thanks", "thank", "call",
    "phone", "number", "sir", "madam", "mam", "doctor", "dr", "appointment",
    "test", "time", "today", "tomorrow", "name", "my name", "your name",
    "clinic", "hospital", "book", "booking", "cancel", "help", "again",
    # Telugu equivalents
    "పేరు", "ఏం పేరు", "హలో", "ఆగండి", "ఆపండి", "సరే", "సరేనండి", "అవును",
    "కాదు", "లేదు", "డాక్టర్", "అపాయింట్‌మెంట్", "ఏమిటి", "ఏంటి", "చెప్పండి",
    "నాకు", "మీరు", "నేను", "ఇది", "అది", "ఏమి", "ఎవరు",
}


def _is_junk_name(name: str) -> bool:
    """Is this a caller answering the question, or repeating it back?

    A name has to survive three checks: it cannot BE a stop-word, it cannot
    CONTAIN the word "name" in either language (that is the question echoed
    back), and it cannot be a single very short token, which in practice is
    always an STT fragment rather than a person.
    """
    low = " ".join(str(name or "").lower().split())
    if not low:
        return True
    if low in _JUNK_NAME_WORDS:
        return True
    if re.search(r"పేరు|\bname\b", low):
        return True
    tokens = low.split()
    if all(t.strip(".,!?") in _JUNK_NAME_WORDS for t in tokens):
        return True
    # "cut", "ok", "aa" — a lone ASCII token this short is never a real name
    # given Sarvam returns Telugu names in Telugu script.
    if len(tokens) == 1 and low.isascii() and len(low) <= 4:
        return True
    return False


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


# The openers she reaches for on almost every turn. Synthesising one costs
# ~840ms; serving it from cache costs nothing measurable. The cache lives on
# tmpfs and dies with the container, so the first caller after every deploy
# used to pay full price for "సరేనండి" — warm them once at boot instead.
_WARM_OPENERS = [
    "సరేనండి.", "అవునండి.", "అర్థమైంది అండి.", "చెప్పండి.",
    "అయ్యో, క్షమించండి అండి.", "ఒక్క నిమిషం అండి.", "అలాగే అండి.",
    "ఖచ్చితంగా అండి.", "ఒక్కసారి మళ్ళీ చెప్తారా?",
]


async def _warm_tts_cache() -> None:
    """Pre-synthesise the openers, in the background, after boot."""
    try:
        tts = SarvamTTS()
        done = 0
        for text in _WARM_OPENERS:
            for speaker in ("priya", "shreya", "pooja"):
                try:
                    if await tts.synthesize(text, speaker, 8000):
                        done += 1
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(0.05)   # never crowd a live call
        log.info(f"[tts] warmed {done} opener clips")
    except Exception as e:  # noqa: BLE001
        log.warning(f"[tts] cache warm failed: {e}")

# ── B8: listener backchannels ───────────────────────────────────────
# Indian phone pragmatics backchannel every 5-10 seconds; a silent listener
# gets "హలో? హలో?" line-checks because silence reads as a dropped call, not
# politeness. Clips are synthesised once per voice into the shared spool
# (FreeSWITCH reads the file path, same constraint as the fillers) and
# played at most once every 7 seconds while the CALLER is mid-monologue.
_BC_TEXTS = ["హా", "ఊ", "అర్థమైంది", "సరే"]
_BC_DIR = pathlib.Path(_TTS_SPOOL) / "backchannels"


async def _backchannel_clip(tts, voice: str) -> str:
    """Path to one ready backchannel clip for this voice, or ''. Lazy: the
    first call on a voice pays one small TTS round; every later call is a
    file that already exists."""
    try:
        _BC_DIR.mkdir(parents=True, exist_ok=True)
        import random  # noqa: PLC0415 — seeded by os.urandom below, not time
        idx = int.from_bytes(os.urandom(1), "big") % len(_BC_TEXTS)
        path = _BC_DIR / f"bc_{voice}_{idx}.wav"
        if not path.exists() or path.stat().st_size < 500:
            audio = await tts.synthesize(_BC_TEXTS[idx], voice)
            if not audio:
                return ""
            path.write_bytes(audio)
        return str(path)
    except Exception as e:  # noqa: BLE001
        log.debug(f"[bc] clip failed: {e}")
        return ""



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
    returning = bool((history or {}).get("previous_calls"))
    lang = _tenant_lang(profile)

    # The greeting is SPOKEN VERBATIM — it never goes through the model — so
    # it has to exist in the tenant's own language. Sending Telugu to a
    # Bengali bulbul voice produces the accented mumble that reads as "the
    # line is broken" in the first three seconds, which is the whole first
    # impression. A tenant with greeting_script set never reaches here.
    if lang == "hi-IN":
        return (f"नमस्ते, {biz} से बोल रहे हैं — दोबारा कॉल करने के लिए धन्यवाद! बताइए।"
                if returning else f"नमस्ते, {biz} से बोल रहे हैं। मैं {name}। बताइए!")
    if lang == "bn-IN":
        return (f"নমস্কার, {biz} থেকে বলছি — আবার ফোন করার জন্য ধন্যবাদ! বলুন।"
                if returning else f"নমস্কার, {biz} থেকে বলছি। আমি {name}। বলুন!")
    if lang == "en-IN":
        return (f"Hello, {biz} here — thanks for calling us again! Tell me."
                if returning else f"Hello, {biz} here. This is {name}. Tell me!")

    if returning:
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
    text = normalize_for_tts(_greeting_text(agent.profile, agent.caller_history),
                             (agent.profile or {}).get("pronunciation_map"))
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
    # Group 3 is the AM/PM marker, and it has to be READ, not just matched.
    # It used to be a non-capturing group, so "4:30 PM" reached this line as
    # h=4 and fell through every daytime band to రాత్రి — and "9:00 PM"
    # became పొద్దున, telling a caller "morning" for nine at night.
    mer = (m.group(3) or "").upper()
    if mer == "P" and h != 12:
        h += 12
    elif mer == "A" and h == 12:
        h = 0
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
    if n in special: return special[n]
    if n % 1000 == 0 and n < 100000:
        return f"{_TE_HOUR.get(n // 1000, str(n // 1000))} వేల రూపాయలు"
    if n % 500 == 0 and 1000 < n < 10000:
        # 4500 -> నాలుగున్నర వేలు: the half-thousand form real speech uses.
        return f"{_TE_HALF[n // 1000]} వేల రూపాయలు"
    return f"{n} రూపాయలు"   # bulbul handles plain smaller numbers acceptably

def normalize_for_tts(text: str, pmap: dict | None = None,
                      lang: str = LANG_DEFAULT) -> str:
    t = _clean_for_speech(text)                       # markdown, emoji, vendor names
    # Everything past the pronunciation map writes TELUGU words — పదిన్నర,
    # మూడొందలు, సున్నా. Splicing those into a Bengali or Hindi reply produces a
    # sentence no speaker of either language can parse, and bulbul would try
    # to pronounce Telugu script with a Bengali voice. Markdown stripping and
    # the tenant's own pronunciation map are language-neutral and stay.
    if lang != "te-IN":
        if pmap:
            for k in sorted(pmap, key=len, reverse=True):
                v = pmap.get(k)
                if k and isinstance(v, str) and v:
                    t = t.replace(k, v)
        # Long digit runs still need separators whatever the language.
        return re.sub(r"\b\d{5,}\b", lambda m: f"{int(m.group()):,}", t)
    # The tenant's own words first — their business name, their doctors,
    # their products, spelled the way bulbul actually says them right. This
    # fixes both failure modes at once: the LLM re-spelling a name it was
    # told never to touch (రామ్య came out రామ్మా on an eval), and the TTS
    # mispronouncing a correct spelling. Longest keys first, so a longer
    # phrase wins over a word it contains.
    if pmap:
        for k in sorted(pmap, key=len, reverse=True):
            v = pmap.get(k)
            if k and isinstance(v, str) and v:
                t = t.replace(k, v)
    t = re.sub(r"\b[6-9]\d{9}\b", _spoken_phone, t)   # mobile numbers first (longest)
    t = re.sub(r"\b(\d{1,2}):(\d{2})(?:\s*([APap])\.?[Mm]\.?)?\b", _spoken_time, t)
    t = re.sub(r"(?:Rs\.?|₹)\s*([\d,]+)", _spoken_rupees, t)
    # Commas into any surviving long number so bulbul does not choke
    # (its docs: >4 digits without separators may fail). This used to require
    # seven digits to match, which let every five- and six-digit number — the
    # common case for a price — through untouched.
    t = re.sub(r"\b\d{5,}\b", lambda m: f"{int(m.group()):,}", t)
    # Collapse a case marker doubled by substitution ("పదిన్నర కి కి").
    t = re.sub(r"(కి|కు|లో)\s+\1\b", r"\1", t)
    return t


async def _speak_chunked(agent, ws, fs_uuid: str, text: str,
                         seq: int, speaking: dict, sub_offset: int = 0) -> None:
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
    chunks = _speech_chunks(normalize_for_tts(
        text, (getattr(agent, "profile", None) or {}).get("pronunciation_map"),
        getattr(agent, "lang", LANG_DEFAULT)))
    if not chunks:
        return
    audio = await agent.tts.synthesize(chunks[0], agent.voice)
    sub = sub_offset
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
            # Missed-call clips are written once at call start and read only
            # if a transfer rings out, so they must outlive the call itself —
            # the 15-minute cutoff above would delete them out from under a
            # long conversation and leave the caller in silence.
            # Safety net for the both-sides recordings. _mixed_recording_bytes
            # deletes each one as soon as R2 has it; this only catches a call
            # whose cleanup died mid-way, and never a live call — 2 hours is
            # far longer than any conversation.
            for f in spool.glob("call_*.wav"):
                try:
                    if f.stat().st_mtime < time.time() - 7200:
                        f.unlink(); removed += 1
                except OSError:
                    pass
            fb_cutoff = time.time() - 7200      # 2 hours
            for f in spool.glob("fallback_*.wav"):
                try:
                    if f.stat().st_mtime < fb_cutoff:
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
    # Same helper build_system_prompt uses. These two disagreeing by a day is
    # exactly the bug above; one definition means they cannot drift again.
    today = _now_ist().strftime("%Y-%m-%d")

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
        model = resolve_gemini_model()
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

        # A slot is what makes it a real appointment. Without one it stays
        # pending — visible to the business as something to chase, rather
        # than sitting in the diary looking settled.
        if patch.get("slot_date") and patch.get("slot_time"):
            patch["status"] = "confirmed"

        async with httpx.AsyncClient(timeout=8.0) as c:
            await c.patch(f"{agent.db.url}/rest/v1/appointments",
                          headers=agent.db.headers,
                          params={"id": f"eq.{appt_id}"},
                          json=patch)
        log.info(f"[FS] {fs_uuid}: appointment enriched {patch}")

        # NOW the confirmation can say something true. The mid-call send is
        # held when the slot is unknown, which is almost always — the caller
        # is still mid-sentence when the row is written. Here the date and
        # time have been read out of the whole transcript, so the message
        # the customer receives actually confirms their appointment instead
        # of reading "Date: soon, Time: TBD".
        if patch.get("slot_date") or patch.get("slot_time"):
            sent = False
            try:
                async with httpx.AsyncClient(timeout=8.0) as c:
                    r = await c.post(
                        f"{API_SERVER_URL}/api/whatsapp/appointment-confirm",
                        headers={"X-Internal-Secret": INTERNAL_SECRET},
                        json={
                            "caller_number":    agent.caller_num,
                            "business_name":    agent.profile.get("business_name") or "",
                            "slot_date":        patch.get("slot_date"),
                            "slot_time":        patch.get("slot_time"),
                            "service":          patch.get("service"),
                            "tenant_id":        agent.profile["tenant_id"],
                            "voice_profile_id": agent.profile["id"],
                            "call_id":          agent.call_id,
                            "appointment_id":   appt_id,
                        })
                    log.info(f"[FS] {fs_uuid}: confirmation sent after enrichment ({r.status_code})")
                    sent = r.status_code == 200
            except Exception as e:  # noqa: BLE001
                log.warning(f"[FS] {fs_uuid}: post-enrichment confirmation failed: {e}")

            # Mark the CALL as having produced a booking. Only the early path
            # in _book_appointment did this, and it returns before reaching
            # that line whenever the slot is not known yet — which is the
            # normal case, because the caller usually names a time after the
            # booking row is opened. So a booking made this way was invisible
            # to every count that reads calls.appointment_created:
            # /api/admin analytics, the owner dashboard, month_appointments.
            # The 20:56 call had a confirmed appointment row and a delivered
            # WhatsApp while the call still read appointment_created = false.
            try:
                await agent.db.update_call(agent.call_id, {
                    "appointment_created": True,
                    "wa_sent": sent,
                })
            except Exception as e:  # noqa: BLE001
                log.warning(f"[FS] {fs_uuid}: could not flag call as booked: {e}")
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
        # A real call scored 85 — a hot lead — and was filed as "lost", which
        # would have buried it under a follow-up list ordered by stage. The
        # model judges tone and score separately and they can disagree; when
        # they do, the score is the sturdier signal, so refuse the
        # contradiction rather than storing it.
        if stage == "lost" and score >= 60:
            log.info(f"[lead] model said lost at score {score} — keeping it contacted")
            stage = "contacted"
        elif stage == "won" and score <= 30:
            stage = "contacted"

        # The leads page renders a friendly label per intent, and the model was
        # free to invent the key — it wrote "service_inquiry" where the UI knows
        # "service_enquiry", so the card showed raw snake_case to the customer.
        # Coerce to the set the UI can actually name.
        _VALID_INTENTS = ("book_appointment", "reschedule", "cancel",
                          "pricing_enquiry", "service_enquiry", "location_hours",
                          "complaint", "follow_up", "other")
        _INTENT_ALIASES = {
            "service_inquiry": "service_enquiry", "price_enquiry": "pricing_enquiry",
            "price_inquiry": "pricing_enquiry", "pricing_inquiry": "pricing_enquiry",
            "appointment": "book_appointment", "booking": "book_appointment",
            "hours": "location_hours", "location": "location_hours",
            "abuse_hangup": "other", "wrong_number": "other",
        }
        _raw_intent = str(d.get("intent") or "other").strip().lower()
        intent = _INTENT_ALIASES.get(_raw_intent, _raw_intent)
        if intent not in _VALID_INTENTS:
            intent = "other"

        digits = "".join(c for c in (caller_number or "") if c.isdigit())[-10:]
        prof   = agent.profile or {}
        row = {
            "tenant_id": prof.get("tenant_id"),
            "phone":     digits,
            "name":      (agent.slots or {}).get("name"),
            "intent":    intent,
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
                # Read the count before incrementing it — PostgREST has no
                # atomic increment, and a lead that has been called ten times
                # showing "1 call" is why the repeat-caller badge never
                # appeared for anyone.
                existing_count = 1
                try:
                    cur = await c.get(
                        f"{agent.db.url}/rest/v1/leads"
                        f"?tenant_id=eq.{row['tenant_id']}&phone=eq.{digits}&select=call_count",
                        headers=agent.db.headers)
                    if cur.status_code == 200 and cur.json():
                        existing_count = cur.json()[0].get("call_count") or 1
                except Exception:  # noqa: BLE001
                    pass
                # first_call_id is deliberately excluded: it records the FIRST
                # call and must not drift forward. Nones are dropped too, so a
                # call that failed to capture a name does not blank the name
                # captured last time.
                # stage and notes are the CUSTOMER'S columns. A business
                # that dragged a lead to "won" and typed a note about the
                # deal had both overwritten by the model on the next call —
                # the stage reverting to whatever it inferred, the note
                # replaced by an AI summary. The RPC in 011 deliberately
                # protects human-edited fields; this path bypassed it.
                # score and intent are ours to update, stage and notes are
                # not, and last_call_id/call_count/last_contacted_at were
                # never written at all, so "3 calls" badges never appeared
                # and the most active leads sank to the bottom of a list
                # ordered by last contact.
                patch = {k: v for k, v in row.items()
                         if k not in ("tenant_id", "phone", "first_call_id",
                                      "stage", "notes")
                         and v is not None}
                patch["last_contacted_at"] = datetime.now(timezone.utc).isoformat()
                patch["call_count"] = int(existing_count or 1) + 1
                if agent.call_id:
                    patch["last_call_id"] = agent.call_id
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


# ── UTTERANCE COMPLETENESS ──────────────────────────────────────────
# The first real calls made the failure exact: a caller pausing mid-thought
# trips the 400ms window, and she answers every fragment. He said "1" — she
# replied. "2" — "మీరు రెండు అన్నారు". He was LISTING things, and she
# interrupted after each item until he said, verbatim, "ఈ మధ్యలో మాట్లాడి
# సంపేస్తాంది" — she keeps talking in the middle.
#
# With streaming STT the transcript is already in hand when the window
# closes, so completeness is judgeable BEFORE committing to a reply. This is
# intentionally crude — a held fragment is flushed on a short timeout either
# way, so the worst case of a wrong "incomplete" is ~1.6s of extra
# listening, while the cost of a wrong "complete" is her interrupting again.
_CONTINUE_TAIL = re.compile(
    # ంటే as a SUFFIX, not the word అంటే: in ఏంటంటే / చెప్పేదంటే the "a" is
    # inherent in the consonant, so the literal అంటే never appears — the
    # first live test proved it by answering a caller mid-"which is...".
    r"(మధ్యలో|ఇంకా|మరి|కానీ|అలాగే|కూడా|మరియు|and|but|also|so|then|plus|ంటే)[\s.]*$"
    # Bare numbers in either script: he is counting or dictating. The first
    # test caught 'మూడు నాలుగు' sailing through an ASCII-only digit rule.
    r"|^(?:[-0-9\s.,]|ఒకటి|రెండు|మూడు|నాలుగు|ఐదు|ఆరు|ఏడు|ఎనిమిది|తొమ్మిది|పది|సున్నా|డబల్)+$"
)
# A word that ENDS like a finite Telugu verb usually ends the thought:
# వస్తాను, చెప్పండి, ఉన్నారు, అవుతుంది. "రేపు వస్తాను" is a complete answer
# and holding it just adds 1.6s to an honest reply.
_FINITE_END = re.compile(r"(ను|ండి|రు|ది|ంది|ారు|ాను|ేను|దా|ామా|అవును|లేదు)[\s.]*$")

def _utterance_incomplete(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False                      # nothing streamed: let batch decide
    if re.search(r"[?]|ఆగండి|human|stop|wait", t, re.I):
        return False                      # questions and commands act now
    if _CONTINUE_TAIL.search(t):
        return True
    words = t.replace(".", " ").split()
    if len(words) == 1:
        # Pronouns end like verbs (నేను ends in ను) but are pure fragments —
        # nobody's whole reply is "I".
        if words[0] in ("నేను", "మేము", "నువ్వు", "మీరు", "తాను", "వాడు", "అది", "ఇది"):
            return True
        return not _FINITE_END.search(t)  # "వస్తాను" alone is still an answer
    return False


async def _run_turn(agent, ws, fs_uuid: str, utterance_pcm: bytes,
                    seq: int, speaking: dict,
                    transcript: str | None = None) -> None:
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
        # 450ms, not 1100. A person answers in about a quarter of a second,
        # and silence past roughly seven hundred milliseconds reads as a
        # dropped line — which is exactly what a caller did on 31 August,
        # saying "Hello? Hello?" into a gap while she was still synthesising.
        # Measured: endpoint 400ms + first clause from the model ~900ms + TTS
        # ~1100ms, so the caller waits about two and a half seconds. The
        # filler is what stands in that gap; firing it at 1.1s left the first
        # second bare.
        filler_task = asyncio.create_task(_play_filler(fs_uuid, delay=0.45))
        wav_bytes = _pcm16_to_wav_bytes(utterance_pcm)

        # ── First-clause fast path ──────────────────────────────────────
        # The token stream hands us the opening clause while the rest is
        # still generating; it goes to TTS and the caller's ear immediately.
        # clause["until"] is when its audio finishes — the remainder must
        # not broadcast before that, because uuid_broadcast interrupts.
        clause = {"text": None, "until": 0.0, "task": None}

        def _on_first_clause(prefix: str) -> None:
            # A hold sentinel must never reach TTS, and it arrives here first:
            # the streaming fast path would speak the literal word "SILENT"
            # to the caller a full second before the guard below ever runs.
            if _is_hold_sentinel(prefix):
                log.info(f"[b2] hold sentinel in first clause — staying quiet")
                return
            log.info(f"[b2] first clause ({len(prefix)} chars) -> TTS early: {prefix[:60]!r}")
            clause["text"] = prefix
            # NOT cancelled here. Text arriving is not speech starting — the
            # clause still has to be synthesised, which measures ~1.1s. This
            # used to pull the cover away at the exact moment it was still
            # needed, leaving the caller in silence right up to the answer.
            # It is cancelled below, immediately before the audio plays.

            async def _speak_prefix():
                audio = await agent.tts.synthesize(
                    normalize_for_tts(prefix,
                        (agent.profile or {}).get("pronunciation_map"),
                        getattr(agent, "lang", LANG_DEFAULT)),
                    agent.voice)
                if audio:
                    # Now the cover comes off: real speech is a moment away,
                    # and uuid_broadcast interrupts whatever is playing.
                    if not filler_task.done():
                        filler_task.cancel()
                    dur = _wav_duration_secs(audio)
                    speaking["until"] = time.monotonic() + dur
                    clause["until"] = speaking["until"]
                    await _send_audio_to_freeswitch(ws, audio, fs_uuid, seq * 10)
            clause["task"] = asyncio.create_task(_speak_prefix())

        reply_text = await agent.on_speech(wav_bytes, want_text=True,
                                           transcript_override=transcript,
                                           first_clause_cb=_on_first_clause)
        # Reply ready: if the filler has not fired yet, it never should.
        if not filler_task.done():
            filler_task.cancel()
        if not reply_text:
            return
        if _is_hold_sentinel(reply_text):
            # Caller asked for a moment. Say nothing; the silent-caller
            # re-engagement timer is what brings her back if they go quiet.
            log.info(f"[FS] {fs_uuid}: caller asked to hold — no reply spoken")
            return
        # The log showed STT and an LLM reply landing AFTER "Call ended" —
        # work billed against a channel nobody is on any more.
        if getattr(ws, "client_state", None) is not None and \
           str(getattr(ws, "client_state", "")).endswith("DISCONNECTED"):
            log.info(f"[FS] {fs_uuid}: call already ended — dropping reply")
            return
        # speaking["until"] is published inside, before each chunk is sent, so
        # a caller who interrupts immediately still trips the barge-in check.
        if clause["text"] and reply_text.startswith(clause["text"]):
            # The opening clause is already playing (or in flight). Speak only
            # the remainder, starting after the clause audio ends, with sub
            # sequence numbers above it.
            if clause["task"]:
                await clause["task"]
            remainder = reply_text[len(clause["text"]):].strip()
            if remainder:
                await asyncio.sleep(max(0.0, clause["until"] - time.monotonic()) + 0.05)
                await _speak_chunked(agent, ws, fs_uuid, remainder, seq, speaking,
                                     sub_offset=1)
        else:
            if clause["task"]:
                # A prefix was dispatched but the final text diverged (vendor
                # filter rewrote it, or the fallback path answered). Let the
                # clause finish, then speak the WHOLE reply — a one-off echo
                # of the opening beats a reply that skips its first words.
                await clause["task"]
                await asyncio.sleep(max(0.0, clause["until"] - time.monotonic()) + 0.05)
            await _speak_chunked(agent, ws, fs_uuid, reply_text, seq, speaking,
                                 sub_offset=1 if clause["text"] else 0)

        # ── End the call, once the goodbye has actually been heard ──────
        # Ordered BEFORE the transfer check: a caller who booked and then
        # asked for a human still gets the human. This only fires when the
        # model asked to end AND a booking exists (gated in on_speech).
        if getattr(agent, "end_call_requested", False):
            agent.end_call_requested = False
            # speaking["until"] is when the last chunk's audio finishes.
            # uuid_kill before that truncates her goodbye mid-word, which is
            # a worse ending than the dead air this feature removes.
            remaining = max(0.0, speaking.get("until", 0.0) - time.monotonic())
            # Then a beat. Hanging up the instant the last syllable lands
            # reads as the line dropping, not as a call ending — and it gives
            # a caller with one more question room to start asking it.
            turns_before = len(agent.transcript)
            await asyncio.sleep(remaining + 1.2)

            # If a turn landed while we waited, the caller was not finished.
            # Reading the transcript is better than a flag someone has to
            # remember to set: it is the same state every other part of the
            # call already trusts.
            if len(agent.transcript) > turns_before:
                log.info(f"[FS] {fs_uuid}: caller spoke after the closing line — staying on")
            else:
                log.info(f"[FS] {fs_uuid}: appointment booked and closed — hanging up")
                try:
                    await _esl_api(f"uuid_kill {fs_uuid}")
                except Exception as e:  # noqa: BLE001
                    # Never fatal. The caller simply hangs up themselves, and
                    # the 120s idle timeout is still behind this.
                    log.warning(f"[FS] {fs_uuid}: uuid_kill after booking failed: {e}")
            return

        if getattr(agent, "transfer_requested", False):
            agent.transfer_requested = False
            log.info(f"[FS] {fs_uuid}: caller asked for a human — transferring")
            try:
                # Detach mod_audio_stream FIRST. Closing our end of the
                # websocket does not stop the stream on the channel — it
                # simply reconnects, the pipeline treats the reconnection as
                # a brand new call, and Nikki comes back to life on a leg
                # that is supposed to be a human. On the 12:52 call that
                # produced a second calls row (18s, no transcript, intent
                # unknown) sharing one FreeSWITCH uuid with the first, and
                # the caller heard the bot restart after being told she was
                # connecting them to staff.
                await _esl_api(f"uuid_audio_stream {fs_uuid} stop")
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


async def _mixed_recording_bytes(fs_uuid: str) -> bytes:
    """The both-sides recording FreeSWITCH made, if it made one.

    Why this exists: the websocket carries ONE direction. The dialplan starts
    mod_audio_stream with `mono`, which is the caller's leg, and the pipeline
    was uploading exactly those frames — so every recording held the caller
    and nothing else. Nikki's replies never travel that path at all; she is
    played into the channel with uuid_broadcast, which the media bug does not
    see. Proven by feeding a call pure digital silence while she spoke: the
    uploaded file came back with a peak amplitude of zero.

    Switching the stream to `mixed` would fix the recording and break the
    call — that same stream feeds VAD and STT, so she would hear herself and
    transcribe her own speech. So FreeSWITCH records both legs itself with
    record_session, and this reads that file.

    Returns b"" whenever anything is off, and the caller-only PCM is used
    instead — a one-sided recording beats no recording.
    """
    path = os.path.join(_TTS_SPOOL, f"call_{fs_uuid}.wav")
    try:
        # The channel may still be closing the file. Stopping is idempotent
        # and returns an error we do not care about once it already stopped.
        try:
            await _esl_api(f"uuid_record {fs_uuid} stop {path}")
        except Exception:  # noqa: BLE001
            pass
        # Wait for the size to settle rather than a fixed sleep — a long call
        # takes longer to flush than a short one.
        last = -1
        for _ in range(12):                     # up to ~1.8s
            if not os.path.exists(path):
                await asyncio.sleep(0.15)
                continue
            size = os.path.getsize(path)
            if size == last and size > 44:      # 44 = bare WAV header
                break
            last = size
            await asyncio.sleep(0.15)
        if not os.path.exists(path) or os.path.getsize(path) <= 44:
            return b""
        with open(path, "rb") as f:
            data = f.read()
        return data
    except Exception as e:  # noqa: BLE001
        log.warning(f"[FS] {fs_uuid}: mixed recording unavailable: {e}")
        return b""
    finally:
        # /tmp is tmpfs against a 5.6GB ceiling, and an earlier version of
        # record_session on this leg filled the disk and took FreeSWITCH, the
        # pipeline and the API server down together because nothing ever
        # deleted the files. R2 has it now; this must not linger.
        try:
            os.remove(path)
        except OSError:
            pass


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

    # agent.llm, not gemini_generate. gemini_generate lives in
    # app/../gemini_client.py and was never imported here, so this line raised
    # NameError on EVERY onboarding call — swallowed by the caller's except,
    # which is why the draft silently never appeared. The agent already holds
    # a configured GeminiLLM, so it is also the one place the model name,
    # auth header and circuit breaker stay consistent.
    raw = await agent.llm.generate(
        "Return only JSON. Extract nothing that was not said.",
        [{"role": "user", "content": ONBOARDING_EXTRACT.format(transcript=transcript)}],
    )
    # generate() returns prose; the model is asked for JSON but a stray
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

        # ── ENCRYPT AT REST ─────────────────────────────────────────
        # heynikki.in tells customers "Call audio is encrypted with
        # AES-256-GCM before it is stored", and the FAQ repeats it. The code
        # that did this existed but returned None on every call because its
        # key was never set, so the promise was untrue and every recording
        # sat in R2 as a plain WAV. Encrypt here, on the path that actually
        # runs. The object layout is [12-byte nonce][ciphertext+tag], and the
        # call id is bound in as associated data so a blob cannot be replayed
        # under a different call's identity.
        body, key_suffix, ctype = local_wav_bytes, "", "audio/wav"
        blob = _encrypt_recording(local_wav_bytes, tenant_id, call_id)
        if blob is not None:
            body, key_suffix, ctype = blob, ".enc", "application/octet-stream"
        else:
            # Never silently downgrade a security promise: if the key is
            # missing the recording is dropped rather than stored in clear.
            log.error("[FS] recording NOT stored — encryption unavailable")
            return ""

        object_key = f"{tenant_id}/{call_id}.wav{key_suffix}"
        s3.put_object(
            Bucket=r2_bucket,
            Key=object_key,
            Body=body,
            ContentType=ctype,
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


def _recording_key(tenant_id: str) -> bytes | None:
    """32-byte AES key for a tenant, per-tenant override then platform key."""
    b64 = (os.getenv(f"HEYNIKKI_RECORDING_KEY_{tenant_id}")
           or os.getenv("HEYNIKKI_RECORDING_KEY"))
    if not b64:
        return None
    try:
        k = base64.b64decode(b64)
        return k if len(k) == 32 else None
    except Exception:  # noqa: BLE001
        return None


def _encrypt_recording(wav: bytes, tenant_id: str, call_id: str) -> bytes | None:
    if not _HAS_CRYPTO:
        return None
    key = _recording_key(tenant_id)
    if not key:
        return None
    nonce = secrets.token_bytes(12)
    ct = AESGCM(key).encrypt(nonce, wav, associated_data=str(call_id).encode())
    return nonce + ct


def _decrypt_recording(blob: bytes, tenant_id: str, call_id: str) -> bytes | None:
    # Objects written before encryption was switched on are plain RIFF WAVs.
    # Recognise and pass them through rather than failing a customer's
    # playback on history they had no part in.
    if blob[:4] == b"RIFF":
        return blob
    key = _recording_key(tenant_id)
    if not key or not _HAS_CRYPTO or len(blob) < 13:
        return None
    try:
        return AESGCM(key).decrypt(blob[:12], blob[12:], associated_data=str(call_id).encode())
    except Exception as e:  # noqa: BLE001
        log.error(f"[recording] decrypt failed for {call_id}: {e}")
        return None


@app.get("/api/v1/recording/fetch")
async def fetch_recording(
    key: str,
    tenant_id: str,
    call_id: str,
    x_internal_secret: str = Header(None, alias="X-Internal-Secret"),
):
    """Return a decrypted WAV for the api-server to stream to its owner.

    Encrypted recordings cannot be served by a presigned URL — the browser
    would download ciphertext. Decryption needs the key, which lives here
    with the R2 credentials, so playback is a proxy rather than a redirect.
    The api-server is what checks that the caller owns the call; this
    endpoint only proves it is the api-server asking.
    """
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")
    if ".." in key or key.startswith("/"):
        raise HTTPException(status_code=400, detail="bad key")
    # The key is namespaced by tenant; refuse any that is not this tenant's.
    if not key.startswith(f"{tenant_id}/"):
        raise HTTPException(status_code=403, detail="key does not belong to tenant")

    def _get() -> bytes:
        import boto3
        from botocore.config import Config as _BotoCfg
        s3 = boto3.client(
            "s3",
            # CF_ACCOUNT_ID — the name _upload_to_r2 uses. A different guess
            # here would KeyError on the first play, after the upload had
            # worked perfectly.
            endpoint_url=f"https://{os.environ['CF_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=_BotoCfg(signature_version="s3v4"), region_name="auto",
        )
        return s3.get_object(
            Bucket=os.environ.get("R2_BUCKET", "heynikki-recordings"), Key=key
        )["Body"].read()

    try:
        blob = await asyncio.to_thread(_get)
    except Exception as e:  # noqa: BLE001
        log.error(f"[recording] fetch {key}: {e}")
        raise HTTPException(status_code=404, detail="recording not found")

    wav = _decrypt_recording(blob, tenant_id, call_id)
    if wav is None:
        raise HTTPException(status_code=500, detail="could not decrypt recording")
    return Response(content=wav, media_type="audio/wav",
                    headers={"Cache-Control": "private, max-age=300"})


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

    # The TENANT's own webhook, if they set one. voice_profiles has carried
    # automation_webhook_url since the schema was written and nothing ever
    # fired it — a per-tenant integration column that was pure decoration.
    # Events go to {their_url}/{event} with the same payload the platform
    # engine gets, so a business can drive its own Zapier/n8n/CRM without
    # touching ours. Failures are theirs to notice; a broken customer
    # endpoint must never delay a call.
    tenant_url = str(payload.get("_tenant_webhook") or "").strip()
    payload.pop("_tenant_webhook", None)
    if tenant_url.startswith("http"):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(f"{tenant_url.rstrip('/')}/{event}", json=payload)
            log.info(f"[FS] Tenant webhook fired: {event}")
        except Exception as e:  # noqa: BLE001
            log.warning(f"[FS] Tenant webhook failed ({event}): {e}")


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
        # The dialplan has ALREADY answered the leg by the time we get here,
        # so closing the websocket alone leaves the caller holding a live
        # line with permanent silence — billed, and convinced the business
        # is broken. Every unassigned number in inventory did this. Kill the
        # channel so the network returns a clean disconnect instead.
        log.warning(f"[FS] No voice profile for DID: {did_number} — hanging up the leg")
        await ws.send_text(json.dumps({"error": "no_profile", "did": did_number}))
        try:
            await _esl_api(f"uuid_kill {fs_uuid}")
        except Exception as e:  # noqa: BLE001
            log.warning(f"[FS] uuid_kill after no_profile failed: {e}")
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

    # Facts the business taught her — brochure extractions, Teach Nikki
    # entries, uploaded documents. Fetched once per call rather than per
    # turn: they do not change mid-conversation and the caller should not
    # pay a round trip for them.
    knowledge = await db.get_knowledge(profile.get("id"))
    if knowledge:
        log.info(f"[knowledge] {len(knowledge)} fact(s) loaded for {profile.get('business_name')}")
    agent = NikkiAgent(profile, caller_number, knowledge)

    # ── CAMPAIGN SCRIPT ─────────────────────────────────────────────────
    # "What should Hey Nikki say?" is the whole point of creating a campaign,
    # and on this path she never saw it. The only code that read
    # outbound_campaigns.script lives in the retired Exotel bridge, and it
    # found its recipient through outbound_recipients.exotel_call_sid — a
    # column that does not exist in this database. So every campaign call
    # was answered by the ordinary inbound receptionist prompt, and the
    # script the business wrote was decoration.
    if campaign_id:
        try:
            camp = await db.get_campaign_script(campaign_id)
            if camp:
                from app.widget import build_outbound_prompt
                agent.system_prompt = build_outbound_prompt(camp).replace(
                    "__LANGUAGE_RULE__",
                    "- Speak Telugu with natural English words mixed in, as Hyderabad speaks.")
                log.info(f"[FS] campaign {campaign_id[:8]}: script applied ({len(camp)} chars)")
            else:
                log.warning(f"[FS] campaign {campaign_id[:8]} has no script — using the default prompt")
        except Exception as e:  # noqa: BLE001
            # A missing script must never cost the call.
            log.error(f"[FS] campaign script load failed: {e}")

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

        # Per-option transfer targets. The menu let a business type "put them
        # through to THIS number" per option, and the transfer then rang the
        # generic staff group anyway — the typed number was decoration. The
        # map lets the transfer moment pick the right line from what the
        # caller actually said; a menu with one transfer target (the common
        # case) also becomes the default ring group so even an unmatched
        # "human please" reaches the number the business chose.
        _tmap = {}
        for o in _opts:
            if o.get("action") == "transfer":
                digits = re.sub(r"\D", "", str(o.get("target") or ""))[-10:]
                if len(digits) == 10:
                    _tmap[str(o["say"]).lower()] = digits
        if _tmap:
            agent.ivr_transfer_map = _tmap
            first = next(iter(_tmap.values()))
            agent.ring_group = f"sofia/gateway/jio_primary/{first}"
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

    # Prepare the missed-call message now, while there is still a pipeline
    # attached to this call. See _prepare_missed_call_audio.
    asyncio.create_task(_prepare_missed_call_audio(agent, fs_uuid, profile))

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

    # ── REFUSAL ─────────────────────────────────────────────────────────
    # The api-server answers 200 with ok:false when a tenant is out of
    # credits or over its concurrency cap, and deliberately writes no calls
    # row. That verdict was computed and then ignored: every plan cap and
    # the trial credit cutoff were advisory, so a tenant at zero credits
    # kept being served indefinitely and the fallback below invented a
    # calls row for the call the server had just refused.
    if routing and (routing.get("ok") is False or routing.get("routing_mode") == "reject"):
        reason = routing.get("reason", "refused")
        log.warning(f"[FS] call refused ({reason}) — {did_number} from {caller_number}")
        msg = routing.get("message") or "క్షమించండి, ఈ నంబర్ ప్రస్తుతం అందుబాటులో లేదు."
        try:
            tts = SarvamTTS()
            wav = await tts.synthesize(normalize_for_tts(msg), profile.get("voice") or "priya", 8000)
            await _send_audio_to_freeswitch(ws, wav, fs_uuid)
            # 8kHz mono 16-bit => 16000 bytes/sec; wait for playback to finish
            # before killing the channel or the caller hears nothing at all.
            await asyncio.sleep(max(1.0, len(wav) / 16000.0))
        except Exception as e:  # noqa: BLE001
            log.warning(f"[FS] refusal message failed: {e}")
        try:
            await _esl_api(f"uuid_kill {fs_uuid}")
        except Exception:  # noqa: BLE001
            pass
        await ws.close(code=1000)
        return

    agent.call_id = routing.get("call_id")
    if not agent.call_id and routing.get("ok") is not False:
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
    # Set once the real frame duration is known, alongside silence_needed.
    burst_frames       = 0
    long_speech_frames = 0
    barge_frames   = 0            # consecutive voiced frames while Nikki speaks
    last_backchannel = 0.0        # B8 cooldown
    pending_text = ""             # B7: merged mid-reply interjections
    pending_pcm  = bytearray()
    pending_runner: dict = {"t": None}
    held_text = ""                # completeness gate: fragments awaiting the rest
    held_pcm  = bytearray()
    held_at   = 0.0
    vad_threshold  = float(_SILENCE_THRESHOLD)
    noise_win: "deque" = deque(maxlen=250)   # ~5s of frame RMS while she is silent
    # Per-call streaming STT. Transcribes WHILE the caller talks, so the
    # transcript is ~ready when the silence window closes — the batch POST's
    # 300-600ms round-trip leaves the critical path. Fails open to batch.
    stt_stream = SarvamStreamingSTT()
    asyncio.create_task(stt_stream.start())
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
                    # See the endpointing note further down: short bursts get
                    # a longer silence window than complete utterances.
                    burst_frames       = max(1, round(0.85 / frame_secs))
                    long_speech_frames = max(1, round(1.20 / frame_secs))
                    log.info(
                        f"[FS] {fs_uuid}: frame={len(frame)}B "
                        f"({frame_secs*1000:.0f}ms) silence_needed={silence_needed} "
                        f"speech_needed={speech_needed} "
                        f"burst={burst_frames} long_speech={long_speech_frames}"
                    )

                # Accumulate full recording
                recording_pcm.extend(frame)

                # ── Held-fragment flush ─────────────────────────────────
                # If nothing followed the fragment for ~1.6s, it was the whole
                # thought after all — answer it. Without this, a caller whose
                # entire reply was "1" would wait forever.
                if held_text and speech_count == 0 \
                        and time.monotonic() - held_at > 1.6 \
                        and (turn_task is None or turn_task.done()):
                    turn_seq += 1
                    q_text, q_pcm = held_text, bytes(held_pcm)
                    held_text, held_pcm = "", bytearray()
                    log.info(f"[hold] flushed after wait: {q_text[:60]!r}")
                    turn_task = asyncio.create_task(
                        _run_turn(agent, ws, fs_uuid, q_pcm,
                                  turn_seq, speaking, transcript=q_text))

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
                        # 20th percentile, not 85th. The window is the last
                        # ~7 seconds of the CALLER'S line, and a caller who is
                        # talking is most of it — so the 85th percentile was
                        # not a noise floor at all, it was their speech level.
                        # Multiplying that by 1.5 put the threshold ABOVE the
                        # voice it was supposed to detect, and the more they
                        # said the deafer she got.
                        #
                        # Measured on call 3a69225a: the caller said "నమస్కారం
                        # మేడం, నా పేరు నిధిన్ మేడం" at RMS 1990-8949 while the
                        # threshold sat at 8272-9139. Every frame of it was
                        # classified as silence, nothing reached STT, and she
                        # answered "అర్థం కాలేదండి" to a man who had just
                        # given her his name. Replaying that call: 0 of 14
                        # frames heard at the 85th percentile, 14 of 14 at the
                        # 20th.
                        #
                        # A low percentile is what makes the adaptation work
                        # as intended — on a line idling at RMS 300 the floor
                        # is 300 and the threshold 450, which is still far
                        # under speech, so the noisy-line case this was built
                        # for is handled better, not worse.
                        floor = sorted(noise_win)[int(len(noise_win) * 0.20)]
                        vad_threshold = max(_SILENCE_THRESHOLD, floor * 1.5)
                is_speech = energy > vad_threshold

                if is_speech:
                    speech_buf.extend(frame)
                    speech_count  += 1
                    silence_count  = 0
                    # Mirror into the streaming socket. Same gating as the
                    # local buffer, so billed STT seconds do not change.
                    if not stt_stream.dead:
                        stt_stream.feed(bytes(frame))
                    # ── B8: she is listening, audibly ───────────────────
                    # Six seconds of continuous caller speech with Nikki
                    # silent earns a soft "హా" — and at most one every
                    # seven seconds, randomised, because the same murmur on
                    # a metronome is worse than silence.
                    if (speech_count * (frame_secs or 0.02) > 6.0
                            and time.monotonic() >= speaking["until"]
                            and time.monotonic() - last_backchannel > 7.0):
                        last_backchannel = time.monotonic()
                        async def _bc():
                            clip = await _backchannel_clip(agent.tts, agent.voice)
                            if clip and time.monotonic() >= speaking["until"]:
                                await _esl_api(f"uuid_broadcast {fs_uuid} {clip} aleg")
                        asyncio.create_task(_bc())
                else:
                    silence_count += 1
                    if speech_count > 0:
                        speech_buf.extend(frame)  # include trailing silence
                        if not stt_stream.dead:
                            stt_stream.feed(bytes(frame))

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
                # A brief burst of speech is usually somebody drawing breath
                # mid-sentence, not the end of a turn. The flat 400ms window
                # cut one caller's single sentence into five separate STT
                # calls — 'దాకా చేసిన', 'lab test-లు', 'jain', 'doctor తో',
                # 'నేను చెప్తున్నాను' — which reached the transcript as
                # gibberish and the model as nonsense.
                #
                # So the window depends on how much they have said: a long
                # utterance ending is unambiguous and keeps the snappy 400ms,
                # while anything under ~1.2s of speech waits ~850ms before we
                # accept it as a complete turn. Normal conversation is not
                # slowed; only the fragments that were never turns are.
                if burst_frames and long_speech_frames and speech_count < long_speech_frames:
                    _need = max(_need, burst_frames)
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
                            # ── B7: classify, don't discard ─────────────────
                            # Duration alone cannot separate "సరే" from
                            # "ఆగండి". The streaming socket has usually
                            # already transcribed the clip; a quick flush
                            # says which it was. A backchannel is ignored, a
                            # stop-word stops her, and a real question is
                            # queued for the moment the current reply ends —
                            # previously all three were thrown away, including
                            # two requests for a human on a real call.
                            async def _classify_short(pcm: bytes, tt):
                                txt = ""
                                if not stt_stream.dead:
                                    try:
                                        txt = await stt_stream.finish_turn(timeout=0.8)
                                    except Exception:  # noqa: BLE001
                                        txt = ""
                                if not txt:
                                    return          # nothing intelligible; old behaviour
                                low = txt.strip().lower()
                                log.info(f"[FS] {fs_uuid}: short utterance: {low!r}")
                                if re.fullmatch(
                                    r"[\s,.!]*?(హా|ఆ|ఊ|అవును|సరే|ఒకే|ఓకే|హ్మ్|అవునండి|సరేనండి|"
                                    r"ok(ay)?|yes|haan|hm+|right|acha)[\s,.!]*", low):
                                    return          # true backchannel — she talks on
                                if re.search(r"ఆగండి|ఆపండి|wait|stop|hold|ఒక్క నిమిషం", low):
                                    speaking["until"] = 0.0
                                    await _esl_api(f"uuid_break {fs_uuid} all")
                                    if tt and not tt.done():
                                        tt.cancel()
                                    log.info(f"[FS] {fs_uuid}: caller said wait — stopped")
                                    return
                                # A real interjection: MERGED into one
                                # pending turn, answered when the current
                                # reply ends. The first version made every
                                # fragment its own queued turn, and a paused
                                # monologue produced a serial stack of
                                # replies — the phone version of two Nikkis
                                # talking at once.
                                nonlocal pending_text, pending_pcm
                                pending_text = (pending_text + " " + txt).strip()
                                pending_pcm += pcm
                                if pending_runner["t"] is None or pending_runner["t"].done():
                                    async def _drain_pending():
                                        nonlocal pending_text, pending_pcm, turn_seq, turn_task
                                        if tt:
                                            try:
                                                await asyncio.wait_for(
                                                    asyncio.shield(tt), timeout=20)
                                            except Exception:  # noqa: BLE001
                                                pass
                                        # settle: later fragments may still land
                                        await asyncio.sleep(0.6)
                                        q_text, q_pcm = pending_text, bytes(pending_pcm)
                                        pending_text, pending_pcm = "", bytearray()
                                        if not q_text:
                                            return
                                        turn_seq += 1
                                        turn_task = asyncio.create_task(
                                            _run_turn(agent, ws, fs_uuid, q_pcm,
                                                      turn_seq, speaking,
                                                      transcript=q_text))
                                    pending_runner["t"] = asyncio.create_task(_drain_pending())
                            asyncio.create_task(
                                _classify_short(utterance_pcm, turn_task))
                            speech_buf = bytearray()
                            continue

                    turn_seq += 1
                    # Streamed transcript first; empty string falls back to
                    # batch inside on_speech. The flush wait is bounded so a
                    # stuck socket costs at most ~1.2s once, then dead-flags.
                    _stream_text = ""
                    if not stt_stream.dead:
                        try:
                            _stream_text = await stt_stream.finish_turn()
                        except Exception:  # noqa: BLE001
                            _stream_text = ""
                    if _stream_text:
                        log.info(f"[sttws] streamed: {_stream_text[:80]}")

                    # ── Completeness gate ───────────────────────────────
                    # A fragment is held, not answered. The next endpoint
                    # merges into it; the timeout below flushes it if the
                    # caller really was done.
                    if held_text:
                        _stream_text = (held_text + " " + (_stream_text or "")).strip()
                        utterance_pcm = bytes(held_pcm) + utterance_pcm
                        held_text, held_pcm = "", bytearray()
                    if (_stream_text and _utterance_incomplete(_stream_text)
                            and (turn_task is None or turn_task.done())):
                        held_text = _stream_text
                        held_pcm  = bytearray(utterance_pcm)
                        held_at   = time.monotonic()
                        log.info(f"[hold] fragment kept, waiting for the rest: {held_text[:60]!r}")
                        turn_seq -= 0   # no turn consumed
                        continue

                    turn_task = asyncio.create_task(
                        _run_turn(agent, ws, fs_uuid, utterance_pcm,
                                  turn_seq, speaking,
                                  transcript=_stream_text or None))

    except Exception as e:
        log.error(f"[FS] {fs_uuid}: WebSocket error: {e}")

    finally:
        # ── Call cleanup ───────────────────────────────────────────────────
        try:
            await stt_stream.close()
        except Exception:  # noqa: BLE001
            pass
        duration = int(time.time() - call_start_ts)
        log.info(f"[FS] {fs_uuid}: Call ended, duration={duration}s, pcm={len(recording_pcm)}B")

        # Upload recording to R2 (async, don't block close). Prefer the file
        # FreeSWITCH mixed from BOTH legs; fall back to the caller-only PCM
        # this websocket received, which is all there used to be.
        r2_url = ""
        wav_bytes = await _mixed_recording_bytes(fs_uuid)
        if wav_bytes:
            log.info(f"[FS] {fs_uuid}: uploading both-sides recording ({len(wav_bytes)}B)")
        elif recording_pcm:
            log.warning(f"[FS] {fs_uuid}: no mixed recording — falling back to caller-only audio")
            wav_bytes = _pcm16_to_wav_bytes(bytes(recording_pcm))
        if wav_bytes:
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
                "_tenant_webhook": (agent.profile or {}).get("automation_webhook_url"),
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



@app.on_event("startup")
async def _warm_on_boot() -> None:
    # Fire and forget: a slow vendor must never delay the service accepting
    # calls, so this runs behind the port opening rather than before it.
    asyncio.create_task(_warm_tts_cache())
