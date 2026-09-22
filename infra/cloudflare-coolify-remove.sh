#!/usr/bin/env bash
#
# Take coolify.heynikki.in back off the tunnel. The undo for
# cloudflare-coolify-access.sh.
#
# WHY
# Coolify was parked on 22 Sep 2026 (see infra/COOLIFY.md, "Status"). With
# the dashboard stopped, the route only serves a 502 from a hostname nobody
# needs, so it goes.
#
# ORDER IS THE REVERSE OF THE ADD SCRIPT, FOR THE SAME REASON
# Route first, DNS second, Access app last. Deleting the Access app while the
# route still exists would, for that window, publish whatever answers on
# 127.0.0.1:8001 with no authentication in front — and if Coolify is ever
# started again, that is a panel with root on this box.
#
# THE TUNNEL CONFIG PUT IS STILL DESTRUCTIVE
# The configurations API replaces the whole ingress array, and the other
# rules serve api, n8n and activepieces from this box. So: GET, back up,
# delete exactly the one rule by hostname, refuse if that would leave nothing,
# PUT it back.
#
# USAGE
#   export CF_API_TOKEN=...         # same scopes as cloudflare-coolify-access.sh
#   ./cloudflare-coolify-remove.sh            # preview + back up only
#   CONFIRM=1 ./cloudflare-coolify-remove.sh  # apply

set -euo pipefail

ZONE_NAME="${ZONE_NAME:-heynikki.in}"
HOSTNAME_FQDN="${HOSTNAME_FQDN:-coolify.heynikki.in}"
ACCOUNT_ID="${ACCOUNT_ID:-db9a00b6762d1c776e2ca775ea78addd}"
TUNNEL_ID="${TUNNEL_ID:-01453552-a6da-4660-8352-2b1b2222d490}"
API="https://api.cloudflare.com/client/v4"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")" && pwd)/cloudflare-backups}"

need() { command -v "$1" >/dev/null || { echo "error: $1 required" >&2; exit 1; }; }
need curl; need jq

[ -n "${CF_API_TOKEN:-}" ] || { echo "error: CF_API_TOKEN not set (see TOKEN SCOPES in cloudflare-coolify-access.sh)" >&2; exit 1; }

cf() {
  local method="$1" path="$2"; shift 2
  curl -fsS --max-time 30 -X "$method" "$API$path" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" "$@"
}

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

echo "Resolving zone $ZONE_NAME ..."
ZONE_ID=$(cf GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].id // empty')
[ -n "$ZONE_ID" ] || { echo "error: zone not found or token cannot read it" >&2; exit 1; }

# ── Read and back up the tunnel's current ingress ───────────────
TUN_PATH="/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations"
CURRENT=$(cf GET "$TUN_PATH")
BACKUP="$BACKUP_DIR/tunnel-config-$STAMP.json"
printf '%s' "$CURRENT" > "$BACKUP"

INGRESS=$(printf '%s' "$CURRENT" | jq '.result.config.ingress // []')
echo "Current ingress (backed up to $BACKUP):"
printf '%s' "$INGRESS" | jq -r '.[] | "    \(.hostname // "(catch-all)") -> \(.service)"'

NEW_INGRESS=$(printf '%s' "$INGRESS" | jq --arg h "$HOSTNAME_FQDN" 'map(select(.hostname != $h))')
REMOVED=$(( $(printf '%s' "$INGRESS" | jq length) - $(printf '%s' "$NEW_INGRESS" | jq length) ))

# Anything but "one rule gone, others intact" means the config is not what
# this script assumes — stop rather than PUT a guess.
if [ "$(printf '%s' "$NEW_INGRESS" | jq '[.[] | select(has("hostname"))] | length')" = "0" ]; then
  echo "error: removing $HOSTNAME_FQDN would leave no hostname rules at all." >&2
  echo "       Refusing — that would take api/n8n/activepieces offline. Inspect $BACKUP." >&2
  exit 1
fi

DNS_ID=$(cf GET "/zones/$ZONE_ID/dns_records?name=$HOSTNAME_FQDN" | jq -r '.result[0].id // empty')
APP_ID=$(cf GET "/accounts/$ACCOUNT_ID/access/apps" \
  | jq -r --arg h "$HOSTNAME_FQDN" '.result[] | select(.domain == $h) | .id' | head -1)

echo ""
echo "Planned:"
[ "$REMOVED" -gt 0 ] && echo "  - tunnel rule $HOSTNAME_FQDN ($REMOVED)" || echo "  - tunnel rule: none present"
[ -n "$DNS_ID" ]     && echo "  - DNS record  $DNS_ID"                 || echo "  - DNS record: none present"
[ -n "$APP_ID" ]     && echo "  - Access app  $APP_ID"                 || echo "  - Access app: none present"
echo ""
echo "Ingress after:"
printf '%s' "$NEW_INGRESS" | jq -r '.[] | "    \(.hostname // "(catch-all)") -> \(.service)"'
echo ""

if [ "${CONFIRM:-0}" != "1" ]; then
  echo "Preview only. Nothing changed. Re-run with CONFIRM=1 to apply."
  exit 0
fi

# ── 1. Route ────────────────────────────────────────────────────
if [ "$REMOVED" -gt 0 ]; then
  printf '%s' "$CURRENT" | jq --argjson ing "$NEW_INGRESS" \
      '{config: (.result.config | .ingress = $ing)}' \
    | cf PUT "$TUN_PATH" -d @- | jq -e '.success' >/dev/null \
    && echo "Removed tunnel rule for $HOSTNAME_FQDN"
fi

# ── 2. DNS ──────────────────────────────────────────────────────
if [ -n "$DNS_ID" ]; then
  cf DELETE "/zones/$ZONE_ID/dns_records/$DNS_ID" | jq -e '.success' >/dev/null \
    && echo "Deleted DNS record for $HOSTNAME_FQDN"
fi

# ── 3. Access app, only once nothing routes to it ───────────────
if [ -n "$APP_ID" ]; then
  cf DELETE "/accounts/$ACCOUNT_ID/access/apps/$APP_ID" | jq -e '.success' >/dev/null \
    && echo "Deleted Access app $APP_ID"
fi

cat <<VERIFY

Done. Verify the rest of the tunnel is unaffected:

  for h in api n8n activepieces; do
    curl -s -o /dev/null -w "\$h %{http_code}\n" https://\$h.heynikki.in/health
  done

If any of those broke, restore the tunnel config:

  jq '{config: .result.config}' $BACKUP | curl -X PUT '$API$TUN_PATH' \\
    -H "Authorization: Bearer \$CF_API_TOKEN" \\
    -H 'Content-Type: application/json' -d @-
VERIFY
