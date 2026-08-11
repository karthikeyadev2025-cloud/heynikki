# Runs via docker-compose on EC2 (see infra/docker-compose.yml) — not
# Railway, which was removed from the architecture. Python 3.11 slim
# keeps the image small; the build tools are only needed for
# cryptography's native bits, then discarded.
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev libssl-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 8000 matches nginx.conf's upstream for pipeline.heynikki.in and the
# port table in the v4.0 plan. 2 workers: each phone call is a WebSocket
# that stays pinned to one worker for its whole life (per-connection
# Session state), so multiple workers add capacity without splitting a
# call's state. Bump higher as call volume grows.
CMD uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
