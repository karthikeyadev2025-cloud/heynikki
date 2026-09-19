#!/usr/bin/env bash
# Deploy the pipeline and API without cutting off a live call.
#
# WHY THIS EXISTS
# `docker compose up -d` recreates a container immediately. The pipeline
# holds one WebSocket per in-progress call, carrying that call's audio, and
# the transcript lives in memory until hangup. Restarting mid-call therefore
# does not just interrupt the caller — it destroys the record of the call.
#
# That happened: call 51b06a9d ran 21:22:50 to 21:28:19 UTC and the pipeline
# was recreated at 21:27:54, 25 seconds before the caller finished. The row
# survives with 0 turns, no intent and no appointment. From the outside it
# looks like a caller who said nothing for five and a half minutes.
#
# So: wait for the line to be clear, then deploy. FreeSWITCH is deliberately
# NOT restarted — it holds the SIP registrations to Jio and Vi.
#
#   ./deploy.sh              wait up to 15 min for calls to drain
#   ./deploy.sh --force      deploy now, cutting off anyone mid-call
#   ./deploy.sh --wait 1800  wait longer
set -euo pipefail
cd "$(dirname "$0")"

WAIT=900
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --wait)  WAIT="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

active_calls() {
  # FreeSWITCH is the authority on what is actually connected. The DB can
  # hold a stale 'active' row if a previous deploy killed the hangup hook,
  # which is exactly the state this script exists to avoid trusting.
  #
  # fs_cli needs the ESL password; without -p it fails to connect and the
  # old grep returned empty, which read as "zero calls" and would have
  # deployed straight through a live call — the very bug this guards.
  local pw
  pw=$(docker exec heynikki-api printenv FREESWITCH_ESL_PASSWORD 2>/dev/null || true)
  if [ -z "$pw" ]; then
    echo "cannot read FREESWITCH_ESL_PASSWORD — refusing to guess call count" >&2
    return 1
  fi
  local out
  # `show channels`, NOT `show channels count`. The count subcommand returns
  # an EMPTY body over -x on this build — measured, five consecutive calls,
  # all blank — while `show channels` reliably ends with "N total.". An empty
  # answer is indistinguishable from "no calls", which is the one wrong guess
  # this whole script exists to prevent.
  out=$(docker exec heynikki-freeswitch fs_cli -p "$pw" -x "show channels" 2>/dev/null | tr -d '\r' || true)
  # "N total." — anything unparseable is treated as busy, never as idle.
  if [[ "$out" =~ ([0-9]+)\ total ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "could not parse channel count from: ${out:-<empty>}" >&2
    return 1
  fi
}

if [ "$FORCE" -eq 0 ]; then
  deadline=$(( $(date +%s) + WAIT ))
  while :; do
    if ! n=$(active_calls); then
      echo "cannot determine live call count — not deploying blind." >&2
      echo "Use --force only if you accept cutting off any call in progress." >&2
      exit 1
    fi
    if [ "$n" -eq 0 ]; then
      echo "line clear — deploying"
      break
    fi
    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
      echo "still $n call(s) after ${WAIT}s. Re-run with --force to cut them off," >&2
      echo "or --wait <seconds> to keep waiting." >&2
      exit 1
    fi
    echo "  $n call(s) in progress — waiting ($(( deadline - now ))s left)"
    sleep 10
  done
else
  echo "--force: deploying with $(active_calls || echo '?') call(s) in progress"
fi

echo "── building ──"
docker compose build api-server voice-pipeline

echo "── restarting (FreeSWITCH untouched) ──"
# --no-deps is load-bearing, not tidiness. freeswitch has `env_file: .env`,
# so ANY edit to infra/.env changes its config hash, and `up -d` recreates a
# depends_on service whose config changed even when you did not name it.
# Editing GEMINI_MODEL in .env restarted the PBX and dropped telephony for
# about a minute — a deploy that touches no telephony code must never do
# that. With --no-deps compose only ever recreates what is listed here.
#
# The trade: if freeswitch is down, these start without waiting for it.
# That is the right way round. They reconnect on their own; restarting a
# live PBX to satisfy a dependency check does not undo a dropped call.
docker compose up -d --no-deps api-server voice-pipeline

# scheduler and outbound-dispatcher have no build: of their own, only
# `image: infra-api-server:latest`, so compose sees an unchanged config and
# leaves them running the OLD image when that tag moves. The scheduler ran a
# 4 Sep build until 16 Sep — without the one-chase-per-booking guard — and
# rang one caller five times about the same abandoned booking. A blanket
# --force-recreate was the fix for that, and it bought a second bug:
#
#   RECREATING A CONTAINER DELETES ITS LOG. Docker's json-file log belongs to
#   the container, not the image, so every deploy — including the eight that
#   changed nothing in these two services — threw away everything they had
#   ever printed. A week of api-server and pipeline history went that way
#   during an audit, and with SENTRY_DSN empty there was no second copy.
#
# So: recreate only when the image ACTUALLY moved. The digest comparison that
# used to run after the deploy as a warning now runs before it as the
# decision, which is the same check doing something useful. A deploy that
# does not change the API image leaves both containers — and their logs —
# exactly where they were.
#
# Both sit behind compose profiles so the EC2 host that shares this compose
# file never starts a second copy with a bare `up -d` (two schedulers send
# every reminder twice). This host is the one that runs them, so name the
# profiles explicitly.
want=$(docker image inspect infra-api-server:latest --format '{{.Id}}')

recreate_if_stale() {
  # $1 container name, $2 compose profile, $3 compose service
  local have
  have=$(docker inspect "$1" --format '{{.Image}}' 2>/dev/null || echo missing)
  if [ "$have" = "$want" ]; then
    echo "  $3 already on the new image — leaving it (and its logs) alone"
    # Still an `up -d`, so a container that is stopped or missing a config
    # change is brought back. Without a changed image this is a no-op.
    docker compose --profile "$2" up -d --no-deps "$3"
  else
    echo "  $3 is on $have — recreating onto the new image"
    docker compose --profile "$2" up -d --no-deps --force-recreate "$3"
  fi
}

recreate_if_stale heynikki-scheduler scheduler scheduler
recreate_if_stale heynikki-outbound  outbound  outbound-dispatcher

echo "── health ──"
sleep 8
docker compose --profile scheduler --profile outbound ps --format '  {{.Name}}  {{.Status}}'
# Belt and braces: the decision above should have made this impossible, but a
# container left on an old image is the failure that ran for twelve days
# unnoticed, so it is still checked out loud.
for c in heynikki-api heynikki-scheduler heynikki-outbound; do
  have=$(docker inspect "$c" --format '{{.Image}}' 2>/dev/null || echo missing)
  [ "$have" = "$want" ] || echo "  !! $c is NOT on the new image ($have)" >&2
done
curl -s --max-time 8 http://127.0.0.1:4000/health || echo "api-server not answering"
echo
curl -s --max-time 8 http://127.0.0.1:8000/health >/dev/null && echo "  pipeline OK" || echo "  pipeline NOT answering"
