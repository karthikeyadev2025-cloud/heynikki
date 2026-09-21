#!/usr/bin/env bash
#
# Cloudflare cache rules for www.heynikki.in
#
# WHY THIS EXISTS
# Cloudflare sits in front of Vercel and, until this ran, cached nothing:
#
#   HTML:      cf-cache-status: DYNAMIC   (every pageview reached Vercel)
#   hero.mp4:  500,624 bytes  MISS
#   hero.webm: 476,738 bytes  REVALIDATED
#              cache-control: public, max-age=14400, must-revalidate
#
# Next.js sends `max-age=0, must-revalidate` on HTML, which Cloudflare
# honours by not caching, so essentially 100% of bytes were billed to
# Vercel while the free CDN already in the path did nothing. The landing
# page alone ships a ~500KB hero video to every new visitor. That is the
# Pro-plan overage.
#
# Overriding edge TTL is the only way to cache past the origin's
# `max-age=0`, which is why every rule sets edge_ttl.mode=override_origin.
#
# TWO CONSTRAINTS THAT SHAPE EVERY RULE HERE
#
# 1. www.heynikki.in is ONE Next app serving BOTH the public marketing
#    site and the logged-in dashboard. /dashboard, /calls, /billing,
#    /leads, /admin and twelve more sit on the same hostname as / and
#    /pricing. So the HTML rule is a strict ALLOWLIST of public paths.
#    A denylist would mean any dashboard route added later is cached —
#    and therefore served to the wrong tenant — by default. The pages are
#    "use client" today, so their HTML holds no user data, but @supabase/ssr
#    is installed: the day one becomes a server component, a denylist turns
#    a refactor into a data leak. The allowlist costs nothing, because the
#    bytes are in /_next/static and the hero video, not in dashboard HTML.
#
# 2. Cache rules apply to the WHOLE ZONE, and this zone also answers for
#    api.heynikki.in, n8n.heynikki.in and activepieces.heynikki.in — all
#    served from the on-prem box through the tunnel, none of which may
#    ever be cached. Rule 2 matches on file extension, which without a
#    host guard would happily cache API responses. Every rule is therefore
#    scoped with http.host.
#
# SAFETY
# The Rulesets API PUT replaces the entire cache phase, so this script
# backs up the existing ruleset and refuses to change anything unless you
# pass CONFIRM=1. Run it once without that to see what would happen.
#
# USAGE
#   export CF_API_TOKEN=...      # Zone:Cache Rules:Edit + Zone:Zone:Read
#   ./cloudflare-cache-rules.sh            # preview + back up only
#   CONFIRM=1 ./cloudflare-cache-rules.sh  # apply
#
# Create the token at dash.cloudflare.com > My Profile > API Tokens >
# Create Token > Custom. Scope it to the heynikki.in zone only; it does
# not need account-level access and must not be reused as an R2 key.

set -euo pipefail

ZONE_NAME="${ZONE_NAME:-heynikki.in}"
API="https://api.cloudflare.com/client/v4"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")" && pwd)/cloudflare-backups}"

if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "error: CF_API_TOKEN is not set." >&2
  echo "       Needs Zone:Zone:Read and Zone:Cache Rules:Edit on $ZONE_NAME." >&2
  exit 1
fi

cf() {
  local method="$1" path="$2"; shift 2
  curl -fsS --max-time 30 -X "$method" "$API$path" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" "$@"
}

need() { command -v "$1" >/dev/null || { echo "error: $1 is required" >&2; exit 1; }; }
need curl; need jq

# ── Resolve the zone ────────────────────────────────────────────
echo "Resolving zone $ZONE_NAME ..."
ZONE_ID=$(cf GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].id // empty')
[ -n "$ZONE_ID" ] || { echo "error: zone $ZONE_NAME not found, or the token cannot read it." >&2; exit 1; }
echo "  zone id: $ZONE_ID"

# ── Back up whatever is there now ───────────────────────────────
# A PUT to the phase entrypoint REPLACES every rule in it. If someone has
# added cache rules by hand, this is the only copy of them.
PHASE="/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$BACKUP_DIR/cache-rules-$STAMP.json"

if EXISTING=$(cf GET "$PHASE" 2>/dev/null); then
  printf '%s' "$EXISTING" > "$BACKUP"
  n=$(printf '%s' "$EXISTING" | jq '[.result.rules // []] | flatten | length')
  echo "Existing cache rules: $n  (backed up to $BACKUP)"
  if [ "$n" -gt 0 ]; then
    printf '%s' "$EXISTING" | jq -r '.result.rules[] | "  - \(.description // "(no description)")"'
    echo
    echo "NOTE: applying will REPLACE the rules above. Restore with:"
    echo "  jq '{rules: .result.rules}' $BACKUP | curl -X PUT '$API$PHASE' \\"
    echo "    -H \"Authorization: Bearer \$CF_API_TOKEN\" -H 'Content-Type: application/json' -d @-"
    echo
  fi
else
  echo "No cache ruleset exists yet (nothing to back up)."
fi

# ── The rules ───────────────────────────────────────────────────
HOSTS='http.host in {"www.heynikki.in" "heynikki.in"}'

# Public marketing pages only. Every path here was confirmed to have no
# session check in web/app/<path>/page.tsx. Everything absent from this
# list keeps Cloudflare's default for HTML, which is not to cache.
#
# Deliberately EXCLUDED, all of which call getSession/getUser:
#   /admin /analytics /api-keys /appointments /billing /calls /campaigns
#   /dashboard /desk /knowledge /leads /orders /quality /setup
#   /verification /whatsapp
# and the credential forms /login /signup /forgot-password /reset-password,
# which must always reach the origin.
PUBLIC_PATHS='"/" "/about" "/pricing" "/contact" "/developers" "/alternatives" "/ai-telecaller" "/telugu-ai-receptionist" "/for/clinics" "/for/real-estate" "/privacy" "/terms" "/refund-policy"'

RULES=$(jq -n \
  --arg hosts "$HOSTS" \
  --arg paths "$PUBLIC_PATHS" \
  '{
    rules: [
      {
        # Next.js content-hashes these filenames, so a new build emits new
        # URLs and a stale copy is unreachable rather than wrong. Immutable
        # by construction, which is why a year is safe.
        description: "Cache _next/static immutably",
        expression: "(\($hosts) and http.request.uri.path contains \"/_next/static/\")",
        action: "set_cache_settings",
        action_parameters: {
          cache: true,
          edge_ttl:    { mode: "override_origin", default: 31536000 },
          browser_ttl: { mode: "override_origin", default: 31536000 }
        }
      },
      {
        # Where the money is: hero.mp4 + hero.webm are ~977KB combined and
        # were being pulled from Vercel per visitor. Host-scoped so this
        # never touches api/n8n/activepieces on the same zone.
        description: "Cache static media and fonts",
        expression: "(\($hosts) and http.request.uri.path.extension in {\"mp4\" \"webm\" \"png\" \"jpg\" \"jpeg\" \"svg\" \"webp\" \"avif\" \"ico\" \"woff\" \"woff2\" \"ttf\"})",
        action: "set_cache_settings",
        action_parameters: {
          cache: true,
          edge_ttl:    { mode: "override_origin", default: 2592000 },
          browser_ttl: { mode: "override_origin", default: 86400 }
        }
      },
      {
        # Allowlist, not denylist — see the header. One hour, so a copy
        # edit is live within the hour without a purge.
        #
        # The cookie guard is defence in depth: a visitor carrying a
        # Supabase session (sb-*) bypasses the cache entirely even on a
        # marketing page, so no cached variant can ever be handed to a
        # logged-in user. That traffic is negligible.
        description: "Cache public marketing pages (allowlist, anonymous only)",
        # `not (...)` is parenthesised deliberately: this guard is the thing
        # standing between a logged-in visitor and a cached page, and it must
        # not depend on how the parser binds a bare `not`.
        expression: "(\($hosts) and http.request.uri.path in {\($paths)} and not (http.cookie contains \"sb-\"))",
        action: "set_cache_settings",
        action_parameters: {
          cache: true,
          edge_ttl:    { mode: "override_origin", default: 3600 },
          browser_ttl: { mode: "override_origin", default: 0 }
        }
      }
    ]
  }')

echo "Rules to apply:"
printf '%s' "$RULES" | jq -r '.rules[] | "  \(.description)\n      \(.expression)"'
echo

if [ "${CONFIRM:-0}" != "1" ]; then
  echo "Preview only. Nothing was changed."
  echo "Re-run with CONFIRM=1 to apply."
  exit 0
fi

echo "Applying ..."
RESULT=$(printf '%s' "$RULES" | cf PUT "$PHASE" -d @-)
printf '%s' "$RESULT" | jq -e '.success' >/dev/null \
  && echo "Applied $(printf '%s' "$RESULT" | jq '.result.rules | length') rules." \
  || { echo "FAILED:"; printf '%s' "$RESULT" | jq '.errors'; exit 1; }

cat <<'VERIFY'

Verify (allow a minute to propagate):

  # should become HIT on the second request
  curl -sI https://www.heynikki.in/hero.mp4 | grep -i cf-cache-status
  curl -sI https://www.heynikki.in/         | grep -i cf-cache-status

  # MUST stay DYNAMIC/BYPASS — if either says HIT, stop and restore the backup
  curl -sI https://www.heynikki.in/dashboard | grep -i cf-cache-status
  curl -sI https://api.heynikki.in/health    | grep -i cf-cache-status

After a deploy that changes copy on a marketing page, either wait an hour
or purge that URL — /_next/static needs no purge, the filenames change.
VERIFY
