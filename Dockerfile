# ─────────────────────────────────────────────────────────────
# Hey Nikki VOICE PIPELINE — root-level Dockerfile.
#
# Railway (and most CI) builds from the repository root by default. This is a
# monorepo, so the pipeline lives in voice-pipeline/. Rather than depending on
# a per-service "Root Directory" UI setting (easy to miss, and the cause of
# repeated "Railpack could not determine how to build the app" failures), this
# Dockerfile sits at the root and reaches into the subfolder itself.
#
# For the API server, use Dockerfile.api instead (set Dockerfile Path on that
# service to "Dockerfile.api").
# ─────────────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev libssl-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Deps first for layer caching
COPY voice-pipeline/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code — contents of voice-pipeline/ land at /app so `main:app` resolves
COPY voice-pipeline/ .

# Railway injects $PORT. 2 workers: each call is a WebSocket pinned to one
# worker for its lifetime (per-connection Session state), so workers add
# capacity without splitting a call.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2
