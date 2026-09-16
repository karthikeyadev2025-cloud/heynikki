// The shared secret on every service-to-service call: API server, scheduler,
// outbound dispatcher, voice pipeline.
//
// It used to be read in five places as `process.env.INTERNAL_SECRET!`, or as
// `|| ""`. The `!` is a TypeScript assertion and checks NOTHING at runtime,
// so with the variable unset the constant was `undefined` — and verifyInternal
// compared it against a missing request header, which is also `undefined`:
//
//     undefined !== undefined   ->   false   ->   the 401 never fired
//
// A single missing environment variable therefore opened every route behind
// verifyInternal to anyone who sent no header at all — WhatsApp sending, the
// FreeSWITCH webhooks, and `POST /api/keys`, which mints API credentials. It
// failed OPEN, and silently, which is the worst way for an auth check to fail.
//
// So the secret is read once, here, and the process refuses to start without
// it. A service that cannot authenticate its peers should not accept traffic.
// Every entrypoint that needs the secret imports this module, so the check
// runs in each of them — scheduler and outbound-dispatcher are separate
// processes and never load index.ts.
import crypto from "crypto";

function requireInternalSecret(): string {
  // Validate on the trimmed form but return the RAW value. index.ts derives
  // the trunk-credential encryption key from this string
  // (sha256("trunk:" + secret)), so silently trimming a deployed secret that
  // happens to carry trailing whitespace would change that key and make
  // every already-encrypted trunk password undecryptable. Reject blank;
  // never rewrite.
  const v = process.env.INTERNAL_SECRET || "";
  if (!v.trim()) {
    console.error(
      "FATAL: INTERNAL_SECRET is not set.\n" +
      "  It authenticates every call between the API server, the scheduler,\n" +
      "  the outbound dispatcher and the voice pipeline.\n" +
      "  Generate one with:  openssl rand -hex 32\n" +
      "  and set the SAME value on every one of those services."
    );
    process.exit(1);
  }
  return v;
}

export const INTERNAL_SECRET = requireInternalSecret();

/**
 * Constant-time check of a request's x-internal-secret header.
 *
 * Absent, blank or non-string headers are rejected outright rather than
 * compared — that is the case that used to authenticate itself.
 */
export function internalSecretOk(supplied: unknown): boolean {
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  // Digest both sides first: timingSafeEqual throws when the two buffers are
  // different lengths, and catching that would leak the secret's length
  // through the difference between a throw and a false.
  const a = crypto.createHash("sha256").update(supplied, "utf8").digest();
  const b = crypto.createHash("sha256").update(INTERNAL_SECRET, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}
