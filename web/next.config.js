/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone — a self-contained server.js plus only the
  // node_modules Next actually traced. Without it the runtime image has to
  // carry the whole dependency tree (web/node_modules is 835MB) just to run
  // `next start`. web/Dockerfile's final stage copies that output, so
  // removing this line leaves it with no server.js and the build fails.
  // Vercel ignores the setting, so this is safe to keep during the move.
  output: "standalone",
  reactStrictMode: true,
  typescript: {
    // Was `ignoreBuildErrors: true` — that suppression is exactly how two
    // real bugs (undefined `C.acc` in calls/page.tsx and Shell.tsx) shipped
    // silently. Codebase is now confirmed clean via `tsc --noEmit`; keep
    // this false so the next real type error actually fails the build.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};
module.exports = nextConfig;
