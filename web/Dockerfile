# ─────────────────────────────────────────────────────────────
# Hey Nikki WEB — marketing site + tenant dashboard, one Next app.
# Built for Coolify on the VPS, to replace the Vercel deployment.
#
# WHY THIS IS IN web/ AND NOT AT THE REPO ROOT
# The other two images (./Dockerfile, ./Dockerfile.api) sit at the root
# because Railway builds from the repo root by default, and their headers say
# so. This one cannot follow that pattern: the root .dockerignore excludes
# `web` and `super-admin` outright — deliberately, to keep the voice-pipeline
# context from carrying the whole monorepo — so a root-level Dockerfile here
# would build with its own source missing. Coolify sets a Base Directory per
# app, so the reason those two live at the root does not apply.
#
#   Coolify:  Base Directory = web     Dockerfile Location = ./Dockerfile
#
# BUILD-TIME vs RUNTIME ENV — the one thing that breaks Next in Docker
# NEXT_PUBLIC_* is INLINED INTO THE JS BUNDLE WHEN `next build` RUNS. Setting
# those as runtime variables in Coolify does nothing at all: by the time the
# container starts, the strings are already compiled in. They have to be
# build arguments, so in Coolify they must be marked as BUILD-time variables.
# Get this wrong and you get the worst possible failure — the image builds,
# the container starts healthy, and every Supabase and API call in the
# browser goes to "undefined". The guard below refuses to build instead.
#
# These are all public values by design (anon key, public API URL); none is a
# secret, which is why baking them into the image is fine. Anything genuinely
# secret would have to be read at runtime instead — this app has nothing of
# that kind, since it holds zero API routes and no server actions.
# ─────────────────────────────────────────────────────────────

# ── deps ─────────────────────────────────────────────────────
# Node 22, not 20. Node 20 left LTS in April 2026, so it no longer receives
# security updates, and @supabase/supabase-js warns on every boot under 20:
# "Node.js 20 and below are deprecated and will no longer be supported".
# NOTE: .github/workflows/ci.yml still builds these apps on node 20, so a
# green CI run does not by itself prove this image builds. Worth aligning.
FROM node:22-alpine AS deps
# Next's SWC binary is glibc-linked; without this it fails to load on musl.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Lockfile only, so this layer is reused until dependencies actually change.
COPY package.json package-lock.json ./
# `npm ci` and NOT `--omit=dev`: next.config.js sets typescript
# .ignoreBuildErrors = false on purpose, so the build runs tsc and needs the
# TypeScript devDependency. Dropping dev deps here fails the build later, in a
# much more confusing place.
RUN npm ci

# ── builder ──────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Required — the app is broken in the browser without them.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Optional. sampleUrl() in app/setup/page.tsx returns null when this is
# unset and the UI disables sample playback with a tooltip, so an empty value
# degrades one button rather than breaking the page.
ARG NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL
# Optional. Read by the `verification` block in app/layout.tsx metadata.
ARG GOOGLE_SITE_VERIFICATION
ARG BING_SITE_VERIFICATION

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL=$NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL \
    GOOGLE_SITE_VERIFICATION=$GOOGLE_SITE_VERIFICATION \
    BING_SITE_VERIFICATION=$BING_SITE_VERIFICATION

# Fail loudly now rather than shipping an image that looks fine and is not.
# A missing NEXT_PUBLIC_* does not break `next build`; it compiles the literal
# `undefined` into the bundle and the break only shows up in a browser.
RUN set -e; \
    for pair in \
      "NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL" \
      "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" \
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    ; do \
      name=${pair%%=*}; value=${pair#*=}; \
      if [ -z "$value" ]; then \
        echo "" >&2; \
        echo "ERROR: build argument $name is empty." >&2; \
        echo "  NEXT_PUBLIC_* is inlined at build time. Set it as a BUILD-time" >&2; \
        echo "  variable in Coolify, not a runtime one, or the deployed app" >&2; \
        echo "  will call 'undefined' from the browser." >&2; \
        echo "" >&2; \
        exit 1; \
      fi; \
    done; \
    [ -n "$NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL" ] || \
      echo "note: NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL unset — voice sample playback will be disabled."

RUN npm run build

# ── runner ───────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Next phones home with anonymous build/usage data unless told not to.
ENV NEXT_TELEMETRY_DISABLED=1

# -G nodejs matters: without it adduser puts nextjs in `nogroup`, so every
# --chown=nextjs:nodejs below sets a group the running user is not in. It
# still worked, because the files are owned by nextjs directly, but the group
# was decoration. Verified with `id`: uid=1001(nextjs) gid=1001(nodejs).
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# `output: "standalone"` in next.config.js produces .next/standalone: a
# server.js plus only the traced node_modules. It does NOT include these two,
# which have to be placed by hand or every asset and image 404s at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# HOSTNAME is the important one. server.js binds to localhost when it is
# unset, which inside a container means nothing outside can reach it — the
# app looks healthy in its own logs while Coolify's proxy gets connection
# refused. PORT is here so it is visible; override both in Coolify if needed.
ENV PORT=3000 \
    HOSTNAME=0.0.0.0

# Uses busybox wget, already in the base image, so this adds no dependency.
# "/" is the marketing landing page: prerendered, public, and needs neither a
# session nor the API to return 200, which makes it a real liveness signal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
