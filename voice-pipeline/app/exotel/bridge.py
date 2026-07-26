"""
Exotel <-> Nikki voice bridge — Phase 2 with pre-cached greeting.
Greeting is pre-baked to mu-law and streamed within ~50ms of 'start'.
Sarvam is only called mid-conversation for dynamic replies.

Recording: the full call audio (caller turns + AI turns, in the order they
actually happened — there's no barge-in yet so this is a faithful timeline)
is buffered in memory as it streams, then on 'stop' it's wrapped as a WAV,
AES-256-GCM encrypted with JOVIO_RECORDING_KEY, and uploaded to Supabase
Storage. A `calls` row is created on 'start' and finalized on 'stop' so the
recording has somewhere to attach (recording_path, duration_seconds).
"""
import asyncio, audioop, base64, json, logging, os, random, re, secrets, time, wave, io
from typing import Optional
import httpx
from fastapi import WebSocket, WebSocketDisconnect

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    _HAS_CRYPTO = True
except ImportError:
    _HAS_CRYPTO = False

from app.exotel import knowledge
from app.exotel import circuit_breaker as cb
from app.exotel import webhooks
from app.exotel import outbound as ob
from app.exotel import appointments
from app.exotel import providers

log = logging.getLogger("exotel-bridge")
logging.basicConfig(level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s | %(message)s")

SARVAM_KEY   = os.getenv("SARVAM_API_KEY", "")
GEMINI_KEY   = os.getenv("GEMINI_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

EXOTEL_SR = 8000
PIPE_SR   = 16000
TTS_SR    = 22050

VAD_THRESHOLD = 500
SILENCE_MS    = 1200
MIN_SPEECH_MS = 300

# ─── Barge-in (interrupt while Nikki is speaking) ────────────
# Higher threshold + longer sustained-speech requirement while Nikki is
# talking, to reduce the risk of Nikki self-interrupting from echo of its
# own audio being picked up by the caller's phone mic. Exotel's WebSocket
# doesn't provide echo cancellation, so this trade-off is unavoidable:
# set BARGE_IN_THRESHOLD too low and Nikki interrupts itself from its own
# playback echo; set it too high and quiet-speaking callers can't
# interrupt at all. 2000 RMS + 400ms of sustained speech is a conservative
# starting point — most legitimate interruption attempts ("wait...",
# "actually...") land well above this bar.
BARGE_IN_THRESHOLD = 2000
BARGE_IN_MIN_MS    = 400

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))), "assets")
CACHED_DIR = os.path.join(ASSETS_DIR, "cached_pcm")
DEFAULT_VOICE = "priya"  # confirmed valid for bulbul:v3 via live API error response
                         # (2026-07-02) -- v2's "anushka" is NOT valid on v3, entirely
                         # different speaker roster. This is a placeholder pick, not a
                         # verified "best" choice -- swap once real listening happens
                         # (scripts/compare_voices.py already generated 38 real v3
                         # samples earlier, never actually listened to).

# ─── Voice expressiveness tuning (bulbul:v3 only) ───────────
# Per Sarvam's own best-practices docs, pace and temperature are "the single
# most impactful tuning lever available to developers" for how the voice
# actually sounds. Until 2026-07-02 we never set temperature at all, meaning
# every call ran on Sarvam's default (0.6) -- the "emotional colour" knob was
# sitting untouched the entire time we were trying to make the voice sound
# more human.
#
#   temperature: expressiveness / prosodic variation. Sarvam's docs: "Lower
#     values produce consistent, predictable delivery; higher values introduce
#     more natural pitch variation and emotional colour." Range 0.01-2.0,
#     default 0.6. Higher is warmer/more human BUT Sarvam explicitly warns it
#     "may introduce artifacts or errors" -- so 0.85 here is a deliberate lean
#     toward warmth while staying well clear of the risky end. This has NOT
#     been ear-tested; it's a reasoned starting point, not a verified optimum.
#
#   pace: 1.1 matches Sarvam's own recommendation for "brisk, professional
#     contexts" (their words). Unchanged from before.
#
# Both are env-overridable specifically so these can be tuned by ear on the
# live box without needing a code patch + redeploy cycle for each experiment.
TTS_PACE = float(os.getenv("TTS_PACE", "1.1"))
TTS_TEMPERATURE = float(os.getenv("TTS_TEMPERATURE", "0.85"))

SYSTEM_PROMPT = """మీరు ఒక Telugu AI receptionist. మీ పేరు Hey Nikki.
Business: {business_name} ({business_type}).
Rules:
__LANGUAGE_RULE__
- SHORT responses (1-2 sentences). Phone call, not chat.
- Warm, professional, helpful.
- Appointment: collect name, phone, time. Confirm via WhatsApp.
- Unknown info: "team check చేసి call back చేస్తారు".
- Never invent prices/addresses.
- End when caller says ధన్యవాదాలు/thank you/bye.
"""

# ─── Voice Profile SKUs ─────────────────────────────────────
# Voice IDs MUST come from bulbul:v3's actual speaker catalog — that's the
# model bridge.py calls now (see sarvam_tts below, "model":"bulbul:v3",
# upgraded from v2 on 2026-07-02). v3 has an ENTIRELY DIFFERENT speaker
# roster than v2 — none of v2's names (anushka, manisha, vidya, arya,
# abhilash, karun, hitesh) are valid on v3, confirmed via a real live 400
# error the first time this upgrade shipped. Speaker names are not
# interchangeable between model versions — a v2-only name here silently
# 400s every TTS call for that SKU. (The dashboard's old SKU list once
# used meera/pavithra/arvind, none of which ever existed in any catalog —
# fixed earlier today, before the v2->v3 upgrade.)
SKU_VOICE = {
    # All 4 changed from v2 names (anushka/vidya/karun/manisha, all INVALID
    # on v3) to the only 4 names directly confirmed valid via the real
    # Sarvam API error response on 2026-07-02: aditya, ritu, ashutosh, priya.
    # This is a stopgap to unblock the pipeline, NOT a considered voice
    # choice -- only 2 confirmed-valid female-sounding names exist in this
    # set (priya, ritu), so "premium" ended up male by necessity, breaking
    # its original "distinct female tone" intent. Fix properly once
    # scripts/compare_voices.py's 38 real v3 samples get listened to.
    "standard":    "priya",
    "clinic":      "ritu",
    "real_estate": "aditya",
    "premium":     "ashutosh",  # was female-toned by design; temporarily male, see note above
}

# ─── Live language switching ────────────────────────────────
# Caller can speak Telugu, Hindi, or English and get replies in the SAME
# language they just used — switches turn by turn, no fixed setting. Scoped
# to these 3 languages deliberately (matches the actual target market);
# Sarvam supports more, but untested languages aren't claimed as supported.
#
# Mechanism: sarvam_stt calls Saarika with language_code="unknown", which
# auto-detects the spoken language and returns it in the response. That
# detected code becomes the language for both Gemini's reply instruction
# and the matching Sarvam TTS call for that turn. The SAME configured SKU
# voice (e.g. "ritu" for Clinic) speaks across all 3 languages — Sarvam's
# target_language_code affects pronunciation/normalization, not which
# speaker names are valid, so the caller hears one consistent "person"
# regardless of which language they're using.
#
# The greeting stays Telugu — the caller hasn't said anything yet at that
# point, so there's nothing to detect language from. Switching starts from
# the caller's first utterance onward.
LANGUAGE_NAMES = {"te-IN": "Telugu", "hi-IN": "Hindi", "en-IN": "English"}
DEFAULT_LANGUAGE = "te-IN"
LANGUAGE_MARKER = "__LANGUAGE_RULE__"


def language_instruction(lang_code: str) -> str:
    name = LANGUAGE_NAMES.get(lang_code, LANGUAGE_NAMES[DEFAULT_LANGUAGE])
    return (f"- Respond in {name} — the caller is currently speaking {name}, "
            f"match them. If they switch languages mid-call, switch with them.")


def apply_language(prompt: str, lang_code: str) -> str:
    """Fills in the language directive for this turn. Uses a literal marker
    + str.replace rather than .format() so business names/content containing
    curly braces (RAG snippets, etc.) can't collide with prompt templating."""
    return prompt.replace(LANGUAGE_MARKER, language_instruction(lang_code))

SKU_SYSTEM_PROMPTS = {
    "standard": """మీరు ఒక professional Telugu AI receptionist. మీ పేరు Hey Nikki.
Business: {business_name} — general business / retail / coaching.
Rules:
__LANGUAGE_RULE__
- SHORT responses (1-2 sentences). Phone call, not chat.
- Warm, friendly, approachable tone.
{shared_rules}""",
    "clinic": """మీరు ఒక professional Telugu AI receptionist ఒక clinic/hospital కోసం. మీ పేరు Hey Nikki.
Business: {business_name} — hospital / clinic / diagnostic lab.
Rules:
__LANGUAGE_RULE__
- Formal and careful tone regardless of language — ఇది ఆరోగ్యానికి సంబంధించిన విషయం.
- SHORT responses (1-2 sentences). Phone call, not chat.
- NEVER give medical advice, diagnosis, or suggest medication — always route clinical
  questions to "డాక్టర్ గారు call back చేస్తారు" (translate that redirect into whichever
  language the caller is using).
{shared_rules}""",
    "real_estate": """మీరు ఒక professional Telugu AI receptionist ఒక real estate business కోసం. మీ పేరు Hey Nikki.
Business: {business_name} — real estate, site visits, property enquiries.
Rules:
__LANGUAGE_RULE__
- Warm and persuasive tone regardless of language — encourage a site visit or appointment.
- SHORT responses (1-2 sentences). Phone call, not chat.
- If caller mentions budget or location preference, acknowledge it and note it's passed to the team.
{shared_rules}""",
    "premium": """మీరు ఒక professional Telugu AI receptionist ఒక premium/luxury business కోసం. మీ పేరు Hey Nikki.
Business: {business_name} — premium, high-value clientele.
Rules:
__LANGUAGE_RULE__
- Extra courteous, unhurried tone regardless of language.
- SHORT responses (1-2 sentences). Phone call, not chat.
{shared_rules}""",
}

SKU_SHARED_RULES = """- Appointment: collect name, phone, time. Confirm via WhatsApp.
- Business hours: {open_time}-{close_time}, {open_days}.
{services_line}{appt_types_line}- Unknown info: "team check చేసి call back చేస్తారు".
- Never invent prices/addresses.
- End when caller says ధన్యవాదాలు/thank you/bye."""


def build_sku_prompt(profile: dict) -> str:
    """Build the SKU-specific system prompt from a voice_profiles row."""
    sku = profile.get("profile_sku") or "standard"
    template = SKU_SYSTEM_PROMPTS.get(sku, SKU_SYSTEM_PROMPTS["standard"])
    services = profile.get("services") or []
    appt_types = profile.get("appointment_types") or []
    open_days = profile.get("open_days") or ["Mon","Tue","Wed","Thu","Fri","Sat"]
    shared = SKU_SHARED_RULES.format(
        open_time=profile.get("open_time") or "09:00",
        close_time=profile.get("close_time") or "21:00",
        open_days=", ".join(open_days),
        services_line=(f"- Services: {', '.join(services)}.\n" if services else ""),
        appt_types_line=(f"- Appointment types: {', '.join(appt_types)}.\n" if appt_types else ""),
    )
    return template.format(
        business_name=profile.get("business_name") or "this business",
        shared_rules=shared,
    )


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
- The caller already heard a disclosure that this call is automated before you started talking — don't repeat that yourself, but if asked directly whether you're human or AI, always say AI assistant, never claim otherwise.
- If the recipient asks to be removed from future calls, sounds unwilling to talk, or asks you to stop, acknowledge respectfully and end the call — do not persist or re-pitch.
{name_line}Your goal for this call:
{script}
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


async def sarvam_tts(text: str, voice: str = DEFAULT_VOICE,
                      target_language_code: str = DEFAULT_LANGUAGE) -> tuple:
    """Returns (pcm_bytes, sample_rate). (b"", 0) on failure.

    Upgraded to bulbul:v3 with tuned parameters 2026-07-02 (pace/loudness/
    pitch tuning + speech_sample_rate=8000 requests audio already at
    Exotel's target rate, skipping a resample step).

    Always returns the REAL sample rate read from the WAV response header
    rather than assuming a fixed constant — this matters specifically
    because requesting speech_sample_rate=8000 makes Sarvam return audio
    at a different rate than the old bulbul:v2 default (22050Hz). A
    hardcoded rate assumption here would silently corrupt audio (wrong
    pitch/speed) the moment this config changed — see _synthesize_
    sentence_pcm8k, which resamples only if the actual rate isn't
    already what's needed, never assuming."""
    if not cb.sarvam_tts_breaker.allow_request():
        log.warning("sarvam_tts: circuit OPEN, skipping live call")
        return b"", 0

    async with httpx.AsyncClient(timeout=30) as c:
        try:
            r = await c.post("https://api.sarvam.ai/text-to-speech",
                headers={"api-subscription-key": SARVAM_KEY},
                json={"inputs":[text], "target_language_code":target_language_code,
                      "speaker":voice, "model":"bulbul:v3",
                      # NOTE: pitch/loudness deliberately NOT sent — Sarvam's
                      # real API rejects them for bulbul:v3 with an explicit
                      # 400 error ("Pitch and loudness parameters are
                      # currently not supported for the Bulbul V3 model"),
                      # discovered live 2026-07-02 after every single reply
                      # was silently falling back to the cached error clip.
                      "pace": TTS_PACE,
                      "temperature": TTS_TEMPERATURE,
                      "speech_sample_rate": 8000, "enable_preprocessing": True,
                      "eng_interpolation_wt": 100})
        except Exception as e:
            log.error("TTS request failed: %s", e)
            cb.sarvam_tts_breaker.record_failure()
            return b"", 0
        if r.status_code != 200:
            log.error("TTS %s: %s", r.status_code, r.text[:150])
            cb.sarvam_tts_breaker.record_failure()
            return b"", 0
        cb.sarvam_tts_breaker.record_success()
        wav = base64.b64decode(r.json()["audios"][0])
        with wave.open(io.BytesIO(wav), "rb") as wf:
            return wf.readframes(wf.getnframes()), wf.getframerate()


MAX_HISTORY_TURNS = 4  # matches the plan's own "4-turn cap" / "rolling 4-turn
                        # memory window" design — without this, s.history grows
                        # unbounded for the whole call and every turn re-sends
                        # the entire growing transcript to Gemini.


async def gemini_reply(history: list, system: str) -> str:
    # Only the last N turns go to the model — s.history itself is left
    # untouched by the caller so the full transcript is still available if
    # it's ever needed for call records later.
    trimmed = history[-(MAX_HISTORY_TURNS * 2):]
    contents = [{"role":"user" if m["role"]=="user" else "model",
                 "parts":[{"text":m["content"]}]} for m in trimmed]
    url = ("https://generativelanguage.googleapis.com/v1beta/models/"
           "gemini-2.5-flash:generateContent?key=" + GEMINI_KEY)

    if not cb.gemini_breaker.allow_request():
        log.warning("gemini_reply: circuit OPEN, skipping live call")
        return "క్షమించండి, technical issue."

    async with httpx.AsyncClient(timeout=30) as c:
        try:
            r = await c.post(url, headers={"Content-Type":"application/json"},
                json={"system_instruction":{"parts":[{"text":system}]},
                      "contents":contents,
                      "generationConfig":{
                          "maxOutputTokens":150,"temperature":0.7,
                          # BUGFIX (found live, 2026-07-02): Gemini 2.5 Flash
                          # has "thinking mode" ON by default. Without this,
                          # its internal reasoning ("(thinking) The user is
                          # asking about...") was being spoken verbatim to
                          # real callers instead of a natural reply — and
                          # synthesizing that much extra text drove some
                          # turns to 25+ SECONDS of TTS alone. thinkingBudget
                          # 0 disables it entirely; a receptionist doesn't
                          # need multi-step reasoning, it needs a fast,
                          # direct answer.
                          "thinkingConfig": {"thinkingBudget": 0},
                      }})
        except Exception as e:
            log.error("Gemini request failed: %s", e)
            cb.gemini_breaker.record_failure()
            return "క్షమించండి, technical issue."
        if r.status_code != 200:
            log.error("Gemini %s: %s", r.status_code, r.text[:200])
            cb.gemini_breaker.record_failure()
            return "క్షమించండి, technical issue."
        try:
            usage = r.json().get("usageMetadata", {})
            cached = usage.get("cachedContentTokenCount", 0)
            if cached:
                # Implicit caching (automatic on Gemini 2.5+, needs no code —
                # see MAX_HISTORY_TURNS docstring context) has started kicking
                # in, most likely once RAG context pushed a prompt past the
                # model's ~1024-token minimum. Worth knowing when it happens.
                log.info("gemini_reply: %d cached tokens (implicit caching active)", cached)
            parts = r.json()["candidates"][0]["content"]["parts"]
            # Defense-in-depth: even with thinkingBudget=0, explicitly drop
            # any part marked as a "thought" rather than trusting the budget
            # setting alone — a stray thought part reaching the caller is a
            # severe enough failure mode to guard against twice.
            reply = " ".join(
                p["text"] for p in parts if p.get("text") and not p.get("thought")
            ).strip()
            if not reply:
                raise KeyError("no non-thought text parts in response")
            cb.gemini_breaker.record_success()
            return reply
        except (KeyError, IndexError):
            cb.gemini_breaker.record_failure()
            return "క్షమించండి, మళ్ళీ చెప్పగలరా?"


async def lookup_voice_profile(did: str) -> Optional[dict]:
    """Real production routing: look up an active voice_profiles row by the
    number the caller dialed (`did`), NOT the caller's own number. This is
    how a provisioned client gets their own SKU/greeting/business context.
    Returns None if nothing's provisioned for that DID — callers fall back
    to lookup_tenant's demo-phone matching, which is a separate, unrelated
    flow used only for the single demo line.
    """
    if not did:
        return None
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            for col in ("did_number", "exotel_did"):
                r = await c.get(f"{SUPABASE_URL}/rest/v1/voice_profiles",
                    headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                    params={col: f"eq.{did}", "status": "eq.active",
                            "select": "id,tenant_id,profile_sku,business_name,open_time,"
                                      "close_time,open_days,services,appointment_types",
                            "limit": "1"})
                if r.status_code == 200 and r.json():
                    return r.json()[0]
        except Exception as e:
            log.warning("voice_profile lookup failed: %s", e)
    return None


async def lookup_tenant(caller: str) -> dict:
    caller_e164 = "+91" + "".join(c for c in (caller or "") if c.isdigit())[-10:]
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.get(f"{SUPABASE_URL}/rest/v1/tenants",
                headers={"apikey":SUPABASE_KEY, "Authorization":f"Bearer {SUPABASE_KEY}"},
                params={"demo_phone":f"eq.{caller_e164}", "is_demo":"eq.true",
                        "select":"id,name,business_type,greeting_text,voice_profile",
                        "limit":"1"})
            if r.status_code == 200 and r.json():
                return r.json()[0]
        except Exception as e:
            log.warning("tenant lookup failed: %s", e)
    return {"name":"Hey Nikki", "business_type":"general", "voice_profile":DEFAULT_VOICE}


# ─── Call row + recording persistence ─────────────────────
async def save_call_row(data: dict) -> Optional[str]:
    """Create a `calls` row. Returns the new row's id, or None on failure —
    never raises, a metadata-save failure must not break the live call."""
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.post(f"{SUPABASE_URL}/rest/v1/calls",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json", "Prefer": "return=representation"},
                json=data)
            if r.status_code in (200, 201) and r.json():
                return r.json()[0]["id"]
            log.warning("save_call_row %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("save_call_row failed: %s", e)
    return None


async def update_call_row(call_id: str, updates: dict):
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.patch(f"{SUPABASE_URL}/rest/v1/calls",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/json"},
                params={"id": f"eq.{call_id}"}, json=updates)
            if r.status_code >= 300:
                log.warning("update_call_row %s: %s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("update_call_row failed: %s", e)


async def upload_recording_blob(path: str, blob: bytes) -> bool:
    """Upload encrypted recording bytes to Supabase Storage. Bucket name is
    configurable via SUPABASE_RECORDINGS_BUCKET (defaults to 'recordings').
    Bucket must exist and be PRIVATE — encryption is defense-in-depth, not
    a substitute for access control."""
    bucket = os.getenv("SUPABASE_RECORDINGS_BUCKET", "recordings")
    async with httpx.AsyncClient(timeout=30) as c:
        try:
            r = await c.post(f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                         "Content-Type": "application/octet-stream", "x-upsert": "true"},
                content=blob)
            if r.status_code >= 300:
                log.warning("upload_recording_blob %s: %s", r.status_code, r.text[:200])
                return False
            return True
        except Exception as e:
            log.warning("upload_recording_blob failed: %s", e)
            return False


def _pcm8k_to_wav(pcm_8k: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(EXOTEL_SR)
        wf.writeframes(pcm_8k)
    return buf.getvalue()


def _encrypt_recording(wav_bytes: bytes, tenant_id: str, call_key: str) -> Optional[bytes]:
    """AES-256-GCM. Stored layout: [12-byte nonce][ciphertext + GCM tag].
    Key: JOVIO_RECORDING_KEY_<tenant_id> override if set, else the shared
    JOVIO_RECORDING_KEY. Must be a 32-byte key, base64-encoded in env."""
    if not _HAS_CRYPTO:
        log.error("cryptography not installed; skipping recording encryption")
        return None
    key_b64 = os.getenv(f"JOVIO_RECORDING_KEY_{tenant_id}") or os.getenv("JOVIO_RECORDING_KEY")
    if not key_b64:
        log.error("JOVIO_RECORDING_KEY not set; skipping recording")
        return None
    try:
        key = base64.b64decode(key_b64)
        if len(key) != 32:
            log.error("recording key must decode to 32 bytes, got %d", len(key))
            return None
        nonce = secrets.token_bytes(12)
        ciphertext = AESGCM(key).encrypt(nonce, wav_bytes, associated_data=call_key.encode())
        return nonce + ciphertext
    except Exception as e:
        log.error("recording encryption failed: %s", e)
        return None


async def finalize_call_recording(s: "Session", duration_s: int):
    """Runs after 'stop'. Encrypts + uploads the buffered call audio, then
    closes out the calls row. Never raises past this point — call teardown
    must not depend on Supabase or crypto succeeding."""
    tenant_id = s.tenant.get("id") or "unmatched"
    updates = {"status": "completed", "duration_seconds": duration_s}

    if s.recording_buf:
        try:
            wav_bytes = _pcm8k_to_wav(bytes(s.recording_buf))
            call_key = s.call_row_id or s.call_sid or "unknown"
            blob = _encrypt_recording(wav_bytes, str(tenant_id), str(call_key))
            if blob:
                path = f"recordings/{tenant_id}/{call_key}.wav.enc"
                if await upload_recording_blob(path, blob):
                    updates["recording_path"] = path
                    log.info("recording uploaded: %s (%d bytes raw -> %d bytes encrypted)",
                              path, len(wav_bytes), len(blob))
        except Exception as e:
            log.warning("finalize_call_recording: recording step failed: %s", e)
    else:
        log.info("finalize_call_recording: no audio buffered, skipping recording")

    if s.call_row_id:
        await update_call_row(s.call_row_id, updates)
    else:
        log.warning("finalize_call_recording: no call_row_id, call metadata not saved")

    # Outbound webhook — fires AFTER the call is fully finalized, never in
    # the critical path. tenant.get("id") is "unmatched" for the demo
    # fallback path (no real tenant), which dispatch_event treats as a
    # no-op rather than an error.
    await webhooks.dispatch_event(
        tenant_id=str(s.tenant.get("id") or ""),
        event="call.completed",
        payload={
            "call_id": s.call_row_id,
            "caller_number": s.caller,
            "duration_seconds": duration_s,
            "language": s.current_language,
            "recording_available": "recording_path" in updates,
            "transcript": s.history,
        },
    )

    # Appointment extraction — best-effort, at call end so it never touches
    # live-turn latency. Only writes a row if a real booking is detected;
    # on any failure it logs and writes nothing (a wrong record is worse
    # than a missing one). See appointments.extract_and_save.
    try:
        from datetime import datetime, timezone, timedelta
        # IST call date so "tomorrow" resolves against the caller's day.
        ist_now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
        await appointments.extract_and_save(s, ist_now.strftime("%Y-%m-%d"))
    except Exception as e:
        log.warning("appointment extraction skipped: %s", e)


def split_sentences(text: str) -> list:
    """Split a reply into sentence-sized chunks for pipelined TTS. Handles
    Telugu/Hindi/English sentence-ending punctuation (., !, ?, and the
    Devanagari danda ।, which Hindi text sometimes uses in place of a
    period). Keeps punctuation attached to its sentence for natural TTS
    prosody. Deliberately simple regex, not a full NLP tokenizer — replies
    are short (capped at 150 tokens) and conversational, so edge cases
    like decimal numbers splitting mid-sentence are low-risk here."""
    if not text:
        return []
    parts = re.split(r'(?<=[.!?।])\s+', text.strip())
    return [p.strip() for p in parts if p.strip()]


class Session:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.stream_sid = None
        self.call_sid = None
        self.caller = ""
        self.did = ""
        self.tenant = {}
        self.history = []
        self._sys = ""
        self.upsample_state = None
        self.downsample_state = None
        self.speech_buf = bytearray()
        self.silence_count = 0
        self.in_speech = False
        self.speaking_back = False
        self.socket_open = True
        self.recording_buf = bytearray()
        self.call_row_id: Optional[str] = None
        self.voice_profile_id: Optional[str] = None
        self.current_language: str = DEFAULT_LANGUAGE
        self.started_at: Optional[float] = None
        # Barge-in state. interrupt_flag is set by feed_caller_audio when the
        # caller speaks over Nikki's reply; send_pcm and speak_dynamic both
        # check it between frames/sentences and stop cleanly. barge_in_speech_ms
        # tracks how long the caller has been continuously above BARGE_IN_THRESHOLD,
        # so a single loud noise doesn't trigger a false interrupt.
        self.interrupt_flag = False
        self.barge_in_speech_ms = 0
        # "exotel" (default) or "widget" — see send_pcm and handle_widget_ws.
        # Everything else (VAD, STT, Gemini, TTS, barge-in, fillers,
        # language switching) is identical regardless of transport; only
        # how audio physically gets sent/received differs.
        self.transport = "exotel"
        # Which telephony provider's wire format this call uses ("exotel"
        # or "plivo"). Set by handle_exotel_ws from the endpoint. Audio
        # content is identical across providers; only the envelope differs.
        self.provider = "exotel"
        # Set only when this call was matched to a dispatched outbound
        # campaign recipient — see the outbound branch in handle_exotel_ws.
        self.outbound_recipient_id: Optional[str] = None

    async def send_pcm(self, pcm_bytes: bytes):
        """Send 16-bit PCM audio to the caller. Exotel needs its specific
        JSON media-event envelope with base64 + stream_sid; the widget
        transport is a raw binary WebSocket pipe with no envelope at all —
        nothing else about the pipeline (VAD, TTS, barge-in) differs."""
        if self.transport == "widget":
            FRAME = 3200
            for i in range(0, len(pcm_bytes), FRAME):
                if not self.socket_open:
                    return
                if self.interrupt_flag:
                    log.info("send_pcm: interrupt flag set, stopping playback mid-stream")
                    return
                chunk = pcm_bytes[i:i+FRAME]
                try:
                    await self.ws.send_bytes(chunk)
                except Exception as e:
                    log.info("send_pcm (widget) stopped: %s", e)
                    self.socket_open = False
                    return
            return

        # Telephony path (Exotel or Plivo): JSON envelope, base64, fixed
        # 100ms frames, paced in real-time since the provider expects audio
        # at playback speed. The envelope differs per provider (Exotel
        # "media" vs Plivo "playAudio") so it's produced by the provider
        # adapter rather than hard-coded. Audio bytes are identical either
        # way (L16 PCM 8kHz).
        adapter = providers.get_adapter(getattr(self, "provider", "exotel"))
        FRAME = 3200  # 100ms of 16-bit @ 8kHz
        for i in range(0, len(pcm_bytes), FRAME):
            if not self.socket_open:
                return
            if self.interrupt_flag:
                log.info("send_pcm: interrupt flag set, stopping playback mid-stream")
                return
            chunk = pcm_bytes[i:i+FRAME]
            if len(chunk) < FRAME:
                chunk = chunk + b"\x00" * (FRAME - len(chunk))
            try:
                await self.ws.send_text(adapter.encode_audio(chunk, self.stream_sid))
            except Exception as e:
                log.info("send_pcm stopped: %s", e)
                self.socket_open = False
                return
            await asyncio.sleep(0.095)  # 100ms pacing

    async def play_cached(self, key: str = "default"):
        path = os.path.join(CACHED_DIR, f"{key}.pcm")
        if not os.path.exists(path):
            log.error("no cached greeting at %s", path)
            path = os.path.join(CACHED_DIR, "default.pcm")
            if not os.path.exists(path):
                return
        self.speaking_back = True
        try:
            pcm = open(path, "rb").read()  # raw 16-bit PCM @ 8kHz, despite old var name below
            log.info("play_cached %s: %d bytes", key, len(pcm))
            self.recording_buf.extend(pcm)
            await self.send_pcm(pcm)
            log.info("play_cached done")
        finally:
            self.speaking_back = False

    async def play_random_filler(self):
        """Play a short conversational filler ("మ్మ్...", "అలాగా...") from
        the pre-cached set for the session's current language. Meant to
        run concurrently with a Gemini call — fills the 1-2 second thinking
        gap that would otherwise be dead silence. Silent no-op if the
        fillers directory doesn't exist (script not yet run for this env).

        Doesn't set speaking_back=True: fillers are so short they finish
        long before the real reply arrives, and holding speaking_back
        would suppress any legitimate caller barge-in during the reply
        that follows. speak_dynamic sets it itself when the real reply
        starts speaking."""
        filler_dir = os.path.join(CACHED_DIR, "fillers")
        if not os.path.isdir(filler_dir):
            return
        lang = self.current_language
        candidates = [f for f in os.listdir(filler_dir)
                      if f.startswith(f"{lang}_") and f.endswith(".pcm")]
        if not candidates:
            return
        chosen = random.choice(candidates)
        path = os.path.join(filler_dir, chosen)
        try:
            pcm = open(path, "rb").read()
            log.info("filler: %s (%d bytes)", chosen, len(pcm))
            self.recording_buf.extend(pcm)
            await self.send_pcm(pcm)
        except Exception as e:
            log.warning("filler playback failed: %s", e)


    async def _synthesize_sentence_pcm8k(self, text: str) -> Optional[bytes]:
        """Synthesize one sentence, ensure 8k PCM output. None on failure —
        caller skips that sentence rather than aborting the whole reply.
        Resamples only if Sarvam's actual returned rate isn't already
        8kHz — with speech_sample_rate=8000 requested, this is normally
        a no-op, but always checks the real rate rather than assuming."""
        pcm, actual_sr = await sarvam_tts(text, self.tenant.get("voice_profile", DEFAULT_VOICE),
                                           self.current_language)
        if not pcm:
            return None
        if actual_sr == EXOTEL_SR:
            return pcm
        pcm_8k, self.downsample_state = audioop.ratecv(
            pcm, 2, 1, actual_sr, EXOTEL_SR, self.downsample_state)
        return pcm_8k

    async def speak_dynamic(self, text: str):
        """Pipelined sentence-by-sentence TTS: sentence N+1 synthesizes
        WHILE sentence N is being sent to the caller, instead of waiting
        for the entire reply's audio before playing any of it. Added
        2026-07-02 after real per-turn latency measurements showed TTS
        averaging 64% of total turn time, dominated by longer multi-
        sentence replies (a 3-sentence reply waited for all 3 sentences'
        audio before playing the first word). This cuts the caller's wait
        to roughly (first sentence's TTS time) instead of (all sentences'
        TTS time combined) — the LLM call itself is unchanged, still one
        blocking request per turn.

        speaking_back is held True for the whole call (synthesis included,
        not just sending) — caller audio arriving while Nikki is about to
        speak shouldn't be treated as a fresh utterance.
        """
        if not text:
            return
        sentences = split_sentences(text)
        if not sentences:
            return
        try:
            log.info("speak_dynamic: %s", text[:60])
            self.speaking_back = True
            any_sent = False
            interrupted = False
            try:
                next_task = asyncio.create_task(
                    self._synthesize_sentence_pcm8k(sentences[0]))
                for i in range(len(sentences)):
                    if self.interrupt_flag:
                        # Barge-in fired between sentences. Cancel the
                        # in-flight synthesis for the next sentence (if any)
                        # so it doesn't waste an API call, then stop cleanly.
                        interrupted = True
                        if not next_task.done():
                            next_task.cancel()
                        break
                    pcm_8k = await next_task
                    if i + 1 < len(sentences):
                        next_task = asyncio.create_task(
                            self._synthesize_sentence_pcm8k(sentences[i + 1]))
                    if pcm_8k is None:
                        log.warning("speak_dynamic: sentence %d/%d TTS failed, skipping",
                                    i + 1, len(sentences))
                        continue
                    any_sent = True
                    self.recording_buf.extend(pcm_8k)
                    await self.send_pcm(pcm_8k)
                    # send_pcm returns early on interrupt_flag — check again
                    # after it so we don't kick off synthesis of a sentence
                    # we'll never send.
                    if self.interrupt_flag:
                        interrupted = True
                        if not next_task.done():
                            next_task.cancel()
                        break
            finally:
                self.speaking_back = False

            if interrupted:
                log.info("speak_dynamic: stopped early due to caller barge-in")
                return

            if not any_sent:
                # Every sentence failed — caller's heard nothing this turn.
                # Same fallback as before: a pre-cached clip, no live call needed.
                log.warning("speak_dynamic: all sentences failed TTS, playing cached fallback")
                await self.play_cached("technical_difficulty")
        except Exception as e:
            log.warning("speak_dynamic failed: %s", e)

    def feed_caller_audio(self, pcm_16k: bytes):
        try:
            rms = audioop.rms(pcm_16k, 2)
        except audioop.error:
            return None
        chunk_ms = int(len(pcm_16k) / 2 / PIPE_SR * 1000)

        if self.speaking_back:
            # Nikki is currently speaking. Watch for the caller talking
            # over the top — but require louder + more sustained speech
            # than the normal VAD threshold, because the caller's phone
            # mic can pick up echo of Nikki's own playback. Only trigger
            # the interrupt after BARGE_IN_MIN_MS of continuous loud speech,
            # so a single spike (car horn, cough) doesn't cut Nikki off.
            if rms > BARGE_IN_THRESHOLD:
                self.barge_in_speech_ms += chunk_ms
                if (self.barge_in_speech_ms >= BARGE_IN_MIN_MS
                        and not self.interrupt_flag):
                    log.info("barge-in detected: rms=%d ms=%d", rms, self.barge_in_speech_ms)
                    self.interrupt_flag = True
            else:
                # Non-speech chunk resets the counter — the caller must
                # speak *continuously* above threshold to interrupt, not
                # just briefly.
                self.barge_in_speech_ms = 0
            # Do not buffer speech for utterance-processing while Nikki
            # is still speaking. Once send_pcm / speak_dynamic notice the
            # interrupt flag, playback stops, speaking_back flips to False,
            # and this function's normal (non-playback) path takes over
            # for the caller's actual utterance.
            return None

        # Normal path: Nikki is not speaking, so any speech is a real
        # utterance to transcribe.
        is_speech = rms > VAD_THRESHOLD
        if is_speech:
            self.silence_count = 0
            if not self.in_speech:
                self.in_speech = True
                self.speech_buf = bytearray()
            self.speech_buf.extend(pcm_16k)
        else:
            if self.in_speech:
                self.speech_buf.extend(pcm_16k)
                self.silence_count += chunk_ms
                speech_ms = len(self.speech_buf) / 2 / PIPE_SR * 1000
                if self.silence_count >= SILENCE_MS and speech_ms >= MIN_SPEECH_MS:
                    self.in_speech = False
                    self.silence_count = 0
                    utt = bytes(self.speech_buf)
                    self.speech_buf = bytearray()
                    return utt
        return None


async def handle_exotel_ws(ws: WebSocket, provider: str = "exotel"):
    # `provider` selects the wire-format adapter. Defaults to "exotel" so the
    # existing /ws/exotel entry point behaves exactly as before. The Plivo
    # endpoint passes provider="plivo". All provider-specific message shaping
    # goes through `adapter`; everything else here is provider-neutral.
    adapter = providers.get_adapter(provider)
    log.info("INCOMING WS attempt (provider=%s)", adapter.name)
    await ws.accept()
    s = Session(ws)
    s.provider = adapter.name
    log.info("WS accepted")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            ev = msg.get("event")

            if ev == "connected":
                log.info("connected")

            elif ev == "start":
                info = adapter.parse_start(msg)
                s.stream_sid = info["stream_id"]
                s.call_sid = info["call_sid"]
                s.caller = info["caller"]
                s.did    = info["did"]
                s.started_at = time.time()
                log.info("start call=%s from=%s to=%s", s.call_sid, s.caller, s.did)

                async def _setup():
                    # Outbound correlation check FIRST — one fast, indexed
                    # lookup by call_sid. Deliberate trade-off: the original
                    # "play greeting instantly, before any DB call" fix
                    # (earlier today, fixed Exotel hanging up before Nikki
                    # said anything) is relaxed here by this one lookup's
                    # latency, in exchange for correctness — an outbound
                    # call's FIRST audio must legally be the TRAI automated-
                    # call disclosure, not a generic greeting, so we can't
                    # fire the greeting blind before knowing which call this is.
                    outbound_match = await ob.correlate_outbound_call(s.call_sid)

                    if outbound_match:
                        campaign = outbound_match.get("outbound_campaigns") or {}
                        s.tenant = {"id": outbound_match.get("tenant_id"),
                                    "name": "Outbound Campaign",
                                    "voice_profile": DEFAULT_VOICE}
                        s.voice_profile_id = campaign.get("voice_profile_id")
                        s._sys = build_outbound_prompt(
                            campaign.get("script") or "Introduce yourself and ask how you can help.",
                            first_name=outbound_match.get("first_name"))
                        s.outbound_recipient_id = outbound_match.get("id")
                        log.info("outbound call matched: recipient=%s campaign=%s",
                                 outbound_match.get("id"), outbound_match.get("campaign_id"))
                        await ob.mark_recipient_status(outbound_match["id"], "in_progress")
                        # TRAI-mandated disclosure, not the generic greeting —
                        # legally required first audio on an automated outbound call.
                        asyncio.create_task(s.play_cached("trai_disclosure_anushka"))
                    else:
                        # Normal inbound path — completely unchanged from before.
                        asyncio.create_task(s.play_cached("default"))
                        vp = await lookup_voice_profile(s.did)
                        if vp:
                            s.tenant = {
                                "id": vp.get("tenant_id"),
                                "name": vp.get("business_name") or "Nikki Client",
                                "voice_profile": SKU_VOICE.get(
                                    vp.get("profile_sku") or "standard", DEFAULT_VOICE),
                            }
                            s.voice_profile_id = vp.get("id")
                            s._sys = build_sku_prompt(vp)
                            log.info("voice profile matched: sku=%s business=%s",
                                     vp.get("profile_sku"), vp.get("business_name"))
                        else:
                            s.tenant = await lookup_tenant(s.caller)
                            s._sys = SYSTEM_PROMPT.format(
                                business_type=s.tenant.get("business_type","general"),
                                business_name=s.tenant.get("name","this business"))
                            log.info("tenant ready (demo fallback): %s", s.tenant.get("name"))

                    s.call_row_id = await save_call_row({
                        "tenant_id": s.tenant.get("id"),
                        "caller_number": s.caller,
                        "direction": "outbound" if outbound_match else "inbound",
                        "status": "active",
                        "exotel_call_sid": s.call_sid,
                    })
                    if s.call_row_id:
                        log.info("call row created: %s", s.call_row_id)
                asyncio.create_task(_setup())

            elif ev == "media":
                pcm_8k = adapter.parse_media(msg)
                if not pcm_8k:
                    continue
                s.recording_buf.extend(pcm_8k)
                pcm_16k, s.upsample_state = audioop.ratecv(
                    pcm_8k, 2, 1, EXOTEL_SR, PIPE_SR, s.upsample_state)
                utt = s.feed_caller_audio(pcm_16k)
                if utt is not None:
                    asyncio.create_task(_handle_utterance(s, utt))

            elif ev == "stop":
                log.info("stop call=%s", s.call_sid)
                s.socket_open = False
                duration = int(time.time() - s.started_at) if s.started_at else 0
                asyncio.create_task(finalize_call_recording(s, duration))
                break

    except WebSocketDisconnect:
        log.info("ws disconnect")
    except RuntimeError as e:
        if "not connected" in str(e) or "after sending" in str(e):
            log.info("ws closed: %s", e)
        else:
            log.exception("runtime: %s", e)
    except Exception as e:
        log.exception("handler: %s", e)
    finally:
        s.socket_open = False


async def handle_widget_ws(ws: WebSocket):
    """Website widget entry point — lets a visitor on jovio.in talk to
    Nikki directly through their browser microphone, no phone call
    needed. Reuses the exact same Session/VAD/STT/Gemini/TTS/barge-in/
    filler pipeline already built and tested for Exotel calls (this
    session, earlier today) — only the transport differs. If barge-in,
    fillers, or language switching work on the phone line, they work
    here too, for free.

    Protocol — deliberately simpler than Exotel's, since there's no
    telephony provider dictating the format:
      - Client sends raw 16-bit PCM mono @ 16kHz binary WS frames
        directly. This matches PIPE_SR exactly, so — unlike Exotel's
        8kHz, which needs upsampling — zero resampling happens on the
        input side.
      - Server sends raw 16-bit PCM mono @ 8kHz binary WS frames back
        (same audio speak_dynamic already produces for Exotel).
      - No JSON envelope, no base64, no stream_sid/call_sid — a plain
        binary audio pipe in both directions.

    Deliberately does NOT create a `calls` row or upload a recording —
    this is a public "try it now" demo surface on the marketing site,
    not a billable customer call. If widget conversations should show
    up in the dashboard/analytics later, that's a small, separate
    addition (wire up save_call_row/finalize_call_recording the same
    way handle_exotel_ws does).

    UNTESTED IN A REAL BROWSER as of this commit — the backend logic is
    tested the same way everything else today was (mocked WebSocket,
    verified message flow), but actual browser audio capture/playback
    behavior (autoplay policies, AudioContext quirks, mic permission
    flows) can only be verified by loading the widget in a real browser.
    See scripts/test_widget_local.html for a one-time manual verification
    page — run that before trusting this live on jovio.in.
    """
    log.info("INCOMING widget WS attempt")
    await ws.accept()
    s = Session(ws)
    s.transport = "widget"
    s.started_at = time.time()
    # Same demo persona heard on the phone line — a website visitor and a
    # phone caller should get a consistent first impression of Nikki.
    s.tenant = {"name": "Hey Nikki", "voice_profile": DEFAULT_VOICE}
    s._sys = SYSTEM_PROMPT.format(business_type="general", business_name="Hey Nikki")
    log.info("widget WS accepted")

    asyncio.create_task(s.play_cached("default"))

    try:
        while True:
            pcm_16k = await ws.receive_bytes()
            if not pcm_16k:
                continue
            utt = s.feed_caller_audio(pcm_16k)
            if utt is not None:
                asyncio.create_task(_handle_utterance(s, utt))
    except WebSocketDisconnect:
        log.info("widget ws disconnect")
    except RuntimeError as e:
        if "not connected" in str(e) or "after sending" in str(e):
            log.info("widget ws closed: %s", e)
        else:
            log.exception("widget runtime: %s", e)
    except Exception as e:
        log.exception("widget handler: %s", e)
    finally:
        s.socket_open = False


async def _handle_utterance(s: Session, pcm: bytes):
    t_start = time.time()
    # Fresh turn — clear any barge-in state left from the previous turn's
    # reply (which may have been interrupted mid-playback).
    s.interrupt_flag = False
    s.barge_in_speech_ms = 0
    try:
        text, detected_lang = await sarvam_stt(pcm)
        t_stt = time.time()
        if not text:
            return
        log.info("caller: %s", text)

        # Live language switching — only move to a language we actually
        # support and were confident enough to detect. Empty/unknown
        # detection keeps whatever language the session was already using,
        # rather than snapping back to the default mid-conversation.
        if detected_lang in LANGUAGE_NAMES and detected_lang != s.current_language:
            log.info("language switch: %s -> %s",
                      LANGUAGE_NAMES.get(s.current_language, s.current_language),
                      LANGUAGE_NAMES[detected_lang])
            s.current_language = detected_lang

        s.history.append({"role":"user","content":text})

        # Filler sound — fires immediately as a background task so it starts
        # playing to the caller within a few ms of STT completing, while RAG
        # + Gemini + first-sentence TTS all run in parallel. This is the
        # single biggest "feels human" change: instead of 1-2 seconds of
        # dead air after the caller finishes speaking, they hear a natural
        # acknowledgment sound within ~50ms.
        asyncio.create_task(s.play_random_filler())

        sys_for_turn = apply_language(s._sys, s.current_language)

        # RAG: only runs when a real voice_profile is provisioned (demo
        # fallback has none, so this is a no-op there). A failure at any
        # step inside retrieve_context just means no extra context for
        # this turn — never blocks or delays the call beyond the lookup.
        t_rag_start = time.time()
        if s.voice_profile_id:
            snippets = await knowledge.retrieve_context(s.voice_profile_id, text)
            if snippets:
                log.info("knowledge base: %d snippet(s) matched", len(snippets))
                sys_for_turn = knowledge.augment_prompt(sys_for_turn, snippets)
        t_rag = time.time()

        reply = await gemini_reply(s.history, sys_for_turn)
        t_llm = time.time()
        log.info("ai: %s", reply)
        s.history.append({"role":"assistant","content":reply})
        await s.speak_dynamic(reply)
        t_tts = time.time()

        # Real per-turn latency breakdown — this did not exist before today.
        # "total" is what the caller actually experiences: silence after
        # their sentence ends until Nikki's reply starts playing.
        log.info(
            "LATENCY turn: stt=%dms rag=%dms llm=%dms tts=%dms total=%dms",
            int((t_stt - t_start) * 1000),
            int((t_rag - t_rag_start) * 1000) if s.voice_profile_id else 0,
            int((t_llm - t_rag) * 1000),
            int((t_tts - t_llm) * 1000),
            int((t_tts - t_start) * 1000),
        )
    except Exception as e:
        log.exception("utterance failed: %s", e)
