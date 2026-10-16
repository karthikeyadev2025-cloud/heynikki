# Local Telugu TTS — AI4Bharat Indic-TTS (FastPitch + HiFi-GAN V1), CPU only.
# See server.py for why Nikki needs a voice that does not need the internet.

# ── stage 1: runtime deps ───────────────────────────────────────────────────
FROM python:3.11.9-slim-bookworm AS deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 curl \
 && rm -rf /var/lib/apt/lists/*
RUN pip install torch==2.1.2 torchaudio==2.1.2 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt requirements.lock /tmp/
RUN pip install -r /tmp/requirements.txt -c /tmp/requirements.lock

# ── stage 2: fetch the checkpoint, untrusted ────────────────────────────────
# The release archive is ~1.5 GB of someone else's zip. It is checksum-pinned,
# and only five named files are copied out of it (fetch_model.py) into an
# empty directory — nothing in it is executed. The weights themselves are
# only ever read by torch through the TTS library.
FROM python:3.11.9-slim-bookworm AS fetch
ARG TE_ZIP_URL=https://github.com/AI4Bharat/Indic-TTS/releases/download/v1-checkpoints-release/te.zip
ARG TE_ZIP_SHA256=c568b55c5e3317c18fc942f46703ff0664beef75c23fcfa059a8396574b0cf23
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY fetch_model.py /opt/fetch/fetch_model.py
RUN mkdir /dl && curl -fsSL --retry 3 -o /dl/te.zip "$TE_ZIP_URL" \
 && echo "$TE_ZIP_SHA256  /dl/te.zip" | sha256sum -c - \
 && python3 -I /opt/fetch/fetch_model.py /dl/te.zip /models/te \
 && rm -rf /dl

# ── stage 3: service ────────────────────────────────────────────────────────
FROM deps
RUN useradd --system --uid 10001 --home-dir /app tts
COPY --from=fetch /models /models
WORKDIR /app
COPY server.py telugu_text.py /app/
# numba (via librosa) and matplotlib want writable cache dirs; the service
# itself writes nothing.
ENV NUMBA_CACHE_DIR=/tmp/numba MPLCONFIGDIR=/tmp/mpl HOME=/tmp \
    INDIC_TTS_MODEL_DIR=/models/te INDIC_TTS_THREADS=2 PYTHONUNBUFFERED=1
USER tts
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
