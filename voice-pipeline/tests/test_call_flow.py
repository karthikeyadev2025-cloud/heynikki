"""End-to-end call-flow checks that need no phone.

WHY THIS EXISTS
Every bug fixed in this system so far was found by a human placing a real
call: the transfer that never fired, the empty-STT crash that gave callers
silence, the persona that answered as a dental clinic, the DID that would
not route. Each was cheap to fix and expensive to find, and several were
regressions introduced while fixing the previous one.

These tests exercise the same code paths a call does — routing, intent,
prompt assembly, chunking, playback protocol — without dialling anything.
They are deliberately fast and offline where possible so they can run
before every deploy.

    docker exec heynikki-pipeline python3 -m pytest /app/tests -q

Anything needing the network is marked `live` and skipped by default:
    ... -m live      to include them
"""
import sys, os, asyncio, wave, io, struct
import pytest

# /app is where the container mounts the pipeline; the parent of tests/ is
# where it lives in the repo. Both, so the suite runs under docker exec AND
# under CI / a local checkout.
sys.path.insert(0, "/app")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402


# ── intent: the transfer bug ──────────────────────────────────────────────
# Trigger words were Latin while Sarvam returns Telugu script, so a caller
# saying "హ్యూమన్" three times was never transferred.
@pytest.mark.parametrize("said", [
    "హ్యూమన్", "Human", "ట్రాన్స్ఫర్ చేస్తా అన్నారు",
    "స్టాఫ్ కి ఇవ్వండి", "మనిషితో మాట్లాడాలి", "manager కావాలి",
])
def test_transfer_words_detected(said):
    agent = main.NikkiAgent({"profile_sku": "standard", "business_name": "X",
                             "tenant_id": "t", "id": "x"}, "999")
    assert agent._detect_intent(said) == "transfer", f"{said!r} must transfer"


@pytest.mark.parametrize("said", ["మీ price ఎంత?", "hello", "earrings ఉన్నాయా?"])
def test_ordinary_talk_is_not_a_transfer(said):
    agent = main.NikkiAgent({"profile_sku": "standard", "business_name": "X",
                             "tenant_id": "t", "id": "x"}, "999")
    assert agent._detect_intent(said) != "transfer"


# ── want_text: the silence bug ────────────────────────────────────────────
# on_speech(want_text=True) returned AUDIO on two paths, so _speech_chunks
# ran a regex over bytes, the turn died, and the caller got silence.
def test_empty_transcript_returns_text_not_bytes(monkeypatch):
    agent = main.NikkiAgent({"profile_sku": "standard", "business_name": "X",
                             "tenant_id": "t", "id": "x"}, "999")

    async def blank(_):
        return "   "
    monkeypatch.setattr(agent.stt, "transcribe", blank)
    out = asyncio.get_event_loop().run_until_complete(
        agent.on_speech(b"\x00" * 3200, want_text=True))
    assert isinstance(out, str) and out, "must be speakable text, never bytes"


def test_speak_chunked_rejects_bytes():
    assert main._speech_chunks("") == []
    # a wrong type must not raise — it cost a whole turn of silence before
    asyncio.get_event_loop().run_until_complete(
        main._speak_chunked(None, None, "uuid", b"\x00\x01", 1, {"until": 0}))


# ── chunking: the latency fix ─────────────────────────────────────────────
def test_first_chunk_is_short_and_whole_words():
    long_te = ("అలాగే కార్తీక్ గారు, మా దగ్గర necklaces, earrings, rings ఉన్నాయి "
               "మరియు ధరలు వెయ్యి నుంచి మూడు వేల వరకు ఉంటాయి, చెప్పండి.")
    chunks = main._speech_chunks(long_te)
    assert chunks, "must produce something to say"
    assert len(chunks[0]) <= 70, "first chunk drives time-to-first-audio"
    assert not chunks[0].endswith(" "), "never split mid-word"
    assert "".join(chunks).replace(" ", "") == long_te.replace(" ", ""), \
        "no words may be dropped"


def test_wav_duration_is_measured_not_guessed():
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(struct.pack("<8000h", *([0] * 8000)))
    assert abs(main._wav_duration_secs(b.getvalue()) - 1.0) < 0.01


# ── prompts: the dental-clinic bug ────────────────────────────────────────
def test_business_name_selects_the_right_persona():
    heynikki = main.build_system_prompt({"profile_sku": "standard",
                                         "business_name": "Hey Nikki"})
    jeweller = main.build_system_prompt({"profile_sku": "standard",
                                         "business_name": "Nila Everyday Jewellery"})
    assert "Hey Nikki itself" in heynikki
    assert "online jewellery brand" in jeweller
    # BOOKING_CONFIRMED is parsed only by browser_chat; on a phone call the
    # model would emit it and TTS would read it aloud.
    assert "BOOKING_CONFIRMED" not in heynikki
    assert "BOOKING_CONFIRMED" not in jeweller


def test_prompt_carries_no_hardcoded_price():
    # Pricing drifted into three different answers once. It now comes from
    # platform_config via the API, so no literal may creep back in.
    p = main.PROFILE_PROMPTS["heynikki"]
    for literal in ("5,999", "1,999", "9,999", "3.5"):
        assert literal not in p, f"{literal} must come from the catalogue"


def test_assistant_name_is_per_tenant():
    assert main._assistant_name({"display_name": "నిల"}) == "నిల"
    assert main._assistant_name({}) == "నిక్కి"


def test_greeting_recognises_a_returning_caller():
    prof = {"business_name": "Hey Nikki", "display_name": "నిక్కి"}
    first = main._greeting_text(prof, {})
    again = main._greeting_text(prof, {"previous_calls": 3})
    assert first != again, "a caller who rang before must not be greeted as new"
    assert "మళ్ళీ" in again


# ── spoken Telugu: what the caller's EAR gets ─────────────────────────────
# normalize_for_tts is the last thing between the model and bulbul. Every
# case below was a real defect: raw numerals read aloud, a mobile number
# said as one enormous number, and — worst — a wrong FACT, because the
# AM/PM marker was matched by the regex but never captured, so the day part
# was derived from a 12-hour number read as if it were 24-hour.

def test_pm_times_are_not_spoken_as_morning():
    # "9:00 PM" used to come out పొద్దున — telling a caller "morning" for
    # nine at night, stated as confidently as any correct fact.
    assert "రాత్రి" in main.normalize_for_tts("9:00 PM కి రండి")
    assert "పొద్దున" not in main.normalize_for_tts("9:00 PM కి రండి")
    # and 4:30 PM used to fall through every band to రాత్రి
    assert "సాయంత్రం" in main.normalize_for_tts("టైం 4:30 PM")
    # noon and midnight are the two the 12-hour conversion gets wrong if the
    # h==12 special cases are dropped
    assert "మధ్యాహ్నం" in main.normalize_for_tts("12:00 PM కి")
    assert "రాత్రి" in main.normalize_for_tts("12:30 AM కి")


def test_bare_times_still_read_as_before():
    # No meridiem: unchanged behaviour, a 24-hour reading.
    assert "పదిన్నర" in main.normalize_for_tts("రేపు 10:30 కి")


def test_no_numerals_survive_to_tts():
    for raw in ("రేపు 10:30 కి", "మీ నంబర్ 9848012345", "ఫీజు Rs 300"):
        out = main.normalize_for_tts(raw)
        assert not any(ch.isdigit() for ch in out), f"numeral reached TTS: {out}"


def test_phone_numbers_are_spoken_digit_by_digit():
    out = main.normalize_for_tts("మీ నంబర్ 9848012345")
    assert "సున్నా" in out, "zero must be సున్నా, not a digit"
    assert "," in out, "5-5 grouping needs a pause between the halves"


def test_money_is_not_doubled():
    # "మూడొందలు" already means three hundred; appending రూపాయలు produced
    # "మూడొందలు రూపాయలు", which needs the genitive to be grammatical.
    out = main.normalize_for_tts("ఫీజు Rs 300 అండి")
    assert "మూడొందలు" in out
    assert "మూడొందలు రూపాయలు" not in out


def test_long_numbers_get_separators():
    # bulbul's docs: >4 digits without separators may fail. The old rule
    # needed SEVEN digits, so every five- and six-digit price slipped past.
    assert "125,000" in main.normalize_for_tts("మొత్తం 125000 రూపాయలు")


# ── the hold sentinel ─────────────────────────────────────────────────────
# A caller who says "ఒక్క నిమిషం" wants silence. The model answers with the
# bare token SILENT; if that ever reaches TTS she says the English word
# "SILENT" at them, which is worse than the chatter it replaced.

@pytest.mark.parametrize("said", ["SILENT", "silent", " SILENT ", "SILENT.", "**SILENT**"])
def test_hold_sentinel_is_recognised(said):
    assert main._is_hold_sentinel(said)


@pytest.mark.parametrize("said", ["సరేనండి", "", "SILENT అండి", "ఒక్క నిమిషం ఆగండి"])
def test_real_replies_are_not_mistaken_for_the_sentinel(said):
    assert not main._is_hold_sentinel(said)


# ── the persona ───────────────────────────────────────────────────────────

def test_persona_carries_the_register_pack():
    p = main.TELUGU_PHONE_PERSONA
    assert "[EXAMPLES" in p, "few-shots encode register better than rules"
    assert "SILENT" in p, "the hold sentinel must be taught, not assumed"
    # The examples must stay fact-free: this persona is shared by every
    # tenant, and a concrete price or opening hour here resurfaces in some
    # other business's call as a confidently wrong fact.
    start = p.index("[EXAMPLES")
    # Just the examples block — the sections after it legitimately mention a
    # "10-digit number".
    nxt = p.find("\n\n[", start)
    ex = p[start:nxt if nxt != -1 else len(p)]
    assert not any(ch.isdigit() for ch in ex), f"no numbers in the shared examples: {ex}"


def test_call_centre_phrase_is_banned_everywhere():
    # Scoped to openers, the ban was obeyed literally: the newer models just
    # moved the phrase to the END of the reply instead.
    p = main.TELUGU_PHONE_PERSONA
    i = p.index("మీకు ఎలా సహాయం చేయగలను")
    assert "BANNED everywhere" in p[max(0, i - 200):i + 200]


# ── live: needs the network ───────────────────────────────────────────────
@pytest.mark.live
def test_dids_route_to_the_right_business():
    async def go():
        db = main.SupabaseClient()
        # dids.status must be 'assigned' — any other value never reaches a caller
        return (await db.get_voice_profile("8633502031"),
                await db.get_voice_profile("8633502032"))
    a, b = asyncio.get_event_loop().run_until_complete(go())
    assert a and a["business_name"] == "Hey Nikki"
    assert b and "Nila" in b["business_name"]
