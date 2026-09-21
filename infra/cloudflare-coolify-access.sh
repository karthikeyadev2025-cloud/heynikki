#!/usr/bin/env bash
#
# Put the Coolify dashboard on coolify.heynikki.in, behind Cloudflare Access.
#
# WHY
# The dashboard is bound to 127.0.0.1:8001 (see infra/COOLIFY.md for why it
# must not listen on 0.0.0.0). That makes it reachable only from a browser
# running on the box itself, which means an SSH tunnel every time. This puts
# it on the existing cloudflared tunnel instead and gates it with Access, so
# it is a normal URL with authentication in front.
#
# ORDER MATTERS, AND GETTING IT WRONG IS SERIOUS
# Coolify leaves /register open until the first user exists. Publishing the
# hostname before Access is enforcing would let anyone who finds the URL
# create the first admin account — an account with root-equivalent control of
# the Docker daemon on the host running live telephony.
#
# So this script creates the Access application and its policy BEFORE adding
# the tunnel route. It also refuses to run while Coolify has zero users,
# because at that point the safe fix is to register over an SSH tunnel first:
#
#   ssh -L 8001:127.0.0.1:8001 <user>@<box>   # then http://localhost:8001
#
# Override with ALLOW_NO_USERS=1 only if you understand the above.
#
# THE OTHER TRAP: THE TUNNEL CONFIG PUT IS DESTRUCTIVE
# This tunnel is token-managed, so its ingress rules live in Cloudflare, not
# in a local config file — and the configurations API replaces the whole
# ingress array. A naive PUT would delete the rules serving
# api.heynikki.in, n8n.heynikki.in and activepieces.heynikki.in, all of which
# are served from this box. That is an instant outage of the product.
#
# So: GET the current config, back it up, append one rule, PUT it back. The
# new rule is inserted BEFORE the trailing catch-all, because cloudflared
# matches ingress rules in order and the catch-all (service: http_status:404,
# with no hostname) swallows everything after it.
#
# USAGE
#   export CF_API_TOKEN=...        # see TOKEN SCOPES below
#   export ACCESS_EMAIL=you@example.com
#   ./cloudflare-coolify-access.sh            # preview + back up only
#   CONFIRM=1 ./cloudflare-coolify-access.sh  # apply
#
# TOKEN SCOPES (dash.cloudflare.com > My Profile > API Tokens > Custom)
#   Account · Cloudflare Tunnel        : Edit
#   Account · Access: Apps and Policies: Edit
#   Zone    · DNS                      : Edit   (zone: heynikki.in)
#   Zone    · Zone                     : Read   (zone: heynikki.in)
#
# Access uses one-time PIN to the allowed address, so no identity provider
# needs configuring. Cloudflare emails a code; only ACCESS_EMAIL can get in.

set -euo pipefail

ZONE_NAME="${ZONE_NAME:-heynikki.in}"
HOSTNAME_FQDN="${HOSTNAME_FQDN:-coolify.heynikki.in}"
LOCAL_SERVICE="${LOCAL_SERVICE:-http://127.0.0.1:8001}"
ACCOUNT_ID="${ACCOUNT_ID:-db9a00b6762d1c776e2ca775ea78addd}"
TUNNEL_ID="${TUNNEL_ID:-01453552-a6da-4660-8352-2b1b2222d490}"
SESSION_DURATION="${SESSION_DURATION:-24h}"
API="https://api.cloudflare.com/client/v4"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")" && pwd)/cloudflare-backups}"

need() { command -v "$1" >/dev/null || { echo "error: $1 required" >&2; exit 1; }; }
need curl; need jq

[ -n "${CF_API_TOKEN:-}" ] || { echo "error: CF_API_TOKEN not set (see TOKEN SCOPES in this file)" >&2; exit 1; }
[ -n "${ACCESS_EMAIL:-}" ] || { echo "error: ACCESS_EMAIL not set — the address allowed through Access" >&2; exit 1; }

cf() {
  local method="$1" path="$2"; shift 2
  curl -fsS --max-time 30 -X "$method" "$API$path" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" "$@"
}

# ── Refuse to publish an unclaimed Coolify ──────────────────────
# The whole point of the ordering note above.
if command -v docker >/dev/null && docker ps --format '{{.Names}}' | grep -qx coolify-db; then
  users=$(docker exec coolify-db psql -U coolify -d coolify -tAc \
            "select count(*) from users;" 2>/dev/null | tr -d '[:space:]' || echo "?")
  if [ "$users" = "0" ]; then
    echo "" >&2
    echo "REFUSING: Coolify has 0 users, so /register is still open." >&2
    echo "  Publishing the hostname now would let a stranger create the admin" >&2
    echo "  account for a panel that controls this host's Docker daemon." >&2
    echo "" >&2
    echo "  Register first over an SSH tunnel:" >&2
    echo "    ssh -L 8001:127.0.0.1:8001 \$USER@<this-box>" >&2
    echo "    then open http://localhost:8001/register" >&2
    echo "" >&2
    echo "  Then re-run this. (ALLOW_NO_USERS=1 overrides.)" >&2
    [ "${ALLOW_NO_USERS:-0}" = "1" ] || exit 1
    echo "  ALLOW_NO_USERS=1 set — continuing anyway." >&2
  else
    echo "Coolify users: $users — /register is closed. Good."
  fi
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

echo "Resolving zone $ZONE_NAME ..."
ZONE_ID=$(cf GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].id // empty')
[ -n "$ZONE_ID" ] || { echo "error: zone not found or token cannot read it" >&2; exit 1; }
echo "  zone: $ZONE_ID"

# ── Read and back up the tunnel's current ingress ───────────────
echo "Reading tunnel config ..."
TUN_PATH="/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations"
CURRENT=$(cf GET "$TUN_PATH")
BACKUP="$BACKUP_DIR/tunnel-config-$STAMP.json"
printf '%s' "$CURRENT" > "$BACKUP"

INGRESS=$(printf '%s' "$CURRENT" | jq '.result.config.ingress // []')
N=$(printf '%s' "$INGRESS" | jq 'length')
if [ "$N" = "0" ]; then
  echo "error: the tunnel reports no ingress rules." >&2
  echo "       Refusing to PUT a config built from nothing — that would take" >&2
  echo "       api/n8n/activepieces offline. Inspect $BACKUP first." >&2
  exit 1
fi

echo "  $N existing rule(s), backed up to $BACKUP:"
printf '%s' "$INGRESS" | jq -r '.[] | "    \(.hostname // "(catch-all)") -> \(.service)"'

if printf '%s' "$INGRESS" | jq -e --arg h "$HOSTNAME_FQDN" 'any(.hostname == $h)' >/dev/null; then
  echo ""
  echo "$HOSTNAME_FQDN is already routed. Nothing to add to the tunnel."
  ROUTE_NEEDED=0
else
  ROUTE_NEEDED=1
fi

# Insert before the trailing catch-all — cloudflared matches in order, and a
# rule after the hostname-less catch-all is dead.
NEW_INGRESS=$(printf '%s' "$INGRESS" | jq \
  --arg h "$HOSTNAME_FQDN" --arg s "$LOCAL_SERVICE" '
  (map(has("hostname") | not) | index(true)) as $cat
  | ({hostname:$h, service:$s}) as $new
  | if $cat == null then . + [$new] else .[0:$cat] + [$new] + .[$cat:] end')

echo ""
echo "Planned ingress:"
printf '%s' "$NEW_INGRESS" | jq -r '.[] | "    \(.hostname // "(catch-all)") -> \(.service)"'
echo ""
echo "Planned Access app: $HOSTNAME_FQDN  (one-time PIN, allow: $ACCESS_EMAIL, session $SESSION_DURATION)"
echo ""

if [ "${CONFIRM:-0}" != "1" ]; then
  echo "Preview only. Nothing changed. Re-run with CONFIRM=1 to apply."
  exit 0
fi

# ── 1. Access application + policy, BEFORE the route exists ─────
echo "Creating Access application ..."
APP_ID=$(cf GET "/accounts/$ACCOUNT_ID/access/apps" \
  | jq -r --arg h "$HOSTNAME_FQDN" '.result[] | select(.domain == $h) | .id' | head -1)

if [ -n "$APP_ID" ]; then
  echo "  already exists: $APP_ID"
else
  APP_ID=$(cf POST "/accounts/$ACCOUNT_ID/access/apps" -d "$(jq -n \
      --arg h "$HOSTNAME_FQDN" --arg sd "$SESSION_DURATION" \
      '{name:"Coolify (\($h))", domain:$h, type:"self_hosted",
        session_duration:$sd, app_launcher_visible:false,
        auto_redirect_to_identity:false}')" \
    | jq -r '.result.id')
  [ -n "$APP_ID" ] && [ "$APP_ID" != "null" ] || { echo "error: app not created" >&2; exit 1; }
  echo "  created: $APP_ID"
fi

echo "Attaching allow policy ..."
HAS_POLICY=$(cf GET "/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" \
  | jq '[.result[]? | select(.decision == "allow")] | length')
if [ "${HAS_POLICY:-0}" -gt 0 ]; then
  echo "  an allow policy already exists — leaving it alone."
else
  cf POST "/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" -d "$(jq -n \
      --arg e "$ACCESS_EMAIL" \
      '{name:"Allow owner", decision:"allow", include:[{email:{email:$e}}]}')" \
    | jq -e '.success' >/dev/null && echo "  allowing $ACCESS_EMAIL"
fi

# ── 2. Only now publish the route ───────────────────────────────
if [ "$ROUTE_NEEDED" = "1" ]; then
  echo "Adding tunnel route ..."
  printf '%s' "$CURRENT" | jq --argjson ing "$NEW_INGRESS" \
      '{config: (.result.config | .ingress = $ing)}' \
    | cf PUT "$TUN_PATH" -d @- | jq -e '.success' >/dev/null \
    && echo "  routed $HOSTNAME_FQDN -> $LOCAL_SERVICE"

  echo "Ensuring DNS ..."
  EXIST=$(cf GET "/zones/$ZONE_ID/dns_records?name=$HOSTNAME_FQDN" | jq -r '.result[0].id // empty')
  REC=$(jq -n --arg n "$HOSTNAME_FQDN" --arg c "$TUNNEL_ID.cfargotunnel.com" \
        '{type:"CNAME", name:$n, content:$c, proxied:true}')
  if [ -n "$EXIST" ]; then
    cf PUT "/zones/$ZONE_ID/dns_records/$EXIST" -d "$REC" | jq -e '.success' >/dev/null && echo "  updated CNAME"
  else
    cf POST "/zones/$ZONE_ID/dns_records" -d "$REC" | jq -e '.success' >/dev/null && echo "  created CNAME"
  fi
fi

cat <<VERIFY

Done. Verify — the FIRST check is the one that matters:

  # MUST redirect to a Cloudflare Access login, NOT show Coolify
  curl -sI https://$HOSTNAME_FQDN/ | grep -iE 'location|cf-access'

  # these must be unaffected
  for h in api n8n activepieces; do
    curl -s -o /dev/null -w "\$h %{http_code}\n" https://\$h.heynikki.in/health
  done

If $HOSTNAME_FQDN serves Coolify without an Access prompt, the gate is not
working. Remove the route immediately and restore the backup:

  jq '{config: .result.config}' $BACKUP | curl -X PUT '$API$TUN_PATH' \\
    -H "Authorization: Bearer \$CF_API_TOKEN" \\
    -H 'Content-Type: application/json' -d @-
VERIFY
