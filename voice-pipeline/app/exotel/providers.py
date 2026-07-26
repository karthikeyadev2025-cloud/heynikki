"""
Telephony provider adapter.

WHY THIS EXISTS
The voice pipeline was written against Exotel's WebSocket audio protocol,
with the message shapes hard-coded inline in bridge.py. Adding Plivo (faster
number provisioning, cleaner API) without this layer would mean either
forking bridge.py per provider, or littering it with `if provider == ...`
branches. Both rot fast.

Instead, every place the two providers differ is isolated here, behind a
tiny interface. bridge.py speaks in provider-neutral terms ("a call started",
"here's caller audio", "play this audio back", "stop playback"); each adapter
translates that to/from the wire format its provider uses.

DELIBERATELY ADDITIVE — ZERO RISK TO EXOTEL
The Exotel path that works in production today is preserved byte-for-byte as
ExotelAdapter. Nothing about the live inbound flow changes. Plivo is a NEW
adapter selected only when a call arrives on the /ws/plivo endpoint. If the
Plivo adapter has a bug, it can only affect Plivo calls — Exotel is untouched.

PROTOCOL DIFFERENCES (verified against Plivo docs, 2026-07):
                    Exotel                  Plivo
  inbound audio     event=media             event=media
                    media.payload (b64)     media.payload (b64)
  outbound audio    event=media             event=playAudio
                    media.payload           media.{contentType,sampleRate,payload}
  interrupt         (drop frames)           event=clearAudio
  stream id         stream_sid (top level)  start.streamId
  caller/callee     start.custom_parameters start.extraHeaders / start.from,to
  audio format      L16 PCM 8kHz            L16 PCM 8kHz  (audio/x-l16)

The audio ENCODING is identical (raw 16-bit PCM mono @ 8kHz), so no
resampling or mu-law conversion is added for Plivo — the bytes
speak_dynamic already produces go out unchanged. Only the JSON envelope
differs.

TESTING STATUS
ExotelAdapter: in production, proven.
PlivoAdapter: written against Plivo's published protocol but NOT yet tested
against a real Plivo call (the sandbox can't place calls). The message
shapes match the docs; first real call must be watched closely. Kept behind
its own endpoint precisely so this uncertainty can't touch Exotel.
"""
import base64
import json
import logging

log = logging.getLogger("exotel-bridge")


class ProviderAdapter:
    """Neutral interface bridge.py talks to. Each provider subclasses this."""
    name = "base"

    def parse_start(self, msg: dict) -> dict:
        """Given a provider 'start' message, return a normalized dict:
        { stream_id, call_sid, caller, did }. Missing fields -> "" ."""
        raise NotImplementedError

    def parse_media(self, msg: dict) -> bytes | None:
        """Given a provider inbound message, return raw PCM bytes if it's an
        audio frame, else None. Caller has already checked event type."""
        raise NotImplementedError

    def encode_audio(self, pcm_chunk: bytes, stream_id: str) -> str:
        """Given a raw PCM chunk, return the JSON text frame to send back
        so the provider plays it to the caller."""
        raise NotImplementedError

    def encode_clear(self, stream_id: str) -> str | None:
        """Return a JSON text frame that interrupts/flushes buffered
        playback, or None if the provider has no such control (in which
        case bridge.py falls back to just not sending more frames)."""
        return None


class ExotelAdapter(ProviderAdapter):
    """Exactly the wire format the production Exotel path uses today.
    Do not change without re-testing a live Exotel call."""
    name = "exotel"

    def parse_start(self, msg: dict) -> dict:
        start = msg.get("start", {})
        cp = start.get("custom_parameters") or {}
        return {
            "stream_id": msg.get("stream_sid") or start.get("stream_sid") or "",
            "call_sid":  start.get("call_sid", ""),
            "caller":    cp.get("From") or start.get("from") or "",
            "did":       cp.get("To")   or start.get("to")   or "",
        }

    def parse_media(self, msg: dict) -> bytes | None:
        payload = msg.get("media", {}).get("payload", "")
        if not payload:
            return None
        return base64.b64decode(payload)

    def encode_audio(self, pcm_chunk: bytes, stream_id: str) -> str:
        return json.dumps({
            "event": "media",
            "stream_sid": stream_id,
            "media": {"payload": base64.b64encode(pcm_chunk).decode()},
        })

    # Exotel: interruption is handled by simply ceasing to send frames.
    # (bridge.py's interrupt_flag already does this.) No clear event.


class PlivoAdapter(ProviderAdapter):
    """Plivo bidirectional Audio Streaming. Same L16/8kHz audio as Exotel,
    different JSON envelope. Verified against Plivo docs; unproven on a
    real call — see module docstring."""
    name = "plivo"

    def parse_start(self, msg: dict) -> dict:
        start = msg.get("start", {})
        # Plivo passes custom data via extraHeaders (parsed to a dict by
        # Plivo) and exposes from/to on the start object.
        eh = start.get("extraHeaders") or start.get("extra_headers") or {}
        if isinstance(eh, str):
            eh = _parse_extra_headers(eh)
        return {
            "stream_id": start.get("streamId") or start.get("stream_id")
                         or msg.get("streamId") or "",
            "call_sid":  start.get("callId") or start.get("call_id")
                         or start.get("callUUID") or "",
            "caller":    eh.get("From") or start.get("from") or "",
            "did":       eh.get("To")   or start.get("to")   or "",
        }

    def parse_media(self, msg: dict) -> bytes | None:
        payload = msg.get("media", {}).get("payload", "")
        if not payload:
            return None
        return base64.b64decode(payload)

    def encode_audio(self, pcm_chunk: bytes, stream_id: str) -> str:
        # audio/x-l16 == raw 16-bit linear PCM, exactly what we already have.
        return json.dumps({
            "event": "playAudio",
            "media": {
                "contentType": "audio/x-l16",
                "sampleRate": 8000,
                "payload": base64.b64encode(pcm_chunk).decode(),
            },
        })

    def encode_clear(self, stream_id: str) -> str | None:
        # Plivo supports true barge-in: clearAudio flushes buffered playback.
        return json.dumps({"event": "clearAudio"})


def _parse_extra_headers(raw: str) -> dict:
    """Plivo extraHeaders arrive as 'k=v;k2=v2'. Tolerate empties."""
    out = {}
    for pair in (raw or "").split(";"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            out[k.strip()] = v.strip()
    return out


# Registry — bridge.py picks by endpoint.
_ADAPTERS = {
    "exotel": ExotelAdapter(),
    "plivo":  PlivoAdapter(),
}


def get_adapter(provider: str) -> ProviderAdapter:
    return _ADAPTERS.get(provider, _ADAPTERS["exotel"])
