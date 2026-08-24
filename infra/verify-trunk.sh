#!/usr/bin/env bash
# ================================================================
# Hey Nikki — SIP trunk verification
#
# Run this on the EC2 host after filling in the Jio details. It walks
# the whole inbound path in order and stops being useful only when
# everything passes.
#
# The point is to fail in the RIGHT place. "Calls don't work" has about
# eight possible causes on this stack, and finding out which one at 2am
# with a customer on the phone is the wrong time. Each check below maps
# to exactly one cause.
#
#   sudo bash infra/verify-trunk.sh
# ================================================================
set -uo pipefail

PASS=0; FAIL=0; WARN=0
ok()   { echo "  [ OK ]   $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL]   $1"; FAIL=$((FAIL+1)); }
warn() { echo "  [WARN]   $1"; WARN=$((WARN+1)); }
hdr()  { echo ""; echo "── $1 ────────────────────────────────────────"; }

FS_CLI="${FS_CLI:-fs_cli}"
fs() { $FS_CLI -x "$1" 2>/dev/null; }

echo "════════════════════════════════════════════════════════════"
echo " Hey Nikki — SIP trunk verification    $(date -Is)"
echo "════════════════════════════════════════════════════════════"

# ── 1. Is FreeSWITCH even up? ────────────────────────────────
hdr "1. FreeSWITCH process"
if fs "status" | grep -q "UP"; then
  ok "FreeSWITCH is running"
  fs "status" | head -3 | sed 's/^/           /'
else
  bad "FreeSWITCH is not responding on ESL."
  echo "           Check: docker compose ps / logs freeswitch"
  echo "           If ESL auth fails, FREESWITCH_ESL_PASSWORD may be unset —"
  echo "           it no longer falls back to the stock 'ClueCon' password."
  echo ""; echo "Cannot continue without ESL."; exit 1
fi

# ── 2. Modules ───────────────────────────────────────────────
hdr "2. Required modules"
for m in mod_sofia mod_audio_stream mod_event_socket mod_dptools mod_flite; do
  if fs "module_exists $m" | grep -qi "true"; then
    ok "$m loaded"
  else
    # mod_audio_stream is third-party and built from source — if the
    # build silently skipped it, every call answers then goes silent.
    [ "$m" = "mod_audio_stream" ] \
      && bad "$m NOT loaded — calls will connect but carry no audio to the AI" \
      || bad "$m NOT loaded"
  fi
done

# ── 3. Trunk registration / reachability ─────────────────────
hdr "3. SIP gateways"
GW=$(fs "sofia status gateway")
echo "$GW" | grep -qi "jio_primary" || warn "jio_primary gateway not found in sofia status"

JIO_STATE=$(echo "$GW" | grep -A6 -i "jio_primary" | grep -i "^State" | head -1)
case "$JIO_STATE" in
  *REGED*)     ok "Jio trunk REGISTERED" ;;
  *NOREG*)     ok "Jio trunk in NOREG (correct for IP-based auth — no registration expected)" ;;
  *FAIL*|*FAIL_WAIT*|*TRYING*)
    bad "Jio trunk failing to register: $JIO_STATE"
    echo "           Common causes, in order of likelihood:"
    echo "             - trunk is IP-based, not register-based, but config says register=true"
    echo "             - JIO_SIP_HOST still set to the placeholder 'siptrunk.jio.com'"
    echo "             - your EC2 public IP is not whitelisted on Jio's side"
    echo "             - outbound UDP 5060 blocked by the security group" ;;
  *) warn "Jio trunk state unclear: ${JIO_STATE:-<none>}" ;;
esac

if echo "$GW" | grep -qi "vi_failover"; then
  VI_STATE=$(echo "$GW" | grep -A6 -i "vi_failover" | grep -i "^State" | head -1)
  case "$VI_STATE" in
    *REGED*|*NOREG*) ok "Vi failover trunk present" ;;
    *) warn "Vi trunk not up: ${VI_STATE:-<none>} (fine if you haven't bought Vi yet — see VI_ENABLED in .env)" ;;
  esac
fi

# ── 4. ACL — the toll-fraud guard ────────────────────────────
hdr "4. Inbound ACL"
ACL_FILE="${ACL_FILE:-/etc/freeswitch/autoload_configs/acl.conf.xml}"
if [ -f "$ACL_FILE" ]; then
  if grep -A6 'name="heynikki-sip-trunks"' "$ACL_FILE" | grep -q '<node type="allow"'; then
    ok "heynikki-sip-trunks has allow entries:"
    grep -A8 'name="heynikki-sip-trunks"' "$ACL_FILE" | grep '<node type="allow"' | sed 's/^/           /'
  else
    bad "heynikki-sip-trunks is EMPTY (default=deny) — ALL inbound SIP is rejected."
    echo "           This is the expected state until Jio gives you their gateway CIDRs."
    echo "           It is fail-closed and safe, but no call can land."
  fi
else
  warn "ACL file not found at $ACL_FILE (set ACL_FILE=... if it lives elsewhere)"
fi

# ── 5. Voice pipeline reachable ──────────────────────────────
hdr "5. Voice pipeline"
if curl -sf -m 4 "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
  ok "voice-pipeline healthy on :8000"
else
  bad "voice-pipeline not responding on :8000 — calls will answer then hear silence"
fi

if curl -sf -m 4 "http://127.0.0.1:4000/health" >/dev/null 2>&1; then
  ok "api-server healthy on :4000"
else
  bad "api-server not responding on :4000 — routing lookup and hangup logging will fail"
fi

# ── 6. Credentials present ───────────────────────────────────
hdr "6. Environment"
for v in SARVAM_API_KEY GEMINI_API_KEY SUPABASE_URL FREESWITCH_ESL_PASSWORD; do
  if [ -n "${!v:-}" ]; then ok "$v is set"; else bad "$v is NOT set"; fi
done
if [ "${JIO_SIP_HOST:-}" = "siptrunk.jio.com" ]; then
  bad "JIO_SIP_HOST is still the placeholder 'siptrunk.jio.com' — replace with the real SBC address from Jio"
elif [ -n "${JIO_SIP_HOST:-}" ]; then
  ok "JIO_SIP_HOST = ${JIO_SIP_HOST}"
else
  warn "JIO_SIP_HOST not set in this shell (may still be set inside the container)"
fi

# ── 7. Public IP — matters for IP-based auth ─────────────────
hdr "7. Public IP"
PUB=$(curl -sf -m 4 https://api.ipify.org 2>/dev/null || echo "")
if [ -n "$PUB" ]; then
  echo "           This host's public IP: $PUB"
  echo "           If Jio uses IP-based auth, THIS is the address they must whitelist."
  echo "           It must be an Elastic IP — a default EC2 IP changes on stop/start"
  echo "           and every call dies until Jio re-whitelists you."
else
  warn "Could not determine public IP"
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo " PASS: $PASS    WARN: $WARN    FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo " Trunk looks healthy. Next: place a real call to your DID and watch"
  echo "   fs_cli -x 'sofia global siptrace on'"
  echo "   docker compose logs -f voice-pipeline"
else
  echo ""
  echo " Fix the [FAIL] lines above before pointing a customer at this number."
fi
echo "════════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ]
