# ─────────────────────────────────────────────────────────────
# Hey Nikki SUPER-ADMIN — the platform operator's panel.
# Built for Coolify on the VPS, to replace the Vercel deployment.
#
# WHY THIS IS IN super-admin/ AND NOT AT THE REPO ROOT
# Same reason as web/Dockerfile: the root .dockerignore excludes
# `super-admin` outright, to keep the voice-pipeline build context small, so a
# root-level Dockerfile here would build without its own source. Coolify sets
# a Base Directory per app, so the Railway constraint that put ./Dockerfile
# and ./Dockerfile.api at the root does not apply.
#
#   Coolify:  Base Directory = super-admin   Dockerfile Location = ./Dockerfile
#
# BUILD-TIME vs RUNTIME ENV
# NEXT_PUBLIC_* is inlined into the bundle when `next build` runs, so these
# must be BUILD-time variables in Coolify. As runtime variables they do
# nothing and the deployed panel calls "undefined" from the browser. The
# guard below fails the build rather than let that ship.
#
# THIS ONE DESERVES MORE CARE THAN web
# It is the operator panel across every tenant. Do not put it on a public
# hostname without access control in front — Cloudflare Access, an allowlist,
# or at minimum HTTP auth at the proxy. Its own login is the last line of
# defence, not the only one it should have.
# ─────────────────────────────────────────────────────────────

# ── envcheck ─────────────────────────────────────────────────
# Validates the build arguments FIRST, before any dependency install. It used
# to run in the builder stage, after `npm ci` (95s) and the node_modules copy
# (158s), so the first bad Coolify deploy took ~6 minutes to be told its API
# URL was wrong. Here it fails in seconds.
#
# `deps` COPYs this stage's marker file, and that dependency is what makes it
# run at all: BuildKit, which Coolify uses, builds only the stages the target
# needs and silently skips an unreferenced one. The marker is empty and never
# changes, so editing a build arg re-runs this check without invalidating the
# cached `npm ci` below.
FROM node:22-alpine AS envcheck
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
COPY docker/check-build-env.sh /check-build-env.sh
RUN sh /check-build-env.sh && touch /build-env-ok

# ── deps ─────────────────────────────────────────────────────
# Node 22, not 20: Node 20 left LTS in April 2026 and @supabase/supabase-js
# warns on every boot under it. ci.yml still uses node 20 for these apps, so
# a green CI run does not by itself prove this image builds.
FROM node:22-alpine AS deps
# Must stay the first step of this stage: it orders npm ci after the envcheck
# stage, so a bad build arg stops the build before the install starts.
COPY --from=envcheck /build-env-ok /tmp/build-env-ok
# Next's SWC binary is glibc-linked; without this it fails to load on musl.
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ──────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Build args were already validated in the envcheck stage, before npm ci.

RUN npm run build

# ── runner ───────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# -G nodejs matters: without it adduser puts nextjs in `nogroup`, so every
# --chown=nextjs:nodejs below sets a group the running user is not in.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# .next/standalone carries server.js and the traced node_modules but not
# .next/static, which has to be placed by hand or every asset 404s.
#
# There is deliberately no `COPY public` here: super-admin has no public/
# directory, and copying a path that does not exist fails the build. Add the
# line if that directory is ever introduced.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# HOSTNAME matters: server.js binds localhost when it is unset, which inside
# a container means nothing outside can reach it — healthy logs, and
# connection refused at the proxy.
ENV PORT=3000 \
    HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
