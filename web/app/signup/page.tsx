"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import NikkiLogo from "../../components/NikkiLogo";
import { Mail } from "lucide-react";

const J = {
  bg: "#FFFFFF", vault: "#F6F8FB", surface: "#FFFFFF",
  border: "#E2E8F0", borderHi: "#CBD5E1",
  mercury: "#12457A", surya: "#E5533D", chandra: "#0F172A",
  textMid: "#475569", textDim: "#94A3B8", red: "#EF4444",
  grad: "linear-gradient(135deg, #12457A 0%, #1D6FA5 100%)",
};

// Supabase speaks to developers; this page speaks to a shop owner in
// Hyderabad. Raw err.message was being printed straight into the red box, so
// a person who mistyped and pressed the button twice got "For security
// purposes, you can only request this after 33 seconds." — and one who had
// already signed up got "User already registered" with no way forward.
// Anything not recognised falls through to the original text rather than a
// vague "something went wrong", so we never hide a real fault from ourselves.
function humanSignupError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "This email already has a Nikki account. Sign in instead, or use 'Forgot password' if you can't remember it.";
  }
  if (m.includes("only request this after") || m.includes("rate limit") || m.includes("too many")) {
    return "You've tried a few times in quick succession. Please wait about a minute and try once more.";
  }
  if (m.includes("password")) {
    return "That password is too short. Use at least 8 characters.";
  }
  if (m.includes("invalid format") || m.includes("validate email") || m.includes("invalid email")) {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "We couldn't reach our servers. Check your internet connection and try again.";
  }
  return raw;
}

export default function SignupPage() {
  // An invited colleague arrives at /signup?invite=<token>. Their account is
  // created the normal way — the signup trigger even gives them their own
  // empty tenant — and the token is redeemed straight afterwards, which
  // moves them onto the team that invited them and clears the shell.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  // What the link is, checked before they fill anything in. Without it an
  // invited colleague saw the new-business form ("Business name", "100
  // minutes free") and took the link for a wrong one, and a dead link only
  // failed after signup and email confirmation, silently.
  const [invite, setInvite] = useState<
    { status: "loading" | "valid" | "expired" | "used" | "invalid" | "error";
      business?: string; email?: string } | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("invite");
    if (!t) return;
    setInviteToken(t);
    setInvite({ status: "loading" });
    // Kept for the sign-in path too: someone who already has an account
    // follows "Sign in" and joins from the dashboard.
    try { localStorage.setItem("nikki_invite", t); } catch {}
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/team/invite-preview?token=${encodeURIComponent(t)}`)
      .then(r => r.json())
      .then(j => {
        setInvite({ status: j.status || "error", business: j.business, email: j.email });
        if (j.status === "valid" && j.email) setEmail(j.email);
        if (j.status !== "valid") { try { localStorage.removeItem("nikki_invite"); } catch {} }
      })
      .catch(() => setInvite({ status: "error" }));
  }, []);
  const joining = invite?.status === "valid";

  const [businessName, setBusinessName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }
    const sb = createClient();
    const { data: su, error: err } = await sb.auth.signUp({
      email, password,
      options: {
        // Carried into handle_new_user, which normalises it and writes it to
        // the owner's tenant_users row. Without it there is no address for a
        // single onboarding message — the first thing a customer would hear
        // from HeyNikki is a message their own caller triggered.
        // A colleague joining a team gives no business name: the shell
        // tenant the signup trigger creates is removed when they join.
        data: joining ? { owner_phone: ownerPhone }
                      : { business_name: businessName, owner_phone: ownerPhone },
        // The invite rides through the verification link, because there is
        // no session to redeem it with until the address is confirmed.
        // Stored locally too, in case they verify in a different tab.
        emailRedirectTo: window.location.origin + "/dashboard"
          + (inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""),
      },
    });
    if (err) { setError(humanSignupError(err.message)); setLoading(false); return; }
    // An address that already has an account comes back as a success with
    // no identities, and Supabase sends nothing — deliberately, so sign-up
    // cannot be used to discover who is registered. The page then said
    // "check your email" for a mail that was never coming: an invited
    // telecaller whose address was already on a Google account waited for
    // it. Say so, and send them to sign in with the invite kept.
    if (su?.user && Array.isArray(su.user.identities) && su.user.identities.length === 0) {
      if (inviteToken) { try { localStorage.setItem("nikki_invite", inviteToken); } catch {} }
      setError("ALREADY_REGISTERED");
      setLoading(false);
      return;
    }
    if (inviteToken) { try { localStorage.setItem("nikki_invite", inviteToken); } catch {} }
    setDone(true);
    setLoading(false);
  };

  if (done && joining) {
    return (
      <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{
          background: J.vault, border: `1px solid ${J.border}`,
          borderRadius: 16, padding: 40, maxWidth: 420, textAlign: "center",
        }}>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}><Mail size={44} /></div>
          <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, color: J.chandra }}>
            Check your email
          </h2>
          <p style={{ color: J.textMid, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            We sent a confirmation link to<br />
            <span style={{ color: J.mercury, fontWeight: 700 }}>{email}</span>.<br />
            Open it, and you&apos;ll join <strong style={{ color: J.chandra }}>{invite?.business}</strong>{" "}
            automatically.
          </p>
          <p style={{ color: J.textDim, fontSize: 12, margin: 0 }}>
            Can&apos;t see it? Check your spam folder — it arrives within a minute.
          </p>
        </div>
      </div>
    );
  }

  // A link that cannot be used says so now, not after signup.
  if (invite && invite.status !== "valid" && invite.status !== "loading") {
    const why = invite.status === "used" ? "This invite link has already been used."
      : invite.status === "expired" ? "This invite link has expired."
      : invite.status === "error" ? "We couldn't check this invite link. Check your connection and reload the page."
      : "This invite link isn't valid — it may have been replaced by a newer one.";
    return (
      <div style={{ minHeight: "100vh", background: J.bg, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{
          background: J.vault, border: `1px solid ${J.border}`,
          borderRadius: 16, padding: 36, maxWidth: 420, textAlign: "center",
        }}>
          <div style={{ marginBottom: 16, display: "inline-block" }}>
            <NikkiLogo size={64} variant="icon" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 10px", color: J.chandra }}>{why}</h2>
          <p style={{ color: J.textMid, fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
            {invite.status === "error"
              ? "If it keeps happening, ask the person who invited you to send the link again."
              : "Ask the person who invited you to copy your link again from their Team page and send it to you."}
          </p>
          {invite.status === "used" && (
            <Link href="/login" style={{ color: J.mercury, fontWeight: 700, textDecoration: "none", fontSize: 14 }}>
              Already joined? Sign in →
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{
          background: J.vault, border: `1px solid ${J.border}`,
          borderRadius: 16, padding: 40, maxWidth: 420, textAlign: "center",
        }}>
          <div style={{ marginBottom: 20, display: "inline-block" }}>
            <NikkiLogo size={64} variant="icon" />
          </div>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}><Mail size={44} /></div>
          <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, color: J.chandra }}>
            Check your email
          </h2>
          <p style={{ color: J.textMid, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            We sent a confirmation link to<br />
            <span style={{ color: J.mercury, fontWeight: 700 }}>{email}</span>
          </p>
          <p style={{ color: J.textDim, fontSize: 12, marginBottom: 20 }}>
            Can&apos;t see it? Check your spam folder — it arrives within a minute.
          </p>

          {/* The funnel used to end here: "check your email", then silence.
              A new owner had no idea that a phone number is not instant, that
              KYC exists, or that a human assigns the number — so the first
              time they learned it was when they went looking for a number
              that was not there. Say the sequence up front; it is short, and
              every step of it is real. */}
          <ol style={{
            textAlign: "left", margin: "0 0 24px", padding: "16px 18px 16px 34px",
            background: J.surface, border: `1px solid ${J.border}`, borderRadius: 12,
            color: J.textMid, fontSize: 13, lineHeight: 1.65,
          }}>
            <li style={{ marginBottom: 8 }}>
              <strong style={{ color: J.chandra }}>Confirm your email</strong> — then sign
              in and set up Nikki: your business hours, your services and prices, and the
              language your line should answer in.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong style={{ color: J.chandra }}>Send your KYC</strong> — a business
              proof and an ID, uploaded from your dashboard. An Indian phone number cannot
              legally be assigned without it.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong style={{ color: J.chandra }}>We assign your number</strong> — usually
              within one business day of KYC approval. Forward your existing number to it,
              or hand out the new one.
            </li>
            <li>
              <strong style={{ color: J.chandra }}>Your 100 free minutes</strong> are
              already on the account, and are used as real calls are answered. No card,
              and nothing switches off at the end of a trial week.
            </li>
          </ol>

          <Link href="/login" style={{
            display: "inline-block", background: J.grad, color: J.bg,
            padding: "12px 28px", borderRadius: 10, textDecoration: "none",
            fontWeight: 700, fontSize: 14,
          }}>Go to Sign In</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: J.bg, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ marginBottom: 20, display: "inline-block" }}>
            <NikkiLogo size={84} variant="stacked" />
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: J.chandra,
            margin: "0 0 6px", letterSpacing: -0.5,
          }}>{invite?.status === "loading" ? "Checking your invite…"
               : joining ? `Join ${invite?.business} on HeyNikki` : "Start free — 100 minutes"}</h1>
          <div style={{ color: J.textMid, fontSize: 14 }}>
            {joining ? "You've been invited to their team. Create your account to join."
                     : invite?.status === "loading" ? "\u00a0" : "100 minutes free · No credit card required"}
          </div>
        </div>

        <div style={{
          background: J.vault, border: `1px solid ${J.border}`,
          borderRadius: 16, padding: 32,
        }}>
          <form onSubmit={handleSignup}>
            {error && (
              <div style={{
                background: `${J.red}22`, color: J.red,
                padding: "10px 12px", borderRadius: 8,
                fontSize: 13, marginBottom: 16,
                border: `1px solid ${J.red}44`,
              }}>{error === "ALREADY_REGISTERED" ? (
                <>
                  This email already has a HeyNikki account, so no new confirmation email was sent.{" "}
                  <Link href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"} style={{ color: J.red, fontWeight: 700 }}>
                    Sign in instead
                  </Link>
                  {" "}— use <strong>Continue with Google</strong> if you signed up with Google, or{" "}
                  <Link href="/forgot-password" style={{ color: J.red, fontWeight: 700 }}>reset your password</Link>.
                  {inviteToken ? " You'll join the team as soon as you're in." : ""}
                </>
              ) : error}</div>
            )}

            {!joining && (<>
            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              BUSINESS NAME
            </label>
            <input
              type="text" value={businessName} onChange={e => setBusinessName(e.target.value)}
              required placeholder="Ravi Clinic, Banjara Hills"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 16,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 14, outline: "none",
              }}
            />
            </>)}

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              {joining ? <>YOUR MOBILE NUMBER <span style={{ color: J.textDim, fontWeight: 400, letterSpacing: 0 }}>(optional)</span></>
                       : "YOUR WHATSAPP NUMBER"}
            </label>
            <input
              type="tel" value={ownerPhone}
              onChange={e => setOwnerPhone(e.target.value.replace(/[^\d+ ]/g, ""))}
              required={!joining} inputMode="numeric" placeholder="98765 43210"
              // The first organic signup typed eleven digits; last-10
              // truncation kept the wrong ten and their onboarding went to
              // a number starting with 4. Validate the shape HERE, where
              // the person who knows the right number is still looking.
              pattern="^(\+?91)?[\s]*[6-9][0-9\s]{9,13}$"
              title="10-digit mobile starting 6-9"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 16,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 6, outline: "none",
              }}
            />
            <div style={{ color: J.textDim, fontSize: 11.5, marginBottom: 14, lineHeight: 1.5 }}>
              {joining ? "The number the Desk rings you on for calls. You can add it later."
                       : "Where we send your setup updates. Not shown to your callers."}
            </div>

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              EMAIL
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required placeholder="you@business.in"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 16,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 14, outline: "none",
              }}
            />

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              PASSWORD <span style={{ color: J.textDim, fontWeight: 400, letterSpacing: 0 }}>(min 8 chars)</span>
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required minLength={8} placeholder="••••••••"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 16,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 20, outline: "none",
              }}
            />

            <button type="submit" disabled={loading || invite?.status === "loading"} style={{
              width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
              background: loading ? J.surface : J.grad,
              color: loading ? J.textMid : J.bg, border: "none", borderRadius: 10,
              cursor: loading ? "wait" : "pointer", marginBottom: 10,
            }}>
              {loading ? "Creating account..." : joining ? "Create account & join →" : "Start free →"}
            </button>

            {/* These were plain text. An agreement the user cannot read before
                accepting is not an agreement, and Razorpay's merchant review
                looks for exactly this link pair on the signup surface. */}
            <p style={{ fontSize: 11.5, color: J.textDim, textAlign: "center", margin: 0, lineHeight: 1.6 }}>
              By creating an account you agree to our{" "}
              <Link href="/terms" style={{ color: J.mercury, fontWeight: 600 }}>Terms of Service</Link>{" "}
              and{" "}
              <Link href="/privacy" style={{ color: J.mercury, fontWeight: 600 }}>Privacy Policy</Link>.
            </p>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: J.textMid }}>
          Already have an account?{" "}
          <Link href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"} style={{ color: J.mercury, fontWeight: 700, textDecoration: "none" }}>
            Sign in →
          </Link>
        </div>
      </div>
    </div>
  );
}
