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
docker compose up -d api-server voice-pipeline scheduler
docker compose --profile outbound up -d outbound-dispatcher

echo "── health ──"
sleep 8
docker compose ps --format '  {{.Name}}  {{.Status}}'
curl -s --max-time 8 http://127.0.0.1:4000/health || echo "api-server not answering"
echo
curl -s --max-time 8 http://127.0.0.1:8000/health >/dev/null && echo "  pipeline OK" || echo "  pipeline NOT answering"
