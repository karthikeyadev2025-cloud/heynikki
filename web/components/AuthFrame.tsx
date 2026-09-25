"use client";
/**
 * The frame around sign-in and sign-up.
 *
 * Someone arriving here has just left the landing page, so the left panel
 * carries its headline and its three promises in the same ink navy — signing
 * in should feel like the same product, not a separate admin tool. The
 * right side is only the form. On a phone the panel goes away entirely and
 * a small logo sits above the form: nobody wants to scroll past a pitch to
 * reach the password box.
 */
import NikkiLogo from "./NikkiLogo";
import { Check, Phone } from "lucide-react";

const POINTS = [
  "Answers your number in Telugu, Hindi or English",
  "Books from your real diary and takes orders from your price list",
  "Confirms on WhatsApp before the caller hangs up",
];

export default function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="af">
      <aside className="af-side" aria-hidden="false">
        <a href="/" className="af-brand" aria-label="HeyNikki home">
          <NikkiLogo size={28} showText={false} dark />
          <span>Hey<span className="af-brand-soft">Nikki</span></span>
        </a>

        <div className="af-pitch">
          <p className="af-head">
            Every missed call was someone <em>ready to buy.</em>
          </p>
          <ul className="af-points">
            {POINTS.map(p => (
              <li key={p}><span className="af-tick"><Check size={13} strokeWidth={2.5} /></span>{p}</li>
            ))}
          </ul>
        </div>

        <div>
          {/* The same number as the landing page: the one demo that cannot
              be staged is ringing her yourself. */}
          <a href="tel:+918633502031" className="af-call">
            <span className="af-call-dot" aria-hidden="true" />
            <Phone size={14} /> Hear her first: <strong>+91 86335 02031</strong>
          </a>
          <div className="af-legal">
            Nikki Technologies · a unit of Adexos Global Technologies
          </div>
        </div>
      </aside>

      <main className="af-main">
        <div className="af-inner">
          <a href="/" className="af-mlogo" aria-label="HeyNikki home">
            <NikkiLogo size={30} showText={false} />
            <span>HeyNikki</span>
          </a>
          {children}
        </div>
      </main>

      <style>{`
        .af { min-height: 100vh; display: grid; grid-template-columns: minmax(380px, 44%) 1fr; background: #fff; }
        .af-side {
          position: relative; overflow: hidden; color: #fff;
          background:
            radial-gradient(900px 520px at 12% 108%, rgba(29,111,165,0.45), transparent 60%),
            radial-gradient(600px 400px at 100% 0%, rgba(233,167,44,0.12), transparent 60%),
            #0B1F33;
          padding: 40px clamp(32px, 4vw, 56px);
          display: flex; flex-direction: column; justify-content: space-between; gap: 40px;
        }
        .af-brand { display: inline-flex; align-items: center; gap: 10px; color: #fff; text-decoration: none;
          font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 19px; letter-spacing: -0.01em; }
        .af-brand-soft { color: rgba(255,255,255,0.72); font-weight: 600; }
        .af-head {
          margin: 0 0 28px; font-family: var(--font-display), sans-serif; font-weight: 700;
          font-size: clamp(34px, 3.4vw, 48px); line-height: 1.06; letter-spacing: -0.035em; max-width: 13ch;
        }
        .af-head em { font-style: italic; color: #8FB4E8; }
        .af-points { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; max-width: 40ch; }
        .af-points li { display: flex; gap: 12px; align-items: flex-start; font-size: 15.5px; line-height: 1.5; color: rgba(255,255,255,0.84); }
        .af-tick { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; margin-top: 1px;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(34,197,94,0.16); color: #4ADE80; }
        .af-call { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.04);
          color: rgba(255,255,255,0.8); font-size: 14px; text-decoration: none; transition: border-color .15s ease; }
        .af-call:hover { border-color: rgba(255,255,255,0.4); color: #fff; }
        .af-call strong { color: #fff; font-weight: 700; }
        .af-call-dot { width: 7px; height: 7px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 0 4px rgba(34,197,94,0.18); }
        .af-legal { margin-top: 18px; font-size: 12px; color: rgba(255,255,255,0.42); }

        .af-main { display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
        .af-inner { width: 100%; max-width: 400px; }
        .af-mlogo { display: none; align-items: center; gap: 9px; margin-bottom: 28px; color: #0F172A; text-decoration: none;
          font-family: var(--font-display), sans-serif; font-weight: 700; font-size: 18px; }

        @media (max-width: 960px) {
          .af { grid-template-columns: 1fr; }
          .af-side { display: none; }
          .af-main { align-items: flex-start; padding: 32px 20px 48px; }
          .af-mlogo { display: inline-flex; }
        }
        @media (prefers-reduced-motion: reduce) { .af-call { transition: none; } }
      `}</style>
    </div>
  );
}
