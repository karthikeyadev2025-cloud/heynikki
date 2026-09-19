"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NIKKI } from "../lib/brand";

/**
 * DPDP Act 2023 cookie notice.
 *
 * Stores acknowledgement in localStorage so it doesn't reappear. Note:
 * the underlying app only uses ESSENTIAL cookies (Supabase session,
 * CSRF token), so we present this as a notice + acknowledge rather than
 * an opt-in/opt-out toggle. If we ever add advertising / analytics
 * cookies, replace this with a proper consent UI with per-category
 * toggles BEFORE setting those cookies.
 *
 * ── Why it is shaped like this ──────────────────────────────────────
 * It used to be a 720px-wide card floating 16px off the bottom with
 * left:16 right:16, which on a 360px phone is a three-line panel sitting
 * on top of the page — over the demo console on the landing page, over
 * the bottom of every dashboard list, and over the Ask-Nikki button. A
 * notice nobody has to agree to was hiding the thing the page is for.
 *
 * Now: one compact line pinned to the very bottom, and the page is padded
 * by exactly its height, so the bar covers the padding rather than the
 * content and the bottom of every page is still reachable.
 *
 * It also publishes its height as --nk-cookie-h on <html>, so anything
 * else that pins itself to the bottom (the landing page's mobile CTA) can
 * sit above it instead of underneath it.
 */
export default function CookieBanner() {
  const [ack, setAck] = useState(true); // hide while we check localStorage

  useEffect(() => {
    try {
      setAck(localStorage.getItem("nikki-cookie-ack") === "1");
    } catch {
      // localStorage blocked (private mode / disabled cookies). Show banner
      // but accept clicks won't persist — that's fine, just shows again next visit.
      setAck(false);
    }
  }, []);

  // Reserve the space the bar occupies rather than floating over the page,
  // and hand the height to anything else that pins to the bottom. Cleared on
  // unmount and on accept so nothing is left padded forever.
  useEffect(() => {
    const root = document.documentElement;
    if (ack) {
      root.style.removeProperty("--nk-cookie-h");
      document.body.style.removeProperty("padding-bottom");
      return;
    }
    const apply = () => {
      const h = document.getElementById("nk-cookie-bar")?.offsetHeight || 56;
      root.style.setProperty("--nk-cookie-h", `${h}px`);
      document.body.style.paddingBottom = `${h}px`;
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--nk-cookie-h");
      document.body.style.removeProperty("padding-bottom");
    };
  }, [ack]);

  const accept = () => {
    try { localStorage.setItem("nikki-cookie-ack", "1"); } catch {}
    setAck(true);
  };

  if (ack) return null;

  return (
    <>
      <style>{`
        #nk-cookie-bar {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 9000;
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 10px 16px;
          background: ${NIKKI.surface};
          border-top: 1px solid ${NIKKI.border};
          box-shadow: 0 -6px 20px rgba(15, 23, 42, 0.08);
          font-size: 13px; line-height: 1.45; color: ${NIKKI.textMid};
        }
        #nk-cookie-bar a { color: ${NIKKI.teal}; font-weight: 700; text-decoration: underline; }
        #nk-cookie-bar button {
          flex: none; padding: 9px 18px; border: none; border-radius: 8px;
          background: ${NIKKI.gradient}; color: #FFFFFF;
          font-weight: 800; font-size: 13px; font-family: inherit; cursor: pointer;
        }
        @media (max-width: 767px) {
          #nk-cookie-bar { padding: 9px 12px; font-size: 12px; gap: 10px; }
          #nk-cookie-bar button { padding: 8px 14px; font-size: 12px; }
        }
      `}</style>
      <div id="nk-cookie-bar" role="region" aria-live="polite" aria-label="Cookie notice">
        <div style={{ minWidth: 0 }}>
          {/* Teal on white, not teal on near-black: the old panel put #12457A
              on #0F172A, a contrast ratio of about 1.9:1 — invisible on a
              phone screen in daylight, which is where this is read. */}
          <strong style={{ color: NIKKI.text }}>Essential cookies only</strong>
          {" "}— for your login and security. No ads, no tracking.{" "}
          <Link href="/privacy">Privacy policy</Link>
        </div>
        <button onClick={accept}>Got it</button>
      </div>
    </>
  );
}
