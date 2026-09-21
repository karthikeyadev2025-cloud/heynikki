/** @type {import('next').NextConfig} */
module.exports = {
  // Emits .next/standalone — a self-contained server.js plus only the
  // node_modules Next actually traced. Without it the runtime image has to
  // carry the whole dependency tree (super-admin/node_modules is 714MB) just
  // to run `next start`. super-admin/Dockerfile's final stage copies that
  // output, so removing this line leaves it with no server.js and the build
  // fails. Vercel ignores the setting, so this is safe to keep during the move.
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
};
