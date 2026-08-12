# Runs via docker-compose on EC2 (see infra/docker-compose.yml) — not
# Railway, which was removed from the architecture. PORT=4000 is set
# explicitly in docker-compose.yml's environment for this service.
#
# node:22-slim (not 20): @supabase/supabase-js's realtime-js dependency
# requires native WebSocket support, only available in Node 22+.
# Confirmed via the actual runtime crash: "Error: Node.js detected but
# native WebSocket not found... Ensure you are running Node.js 22+."
FROM node:22-slim

# docker-compose.yml's healthcheck runs curl against /health, but
# node:22-slim (Debian-based) doesn't include curl by default.
# Confirmed via `docker exec heynikki-api which curl` returning empty —
# the app itself was running fine, only the healthcheck command was
# missing its own binary, reporting "unhealthy" for a healthy app.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first so Docker caches this layer across code changes.
COPY package*.json ./
RUN npm install

COPY . .

# Compile TypeScript -> dist/
RUN npm run build

CMD ["node", "dist/index.js"]
