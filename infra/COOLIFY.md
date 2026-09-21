# Coolify on the on-prem box

Self-hosted PaaS, installed on `nikki-voice` (the on-prem box) to host the
Next apps that currently run on Vercel, and drop that bill.

**Version** 4.3.23 · **Installed** 20 Sep 2026 · **Brought up** 21 Sep 2026
**Dashboard** http://127.0.0.1:8001 — loopback only, from this machine

It shares the box with production telephony. Everything below exists because
of that, so read the port map before changing anything.

---

## Port map — 8000 is not available

| Port | Owner | |
|------|-------|--|
| 4000 | `heynikki-api` | api-server |
| **8000** | **`heynikki-pipeline`** | **voice pipeline — never take this** |
| 8001 | `coolify` | dashboard, `127.0.0.1` only |
| 8021 | `heynikki-freeswitch` | ESL |
| 5060 | `heynikki-freeswitch` | SIP |
| 5678 | `heynikki-n8n` | `127.0.0.1` only |
| 8080 | `heynikki-activepieces` | `127.0.0.1` only |
| 6001-2 | `coolify-realtime` | **`0.0.0.0`** — see Known exposure |

Coolify's installer defaults to **8000**, which the voice pipeline already
owns (`PIPELINE_URL=http://127.0.0.1:8000`, and the FreeSWITCH dialplan and
api-server both reach it there). That collision is why Coolify sat dead in
`created` state from 20 Sep to 21 Sep:

```
failed to bind host port 0.0.0.0:8000/tcp: address already in use
```

The pipeline does not move. Coolify does. `APP_PORT=8001`.

Worth knowing about that outage: the upgrade script **reported success after
failing**. Its log ends with the bind error, then
`Coolify upgrade completed successfully`. Do not trust that log — check
`docker ps` for a container in `created` state instead.

---

## The local patch that upgrades will silently revert

`/data/coolify/source/docker-compose.prod.yml` is **not** upstream. One line
differs:

```yaml
ports:
  - "127.0.0.1:${APP_PORT:-8000}:8080"      # ← 127.0.0.1: added locally
```

### Why it is on that line and not in `.env`

`APP_PORT` is interpolated in two places, and only one accepts an address:

```yaml
ports:  - "${APP_PORT:-8000}:8080"    # accepts HOST_IP:HOST_PORT:CONTAINER_PORT
expose: - "${APP_PORT:-8000}"         # port number ONLY
```

So `APP_PORT=127.0.0.1:8001` fails the whole stack at `expose`:

```
service:coolify:1 invalid start port '127.0.0.1:8001': invalid syntax
```

`APP_PORT` therefore stays a bare port and the address lives on `ports`.

### Why loopback at all

The dashboard has root-equivalent control of this box's Docker daemon, on a
host that also runs live telephony. It must not listen on `0.0.0.0`.

An active `ufw` is **not** sufficient: Docker publishes ports through its own
`DOCKER-USER` iptables chain and routinely bypasses ufw rules. Binding to
`127.0.0.1` is what actually restricts it. Verified — port 8001 does not
answer on the box's public address.

### Checking the patch survived

Coolify's own upgrade script rewrites this file. Verify after every upgrade:

```bash
sudo grep -n 'APP_PORT' /data/coolify/source/docker-compose.prod.yml
# ports line MUST carry the 127.0.0.1: prefix
sudo sha256sum /data/coolify/source/docker-compose.prod.yml
```

| sha256 | meaning |
|--------|---------|
| `00319f5854c173df63f6faf28b1573e03fe6301ffc62d369ac1308067abd5e4e` | patched, 2982 B — correct |
| `77f4723dfac49deeec550b412e366bde70a329ff8c66ceb44d5d10b146a24124` | upstream, 2972 B — **patch lost, dashboard is on 0.0.0.0** |
| anything else | inspect it, and read the next section first |

---

## That file was once replaced with a web page

On 20 Sep at 10:36 UTC, `docker-compose.prod.yml` was overwritten with
**Coolify's marketing homepage HTML** — 16,808 bytes beginning
`<!DOCTYPE html>`, containing zero YAML. A fetch during install/upgrade
received an HTML page instead of the file and wrote it anyway.

The effect is total: `docker compose` cannot parse it, so nothing can start,
whatever the ports say. The base `docker-compose.yml` cannot stand in — it
carries no `image:` and no `ports:` for the coolify service, because all of
that lives in the override.

The HTML is no longer on disk (it was overwritten in place during recovery,
without a backup). `upgrade-2026-09-20-15-41-07.log` in the same directory is
what produced it.

**So: after any Coolify upgrade, before anything else**

```bash
sudo head -c 20 /data/coolify/source/docker-compose.prod.yml
```

`services:` is correct. `<!DOCTYPE` means re-fetch:

```bash
sudo cp /data/coolify/source/docker-compose.prod.yml{,.broken-$(date +%F)}
curl -fsSL -o /tmp/cc.yml https://cdn.coollabs.io/coolify/docker-compose.prod.yml
head -1 /tmp/cc.yml                     # must be `services:` — a fresh curl
                                        # is exactly what handed us HTML
sha256sum /tmp/cc.yml                   # expect 77f4723d… for 4.3.23
sudo cp /tmp/cc.yml /data/coolify/source/docker-compose.prod.yml
sudo chown 9999:root /data/coolify/source/docker-compose.prod.yml
sudo chmod 700      /data/coolify/source/docker-compose.prod.yml
# then re-apply the loopback patch:
sudo sed -i 's|- "${APP_PORT:-8000}:8080"|- "127.0.0.1:${APP_PORT:-8000}:8080"|' \
  /data/coolify/source/docker-compose.prod.yml
```

The CDN copy was checked byte-identical against the `v4.3.23` GitHub tag.

---

## Bringing the stack up

Compose project is `source`, and both files are required:

```bash
cd /data/coolify/source
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml -p source up -d
```

The `coolify` network is declared **`external: true`** in the prod override,
so it must already exist. If it was ever removed, `up` fails with
`network coolify ... could not be found`:

```bash
docker network create coolify
```

Containers: `coolify`, `coolify-db`, `coolify-redis`, `coolify-realtime`.
Volumes: `coolify-db`, `coolify-redis` (compose creates these; deleting them
resets the dashboard to first-run setup).

Healthy looks like:

```bash
docker ps --filter name=coolify --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8001/api/health   # 200
```

---

## Deploying web and super-admin

Both have a Dockerfile in their own directory. See the header of each — it
explains why they are not at the repo root (the root `.dockerignore` excludes
`web` and `super-admin` by name, to keep the voice-pipeline build context
small, so a root-level Dockerfile would build with its own source missing).

| Coolify setting | `web` | `super-admin` |
|---|---|---|
| Base Directory | `web` | `super-admin` |
| Dockerfile Location | `./Dockerfile` | `./Dockerfile` |
| Port | 3000 | 3000 |

### These must be BUILD-time variables, not runtime

`NEXT_PUBLIC_*` is compiled into the JS bundle when `next build` runs. Set as
runtime variables they do nothing — the strings are already baked in before
the container starts. Confirmed by finding the build's values compiled inside
three separate JS chunks.

Required by both:

```
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Optional, `web` only: `NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL` (unset disables
voice-sample playback, nothing else), `GOOGLE_SITE_VERIFICATION`,
`BING_SITE_VERIFICATION`.

Get this wrong and the failure is the quiet kind: image builds, container
reports healthy, every browser call goes to `undefined`. Both Dockerfiles
carry a guard that fails the build naming the empty variable instead — if a
deploy dies with `ERROR: build argument … is empty`, it is telling you the
variable is set as runtime rather than build.

### Deploy one at a time

Two concurrent Docker builds wedged the daemon on this box: a build
intermediate stuck in `removing` state, both builds at 0% CPU, no output, no
images, ~12 minutes lost. Sequential builds worked first time. Also note
**BuildKit is unavailable here** — `buildx` is not installed, so
`DOCKER_BUILDKIT=1` fails outright and the legacy builder is what runs.

Builds are heavy relative to a box handling live calls (`npm ci` alone sat at
~87% CPU). Prefer deploying outside call hours.

---

## Known exposure

`coolify-realtime` publishes **`0.0.0.0:6001-6002`**. That is Coolify's own
default and has not been overridden — unlike the dashboard. As above, ufw
does not reliably constrain a published Docker port. Restrict or accept
deliberately; do not assume the firewall covers it.

---

## The tradeoff this choice makes

Everything public already served from this box — `api`, `n8n`,
`activepieces`, and all telephony — goes dark when the box goes off. That is
not hypothetical: a console shutdown on 20 Sep at 18:21:59 IST kept it down
until 09:05:32 the next morning, **14h 43m**, and nothing reported it.

Through that outage the marketing site and dashboard **stayed up, on Vercel**.
Vercel was the only part of the stack that survived.

Deploying `web` here removes that. The site then shares one power switch with
the phones, and there is no fallback — the old EC2 frontend is gone.

This was chosen knowingly. Two things make it survivable:

- `.github/workflows/uptime.yml` probes from outside and opens an issue when
  the box stops answering, so an outage is reported rather than discovered.
- FreeSWITCH genuinely cannot move (the Jio trunk terminates on this host at
  `100.65.188.4` with no NAT), but the Next apps can. If uptime starts
  mattering more than the Vercel bill, they are the part to move to a VPS —
  a €4.50/mo box with a static IP and remote reboot, which is also what fixes
  the "someone has to walk over and press the button" problem.
