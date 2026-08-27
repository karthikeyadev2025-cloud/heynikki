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

sys.path.insert(0, "/app")
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
