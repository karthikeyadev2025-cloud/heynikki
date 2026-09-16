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
import sys, os, time, asyncio, wave, io, struct
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


# ── the GEMINI_MODEL guard ────────────────────────────────────────────────
# The env var lives in Railway, outranks the code default, and outlived the
# model it named: production was pinned to gemini-flash-latest, which thinks
# before answering and therefore returns replies cut off mid-word at our
# 300-token budget. A caller-visible fault set by an env var should not
# survive a deploy silently.

def test_broken_models_are_refused(monkeypatch):
    for bad in ("gemini-flash-latest", "gemini-3.5-flash", "gemini-3.6-flash",
                "gemini-2.5-flash", "gemini-2.0-flash-exp"):
        monkeypatch.setenv("GEMINI_MODEL", bad)
        assert main.resolve_gemini_model() == main.GEMINI_DEFAULT_MODEL, bad


def test_unset_uses_the_measured_default(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    assert main.resolve_gemini_model() == main.GEMINI_DEFAULT_MODEL


def test_unknown_models_are_still_honoured(monkeypatch):
    # The guard refuses a known-broken list, it does not whitelist. A model
    # released after this code was written must still be settable without a
    # deploy — otherwise the guard becomes the next thing blocking an upgrade.
    monkeypatch.setenv("GEMINI_MODEL", "gemini-9-flash-lite")
    assert main.resolve_gemini_model() == "gemini-9-flash-lite"


def test_the_refusal_is_logged_once_not_every_turn(monkeypatch, caplog=None):
    # resolve_gemini_model() runs on every LLM call. Logging CRITICAL per
    # caller utterance would bury the incidents that level exists for.
    import logging as _logging
    monkeypatch.setattr(main, "_gemini_warned_for", "")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-flash-latest")
    seen = []
    handler = _logging.Handler()
    handler.emit = lambda rec: seen.append(rec) if rec.levelno >= _logging.CRITICAL else None
    main.log.addHandler(handler)
    try:
        for _ in range(5):
            main.resolve_gemini_model()
    finally:
        main.log.removeHandler(handler)
    assert len(seen) == 1, f"expected one CRITICAL for five calls, got {len(seen)}"


def test_the_chosen_model_passes_its_own_guard():
    assert main.GEMINI_DEFAULT_MODEL not in main._GEMINI_REFUSED


# ── the date Nikki says vs the date she books ─────────────────────────────
# The pipeline image sets no TZ, so datetime.now() is UTC. Between 18:30 and
# 24:00 UTC — 00:00 to 05:30 IST — that is yesterday's date in India. The
# prompt used naive now() while the appointment extractor used UTC+5:30, so a
# call in that window had Nikki say "tomorrow, the 3rd" and book the 4th.
# Real occurrence: the 02:26 IST call from 8885490495 on 2026-09-02.

def test_prompt_date_is_ist_not_container_local():
    from datetime import datetime, timezone, timedelta
    expected = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
    p = main.build_system_prompt({"business_name": "X", "tenant_id": "t", "id": "i"})
    assert expected in p, f"prompt must carry the IST date {expected}"


def test_prompt_weekday_matches_the_ist_date():
    # A weekday from a different day than the date is how a caller gets told
    # the clinic is open on a day it is shut.
    from datetime import datetime, timezone, timedelta
    ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    p = main.build_system_prompt({"business_name": "X", "tenant_id": "t", "id": "i"})
    assert ist.strftime("%A") in p


def test_one_definition_of_today():
    # Both callers go through _now_ist(); a second naive datetime.now() for a
    # caller-facing date is how the two drifted apart in the first place.
    import inspect
    src = inspect.getsource(main.build_system_prompt)
    assert "_now_ist()" in src
    assert "datetime.now()" not in src, "naive now() is container-local, i.e. UTC"


# ── promises she cannot keep ──────────────────────────────────────────────
# On call d3b61bf3 a caller asked "location share చేస్తారా?" and she answered
# "ఖచ్చితంగా మీ నంబర్‌కి వాట్సాప్‌లో లొకేషన్ పంపిస్తానండి" — definitely, I will
# send it. Nothing can send a location: the only templates are appointment
# confirmation, missed-call follow-up and the brochure. He is still waiting.

def test_persona_lists_what_she_cannot_send():
    p = main.TELUGU_PHONE_PERSONA
    assert "cannot send" in p.lower() or "CANNOT" in p
    for thing in ("location pin", "photo", "email"):
        assert thing in p, f"{thing} must be named — a vague ban is ignored"


def test_persona_blocks_the_whatsapp_loophole():
    # Told only "do not promise to send", the model offered to send the same
    # things "on WhatsApp" instead, which is not a capability either.
    assert "on WhatsApp" in main.TELUGU_PHONE_PERSONA


def test_persona_forbids_talking_about_a_system():
    # "ఈ సిస్టమ్ ద్వారా కుదరదు" is a machine explaining itself, not a
    # receptionist declining. It breaks the illusion at the worst moment.
    p = main.TELUGU_PHONE_PERSONA
    assert "system or" in p and "software" in p


# ── per-tenant language ───────────────────────────────────────────────────
# MUSKAN CLINIC is in Uttar Dinajpur, West Bengal, and was answered in
# Telugu. The model knew: it opened call d3b61bf3 with "নమస్కారం", a Bengali
# ন on a Telugu word, which bulbul cannot say.

def test_language_defaults_to_telugu_before_the_migration():
    # The column does not exist yet on a live DB, so every profile arrives
    # without the key. Nothing may change until it does.
    assert main._tenant_lang({}) == "te-IN"
    assert main._tenant_lang(None) == "te-IN"
    assert main._tenant_lang({"language": ""}) == "te-IN"


def test_unknown_language_falls_back_rather_than_breaking_a_call():
    assert main._tenant_lang({"language": "fr-FR"}) == "te-IN"


def test_telugu_keeps_the_researched_register_pack():
    assert main._persona_for("te-IN") is main.TELUGU_PHONE_PERSONA


def test_other_languages_do_not_get_the_telugu_pack():
    # Serving Telugu honorifics and Telugu number words to a Bengali caller
    # is worse than the neutral persona, not better.
    for lang in ("bn-IN", "hi-IN", "en-IN"):
        p = main._persona_for(lang)
        assert p is not main.TELUGU_PHONE_PERSONA
        assert main.LANG_NAMES[lang] in p
        assert "గారు" not in p, f"{lang} must not carry Telugu honorifics"


def test_greeting_is_in_the_tenants_language():
    # The greeting is spoken verbatim and never passes through the model, so
    # a Telugu string would reach a Bengali voice unchanged.
    prof = {"business_name": "MUSKAN CLINIC"}
    assert "নমস্কার" in main._greeting_text({**prof, "language": "bn-IN"}, {})
    assert "नमस्ते"  in main._greeting_text({**prof, "language": "hi-IN"}, {})
    assert "Hello"   in main._greeting_text({**prof, "language": "en-IN"}, {})
    assert "హలో"     in main._greeting_text(prof, {})


def test_telugu_number_words_never_reach_another_language():
    # normalize_for_tts writes పదిన్నర / మూడొందలు / సున్నా. Splicing those into
    # a Bengali sentence produces something no speaker can parse.
    tel = main.normalize_for_tts("రేపు 10:30 కి, ఫీజు Rs 300", lang="te-IN")
    assert "పదిన్నర" in tel and "మూడొందలు" in tel
    ben = main.normalize_for_tts("কাল 10:30 এ, ফি Rs 300", lang="bn-IN")
    assert "పదిన్నర" not in ben and "మూడొందలు" not in ben


def test_long_numbers_still_get_separators_in_every_language():
    for lang in ("te-IN", "bn-IN", "hi-IN", "en-IN"):
        assert "125,000" in main.normalize_for_tts("total 125000", lang=lang)


# ── ending the call after a booking ───────────────────────────────────────
# A caller whose appointment is booked, and Nikki, were both sitting on an
# open line waiting for the other to give up. The model now marks the end;
# the code decides whether to honour it.

@pytest.mark.parametrize("said", [
    "సరేనండి, మంచిది END_CALL", "సరేనండి, మంచిది [END_CALL]",
    "ఉంటానండి. <END_CALL>",     "సరేనండి, END CALL",
    "సరేనండి, end-call",        "సరేనండి **END_CALL**",
])
def test_end_sentinel_is_recognised_and_stripped(said):
    text, end = main._split_end_sentinel(said)
    assert end
    # It must never survive into speech: bulbul would say "END CALL" in
    # English to someone who just booked an appointment.
    assert "END" not in text.upper()
    assert text.strip(), "the closing line itself must still be spoken"


@pytest.mark.parametrize("said", [
    "మీ పేరు చెప్తారా?", "సరేనండి, థాంక్యూ అండి", "",
    "END_CALL అయ్యాక చెప్తాను",   # mid-sentence, not a sentinel
])
def test_ordinary_replies_do_not_end_the_call(said):
    text, end = main._split_end_sentinel(said)
    assert not end
    assert text == said


def test_both_personas_teach_the_sentinel():
    for lang in ("te-IN", "bn-IN"):
        p = main._persona_for(lang)
        assert "END_CALL" in p, f"{lang} persona must teach it"
        assert "CONFIRMED" in p, f"{lang} must gate it on a confirmed booking"


# ── the caller's number is already known ──────────────────────────────────
# Call 00ed83a6 came from 6303076432 and she asked for the number anyway.
# STT heard "30 3076432", she read back a hallucinated "8328199 62", and
# after five more attempts she transferred to a human. Two of three minutes,
# on a number the network had handed us before she said hello.

@pytest.mark.parametrize("raw,want", [
    ("6303076432", "6303076432"), ("06303076432", "6303076432"),
    ("+916303076432", "6303076432"), ("919492013766", "9492013766"),
])
def test_caller_id_is_normalised(raw, want):
    assert main._valid_mobile(raw) == want


@pytest.mark.parametrize("raw", [None, "", "12345", "anonymous", "5551234567"])
def test_withheld_or_bogus_caller_id_falls_back(raw):
    # No number means the old behaviour: ask. Confirming a number nobody has
    # is worse than asking for one. 555... fails the Indian mobile 6-9 rule.
    assert main._valid_mobile(raw) is None


def test_phone_slot_is_seeded_from_caller_id():
    a = main.NikkiAgent({"business_name": "X", "tenant_id": "t", "id": "i"}, "6303076432")
    assert a.slots["phone"] == "6303076432"


def test_phone_slot_stays_empty_for_a_withheld_number():
    a = main.NikkiAgent({"business_name": "X", "tenant_id": "t", "id": "i"}, "anonymous")
    assert a.slots["phone"] is None


def test_facts_block_tells_her_not_to_ask():
    a = main.NikkiAgent({"business_name": "X", "tenant_id": "t", "id": "i"}, "6303076432")
    f = a._known_facts_block()
    assert "6303076432" in f
    assert "NEVER ask" in f


def test_facts_block_says_nothing_when_the_number_is_withheld():
    a = main.NikkiAgent({"business_name": "X", "tenant_id": "t", "id": "i"}, "")
    assert "CALLING FROM" not in a._known_facts_block()


def test_both_personas_forbid_asking_and_forbid_question_plus_close():
    for lang in ("te-IN", "bn-IN"):
        p = main._persona_for(lang)
        assert "NEVER ask them to read it out" in p
        # Asking and hanging up in one breath leaves a caller answering a
        # dead line — seen in testing before this rule existed.
        assert "same reply as your closing line" in p


# ── register enforcement ──────────────────────────────────────────────────
# The persona banned స్వాగతం and "మీకు ఎలా సహాయం చేయగలను" long before call
# 00ed83a6, whose greeting used BOTH in one sentence. A prompt rule is a
# tendency. These tests are the guarantee.

def test_the_exact_greeting_that_broke_the_rules():
    said = "అలాగే నమస్తే అండి, Bismillah Clinic కి స్వాగతం. చెప్పండి, మీకు ఎలా సహాయం చేయగలను?"
    out, hits = main._enforce_register(said)
    assert "స్వాగతం" not in out
    assert "ఎలా సహాయం" not in out
    assert "Bismillah Clinic" in out, "the business name must survive"
    assert len(hits) == 2


def test_substitution_seams_do_not_stutter():
    # A replacement lands beside text that already said the same thing.
    # bulbul would read each of these twice.
    out, _ = main._enforce_register("చెప్పండి, మీకు ఎలా సహాయం చేయగలను?")
    assert out.count("చెప్పండి") == 1
    out2, _ = main._enforce_register("వైద్యుడు గారు ఉంటారు.")
    assert "గారు గారు" not in out2


@pytest.mark.parametrize("bad,gone", [
    ("ధన్యవాదములు అండి", "ధన్యవాదములు"),
    ("మీ నియామకం", "నియామకం"),
    ("దయచేసి వేచి ఉండండి", "దయచేసి"),
    ("తెలియజేయండి", "తెలియజేయండి"),
    ("సందర్శించండి", "సందర్శించండి"),
])
def test_official_register_is_removed(bad, gone):
    out, hits = main._enforce_register(bad)
    assert gone not in out and hits


@pytest.mark.parametrize("ok", [
    "సరేనండి, రేపు అపాయింట్‌మెంట్ పెట్టానండి. మీ పేరు చెప్తారా?",
    "నమస్కారం, డాక్టర్ గారు ఉన్నారండి.",
    "అదండీ... డాక్టర్ గారు చూశాకే చెప్పగలరండి.",
])
def test_good_replies_are_left_alone(ok):
    out, hits = main._enforce_register(ok)
    assert out == ok and not hits


def test_filter_is_telugu_only():
    # These are Telugu strings; running them over Bengali or Hindi would
    # corrupt a reply in a language they have nothing to do with.
    for lang in ("bn-IN", "hi-IN", "en-IN"):
        out, hits = main._enforce_register("আপনাকে স্বাগতম", lang)
        assert out == "আপনাকে স্বাগতম" and not hits


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


# ── widget sessions survive the second worker ─────────────────────────────
# The pipeline runs `uvicorn --workers 2`. A phone call is a WebSocket
# pinned to one worker, but every widget turn is a separate HTTP POST that
# either worker may accept — so session state held in a process-local dict
# was lost on roughly every other turn. These tests pin the contract that
# replaced it: the store is on disk, shared, and survives a different
# process reading it.
@pytest.fixture
def widget_dir(tmp_path, monkeypatch):
    d = tmp_path / "widgetsessions"
    monkeypatch.setattr(main, "_WIDGET_DIR", str(d))
    return str(d)


def test_widget_history_survives_a_different_process(widget_dir):
    """The actual two-worker bug: worker A answers turn 1, worker B answers
    turn 2. B must see what the visitor told A."""
    import subprocess
    # Worker A — a genuinely separate interpreter, not another function call.
    child = subprocess.run(
        [sys.executable, "-c",
         "import os,sys; sys.path.insert(0, os.environ['PIPE_DIR']);"
         "import main;"
         "main._WIDGET_DIR = os.environ['WDIR'];"
         "main._widget_save('visitor-1', [{'role':'user','content':'నా పేరు రమేష్'},"
         "{'role':'assistant','content':'చెప్పండి రమేష్ గారు'}], 2)"],
        env={**os.environ, "WDIR": widget_dir,
             "PIPE_DIR": os.path.dirname(os.path.abspath(main.__file__))},
        capture_output=True, text=True, timeout=120,
    )
    assert child.returncode == 0, child.stderr[-2000:]

    # Worker B — this process, which never saw that conversation.
    history, total = main._widget_load("visitor-1")
    assert total == 2
    assert [h["content"] for h in history] == ["నా పేరు రమేష్", "చెప్పండి రమేష్ గారు"]


def test_widget_unknown_session_is_empty(widget_dir):
    assert main._widget_load("never-seen") == ([], 0)


def test_widget_session_id_cannot_escape_the_directory(widget_dir):
    """session_id arrives in an unauthenticated POST body. It is hashed, so
    a traversal attempt writes one file inside the store and nothing else."""
    main._widget_save("../../../../tmp/pwned", [{"role": "user", "content": "x"}], 1)
    assert not os.path.exists("/tmp/pwned")
    names = os.listdir(widget_dir)
    assert len(names) == 1 and names[0].endswith(".json")
    # and it still round-trips
    assert main._widget_load("../../../../tmp/pwned")[1] == 1


def test_widget_expired_session_reads_empty(widget_dir):
    main._widget_save("stale", [{"role": "user", "content": "x"}], 1)
    p = main._widget_path("stale")
    old = time.time() - main._WIDGET_TTL - 60
    os.utime(p, (old, old))
    assert main._widget_load("stale") == ([], 0)


def test_widget_corrupt_file_reads_empty_not_raises(widget_dir):
    """A half-written file must cost this visitor their context, not the
    reply — the turn still has to be answered."""
    os.makedirs(widget_dir, exist_ok=True)
    with open(main._widget_path("broken"), "w") as f:
        f.write('{"history": [{"role"')
    assert main._widget_load("broken") == ([], 0)


def test_widget_history_is_capped_but_turn_number_is_not(widget_dir):
    """A long session trims its stored history; `total` is what the turn
    number is derived from, so it must keep counting past the cap."""
    long_history = [{"role": "user", "content": str(i)} for i in range(200)]
    main._widget_save("chatty", long_history, 200)
    history, total = main._widget_load("chatty")
    assert len(history) == main._WIDGET_KEEP
    assert total == 200
    # the tail is what was kept — the LLM reads the most recent turns
    assert history[-1]["content"] == "199"


def test_widget_sweep_removes_expired_and_keeps_live(widget_dir):
    main._widget_save("live-one", [{"role": "user", "content": "a"}], 1)
    main._widget_save("dead-one", [{"role": "user", "content": "b"}], 1)
    dead = main._widget_path("dead-one")
    old = time.time() - main._WIDGET_TTL - 60
    os.utime(dead, (old, old))
    main._widget_sweep()
    assert not os.path.exists(dead)
    assert os.path.exists(main._widget_path("live-one"))


# ── the internal-secret guard ─────────────────────────────────────────────
# INTERNAL_SECRET protects inbound call routing, the FreeSWITCH hangup hook
# and recording presign/purge. It used to default to a fixed string that was
# public in this repository, so a deploy that forgot the variable was
# "protected" by a value anyone could read — and looked exactly like a
# deploy that was not.
def test_internal_secret_has_no_default():
    """Whatever the process is running with, it must have come from the
    environment. A literal default here is the bug this replaced."""
    assert main.INTERNAL_SECRET == os.environ["INTERNAL_SECRET"]
    assert main.INTERNAL_SECRET.strip()


def test_internal_ok_accepts_the_real_secret():
    assert main._internal_ok(main.INTERNAL_SECRET) is True


@pytest.mark.parametrize("bad", [
    None,                                  # header absent entirely
    "",                                    # header present but blank
    "nikki-internal-secret-change-me",     # the old hardcoded default
    "heynikki-internal-2026-change-for-production",   # the old .env.ec2 one
    "wrong",
])
def test_internal_ok_rejects_everything_else(bad):
    assert main._internal_ok(bad) is False


def test_internal_ok_rejects_a_prefix_of_the_secret():
    """A length-only or prefix match must not pass — the digest comparison
    is what makes both of those indistinguishable from any other miss."""
    assert main._internal_ok(main.INTERNAL_SECRET[:-1]) is False
    assert main._internal_ok(main.INTERNAL_SECRET + "x") is False


def test_pipeline_refuses_to_start_without_the_secret():
    """The whole point: no INTERNAL_SECRET, no process. Checked in a child
    interpreter because the import has already succeeded in this one."""
    import subprocess
    env = {k: v for k, v in os.environ.items() if k != "INTERNAL_SECRET"}
    env["PIPE_DIR"] = os.path.dirname(os.path.abspath(main.__file__))
    child = subprocess.run(
        [sys.executable, "-c",
         "import os,sys; sys.path.insert(0, os.environ['PIPE_DIR']); import main"],
        env=env, capture_output=True, text=True, timeout=120,
    )
    assert child.returncode != 0, "pipeline started with no INTERNAL_SECRET"
    assert "INTERNAL_SECRET" in child.stderr


# ── the /api/test/* routes spend money ────────────────────────────────────
# They call Sarvam and Gemini on the platform's own keys, and had no auth at
# all while every other operational route required X-Internal-Secret. nginx
# proxies all of /api/ on pipeline.heynikki.in to this app, so they were an
# open tap for anyone who found them.
def _route_for(path: str):
    for r in main.app.routes:
        if getattr(r, "path", None) == path:
            return r
    raise AssertionError(f"route {path} not registered")


@pytest.mark.parametrize("path", [
    "/api/test/tts", "/api/test/llm", "/api/test/full",
])
def test_money_spending_test_routes_require_the_internal_secret(path):
    """The header must be a declared parameter of the handler — without it
    the route cannot reject anything, however the body is validated."""
    import inspect
    fn = _route_for(path).endpoint
    assert "x_internal_secret" in inspect.signature(fn).parameters, \
        f"{path} takes no internal-secret header"
    src = inspect.getsource(fn)
    assert "_internal_ok(x_internal_secret)" in src, f"{path} never checks it"
    assert "401" in src, f"{path} does not reject an unauthorised caller"


def test_every_pipeline_api_route_is_authenticated_or_deliberately_public():
    """A new /api/ route that forgets the header should fail here rather than
    on a credit-card statement. The public entries are the landing-page
    widget (unauthenticated by design, rate-limited at nginx) and the
    fetch/presign pair, which carry their own token checks."""
    PUBLIC = {
        "/api/v1/browser/chat",          # public widget, by design
        "/api/v1/browser/save-booking",  # public widget, by design
    }
    import inspect
    unguarded = []
    for r in main.app.routes:
        p = getattr(r, "path", "")
        if not p.startswith("/api/") or p in PUBLIC:
            continue
        fn = getattr(r, "endpoint", None)
        if fn is None:
            continue
        try:
            src = inspect.getsource(fn)
        except OSError:
            continue
        if "_internal_ok" not in src and "token" not in src.lower():
            unguarded.append(p)
    assert not unguarded, f"unauthenticated /api/ routes: {unguarded}"
