#!/bin/sh
# Validates the NEXT_PUBLIC_* build arguments before `next build` inlines them.
#
# WHY SHAPE, NOT JUST PRESENCE
# The first version of this guard only rejected EMPTY values. The first real
# Coolify deploy then shipped NEXT_PUBLIC_API_URL set to the literal text
# "NEXT_PUBLIC_API_URL" — the variable's name pasted into its value field.
# Non-empty, so it passed, and it was compiled into three JS chunks including
# the root layout: marketing pages rendered fine while every dashboard call
# went to "NEXT_PUBLIC_API_URL/api/..." instead of the API. A presence check
# cannot catch a wrong value; a shape check catches the common ones — the
# name pasted as the value, a missing scheme, a stray quote or space from a
# copy-paste, a truncated key.
#
# Runs in the builder stage of Dockerfile, under busybox sh on alpine. Kept
# as a file rather than inline RUN so every rejection case can be tested
# directly with `sh docker/check-build-env.sh`.
#
# super-admin/docker/check-build-env.sh is an identical copy: each app is its
# own build context, so they cannot share one file. Change both together.

set -eu

fail() {
  name=$1; why=$2; val=$3
  shown=$(printf '%s' "$val" | cut -c1-60)
  {
    echo ""
    echo "ERROR: build argument $name $why"
    echo "  got: '$shown'"
    echo "  NEXT_PUBLIC_* is inlined into the bundle at build time. In Coolify,"
    echo "  set it as a BUILD-time variable, and paste only the value."
    echo ""
  } >&2
  exit 1
}

# Copy-paste debris: surrounding quotes, spaces, a trailing newline.
no_debris() {
  if printf '%s' "$2" | grep -q '[[:space:]"'"'"']'; then
    fail "$1" "contains whitespace or quote characters." "$2"
  fi
}

check_url() {
  name=$1; val=$2
  [ -n "$val" ] || fail "$name" "is empty." "$val"
  no_debris "$name" "$val"
  # https only: these are called from the visitor's browser on an https page,
  # where an http:// API is blocked as mixed content anyway.
  printf '%s' "$val" | grep -Eq '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]+)?(/[^[:space:]]*)?$' \
    || fail "$name" "must be a full https:// URL (e.g. https://api.heynikki.in)." "$val"
}

check_jwt() {
  name=$1; val=$2
  [ -n "$val" ] || fail "$name" "is empty." "$val"
  no_debris "$name" "$val"
  # Supabase anon keys are JWTs: three base64url segments. The real one is
  # ~210 characters; anything far shorter is a truncated paste.
  printf '%s' "$val" | grep -Eq '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' \
    || fail "$name" "must be a JWT (three dot-separated parts, starting eyJ)." "$val"
  [ "${#val}" -ge 100 ] || fail "$name" "is too short to be a Supabase key — truncated paste?" "$val"

  # The dangerous paste. A service_role key is ALSO a JWT starting eyJ, so the
  # shape check above passes it. Baked into a NEXT_PUBLIC_ var it ships in the
  # public bundle and hands every visitor full database access, bypassing RLS
  # — far worse than a broken dashboard. The role is readable from the token's
  # payload (base64url, unpadded), so check it rather than trust the label.
  payload=$(printf '%s' "$val" | cut -d. -f2 | tr '_-' '/+')
  case $(( ${#payload} % 4 )) in 2) payload="$payload==";; 3) payload="$payload=";; esac
  claims=$(printf '%s' "$payload" | base64 -d 2>/dev/null) \
    || fail "$name" "has a payload that is not valid base64url." "$val"
  case "$claims" in
    *'"role":"anon"'*) ;;
    *'"role":"service_role"'*)
      fail "$name" "is a SERVICE_ROLE key. NEVER put it in a NEXT_PUBLIC_ variable: it would be public, and grants full database access bypassing RLS. Use the anon key." "$val" ;;
    *) fail "$name" "is not a Supabase anon key (payload role is not \"anon\")." "$val" ;;
  esac
}

check_url NEXT_PUBLIC_API_URL           "${NEXT_PUBLIC_API_URL:-}"
check_url NEXT_PUBLIC_SUPABASE_URL      "${NEXT_PUBLIC_SUPABASE_URL:-}"
check_jwt NEXT_PUBLIC_SUPABASE_ANON_KEY "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"

# Optional (web only): unset disables voice-sample playback in /setup and
# nothing else. But if it IS set, it must be usable.
if [ -n "${NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL:-}" ]; then
  check_url NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL "$NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL"
else
  echo "note: NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL unset — in web, voice sample playback is disabled (super-admin never uses it)."
fi

echo "build env OK"
