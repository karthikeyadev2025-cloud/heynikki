# indic-tts — Nikki's offline Telugu voice

AI4Bharat Indic-TTS (FastPitch + HiFi-GAN V1, `te` checkpoint), CPU only,
served on the box so Nikki keeps talking when the internet does not. On 15 Sep
and 2 Oct the host lost DNS, Sarvam's breaker opened, every cloud fallback
failed with "Temporary failure in name resolution", and callers heard silence.

It is a **fallback**, not the main voice: it is several times slower than
Sarvam (see below), so a caller waits noticeably longer for each reply. That
is acceptable during an outage, where the alternative is silence.

## Turning it on

```sh
cd infra
docker compose --profile indic-tts up -d indic-tts      # builds once: ~1.5 GB model download
echo 'INDIC_TTS_URL=http://127.0.0.1:8100' >> .env
./deploy.sh                                             # pipeline picks up the setting
```

Off by default: a plain `./deploy.sh` neither builds nor starts it. It holds
about 1.6 GB of RAM while running, whether or not it speaks.

`NIKKI_TTS_PROVIDER=indic` makes it the *primary* voice. Listening tests only.

## API

    POST /tts  {"text": "...", "gender": "female"|"male"}  -> audio/wav, 8 kHz mono 16-bit
    GET  /health

## Speed (16 Oct 2026, this host)

Same Telugu text, warm model:

| Text | Indic, 2 threads | Indic, 4 threads (compose default) | Sarvam REST |
|---|---|---|---|
| 24 chars (short acknowledgement) | 1.2–1.4 s | 0.7 s | 0.8 s |
| 86 chars (normal two-sentence reply) | 3.9–4.0 s | 2.7 s | 1.7 s |
| 156 chars (campaign pitch) | 7.6–7.9 s | 5.3–5.4 s | — |

The pipeline's per-request budget (`_indic_timeout` in voice-pipeline/main.py)
is set from these numbers.
