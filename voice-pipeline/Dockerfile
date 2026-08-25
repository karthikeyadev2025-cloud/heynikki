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
# Bind loopback ONLY. The compose service is network_mode: host, so there is
# no ports: mapping left to constrain exposure — 0.0.0.0 here would publish
# the pipeline on the box's public interface. Every consumer (FreeSWITCH,
# api-server, nginx) is host-mode and reaches it on 127.0.0.1.
CMD uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
