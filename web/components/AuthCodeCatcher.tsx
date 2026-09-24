"use client";
/**
 * Finishes a Google sign-in wherever Supabase sends the browser back.
 *
 * Google returns through Supabase to our site with ?code=…, and nothing
 * turns that into a session unless the page it lands on starts the
 * Supabase client. When the redirect was not on the allow-list Supabase
 * falls back to the site URL — the marketing page, which never does — and
 * the person was left signed out with no message. On 24 Sep an invited
 * telecaller's Google account was created and never signed in once; the
 * invite waiting in her browser was never redeemed.
 *
 * Mounted in the root layout, so every page handles it. The browser client
 * is a singleton (@supabase/ssr), so this and a page's own client share one
 * exchange rather than racing two. A failed exchange says why instead of
 * leaving a silent login page.
 */
import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase";

export default function AuthCodeCatcher() {
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const oauthErr = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (!code && !oauthErr) return;
    // The native app finishes its own round-trip (lib/native.ts).
    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    if (oauthErr && !code) {
      setMsg(`Google sign-in didn't finish: ${oauthErr.replace(/\+/g, " ")}. Please try again.`);
      return;
    }

    (async () => {
      const sb = createClient();
      // Initialising the client exchanges the code (detectSessionInUrl);
      // asking for the session waits for that to finish.
      let { data: { session } } = await sb.auth.getSession();
      if (!session && code) {
        const r = await sb.auth.exchangeCodeForSession(code).catch((e: any) => ({ error: e, data: { session: null } }));
        session = (r as any)?.data?.session || null;
        if (!session) {
          setMsg("We couldn't finish signing you in with Google. Open the link again in the same browser "
            + "you started in (not inside WhatsApp), then choose Continue with Google.");
          return;
        }
      }
      url.searchParams.delete("code");
      // Landed somewhere that isn't the app (the site URL fallback): go in.
      // The dashboard redeems any invite stored before sign-in.
      const inApp = /^\/(dashboard|desk|leads|calls|setup|campaigns|settings|whatsapp|verification|billing)/.test(url.pathname);
      if (!inApp) { window.location.replace("/dashboard"); return; }
      window.history.replaceState({}, "", url.toString());
    })();
  }, []);

  if (!msg) return null;
  return (
    <div role="alert" style={{
      position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 9999, maxWidth: 560, margin: "0 auto",
      background: "#FEF2F2", color: "#991B1B", border: "1px solid #FCA5A5", borderRadius: 10,
      padding: "12px 14px", fontSize: 14, lineHeight: 1.5, boxShadow: "0 6px 24px rgba(0,0,0,.12)",
    }}>
      {msg}
      <button onClick={() => { setMsg(""); window.location.href = "/login"; }}
        style={{ marginLeft: 10, background: "none", border: "none", color: "#991B1B", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
        Sign in
      </button>
    </div>
  );
}
