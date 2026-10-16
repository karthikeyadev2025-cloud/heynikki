"""Local Telugu TTS for Nikki: AI4Bharat Indic-TTS (FastPitch + HiFi-GAN V1).

Why this exists: on 15 Sep and 2 Oct the host lost DNS. Sarvam's breaker
opened, the Google fallback failed 108 times with "Temporary failure in name
resolution", and callers heard silence. Every voice Nikki had lived on the
internet. This one runs on the box, so it keeps talking when the network
does not.

    POST /tts  {"text": "...", "gender": "female"|"male"}  ->  audio/wav
                8 kHz mono 16-bit PCM, the format the phone spool plays.
    GET  /health

The model is loaded once at startup; a request never pays for loading.
Inference is CPU-bound, so requests run one at a time (INDIC_TTS_CONCURRENCY)
in a worker thread: two at once on two cores only makes both slow.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import time
import wave

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from scipy.signal import resample_poly

from telugu_text import normalise

log = logging.getLogger("indic-tts")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MODEL_DIR = os.environ.get("INDIC_TTS_MODEL_DIR", "/models/te")
OUT_RATE = 8000
MAX_CHARS = int(os.environ.get("INDIC_TTS_MAX_CHARS", "600"))
THREADS = int(os.environ.get("INDIC_TTS_THREADS", "2"))
CONCURRENCY = int(os.environ.get("INDIC_TTS_CONCURRENCY", "1"))

torch.set_num_threads(THREADS)

app = FastAPI(title="indic-tts")
_state: dict = {"synth": None, "chars": None, "speakers": [], "loaded_s": 0.0,
                "served": 0}
_sem = asyncio.Semaphore(CONCURRENCY)


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1)
    gender: str = "female"


def _load() -> None:
    from TTS.utils.synthesizer import Synthesizer  # noqa: PLC0415 — heavy import
    t = time.monotonic()
    synth = Synthesizer(
        tts_checkpoint=f"{MODEL_DIR}/fastpitch/best_model.pth",
        tts_config_path=f"{MODEL_DIR}/fastpitch/config.json",
        tts_speakers_file=f"{MODEL_DIR}/fastpitch/speakers.pth",
        vocoder_checkpoint=f"{MODEL_DIR}/hifigan/best_model.pth",
        vocoder_config=f"{MODEL_DIR}/hifigan/config.json",
        use_cuda=False,
    )
    chars = synth.tts_config.get("characters") or {}
    allowed = set((chars.get("characters") or "") + (chars.get("punctuations") or ""))
    _state["synth"] = synth
    _state["chars"] = allowed or None
    sm = getattr(synth.tts_model, "speaker_manager", None)
    _state["speakers"] = sorted(getattr(sm, "name_to_id", {}) or {})
    _state["loaded_s"] = round(time.monotonic() - t, 1)
    log.info(f"model loaded in {_state['loaded_s']}s; speakers={_state['speakers']} "
             f"sr={synth.output_sample_rate} threads={THREADS}")
    # One throwaway synthesis: the first call through torch pays for
    # allocator and kernel warm-up, and that should not be a caller's turn.
    _synth_wav("నమస్కారం", "female")


def _to_wav_8k(wav, sr: int) -> bytes:
    x = np.asarray(wav, dtype=np.float32)
    if sr != OUT_RATE:
        g = np.gcd(sr, OUT_RATE)
        x = resample_poly(x, OUT_RATE // g, sr // g)
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 0.98:                       # never let the phone hear clipping
        x = x * (0.98 / peak)
    pcm = (np.clip(x, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(OUT_RATE)
        wf.writeframes(pcm)
    return buf.getvalue()


def _synth_wav(text: str, gender: str) -> bytes:
    synth = _state["synth"]
    spoken = normalise(text, _state["chars"])
    if not spoken:
        raise ValueError("nothing speakable after normalisation")
    speaker = gender if gender in _state["speakers"] else (
        _state["speakers"][0] if _state["speakers"] else None)
    wav = synth.tts(spoken, speaker_name=speaker)
    return _to_wav_8k(wav, synth.output_sample_rate)


@app.on_event("startup")
async def _startup() -> None:
    await asyncio.get_running_loop().run_in_executor(None, _load)


@app.get("/health")
async def health():
    ok = _state["synth"] is not None
    return JSONResponse(status_code=200 if ok else 503, content={
        "ok": ok, "speakers": _state["speakers"], "load_seconds": _state["loaded_s"],
        "threads": THREADS, "served": _state["served"]})


@app.post("/tts")
async def tts(req: TTSRequest):
    if _state["synth"] is None:
        raise HTTPException(503, "model not loaded")
    gender = req.gender.lower().strip()
    if gender not in ("female", "male"):
        raise HTTPException(400, "gender must be female or male")
    text = req.text.strip()[:MAX_CHARS]
    t = time.monotonic()
    async with _sem:
        waited = time.monotonic() - t
        try:
            audio = await asyncio.get_running_loop().run_in_executor(
                None, _synth_wav, text, gender)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
    _state["served"] += 1
    ms = (time.monotonic() - t) * 1000
    log.info(f"tts {gender} {len(text)}ch {ms:.0f}ms (queued {waited*1000:.0f}ms)")
    return Response(content=audio, media_type="audio/wav",
                    headers={"X-Synth-Ms": f"{ms:.0f}"})
