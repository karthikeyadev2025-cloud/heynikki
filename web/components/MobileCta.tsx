// components/MobileCta.tsx — the landing page's phone-sized call to action.
//
// Below 768px the header nav and the header CTA are both display:none and
// the header does not stick (it cannot: it lives inside the hero's own
// containing block, so `position:sticky` would release it at the end of the
// hero). The result was a page where, after the hero, there was nothing to
// tap until the pricing band some 700px further down — on exactly the phone
// this page is written for.
//
// So: a slim bar that appears once the hero has scrolled away, with the two
// things a shop owner actually wants — start, or just ring her and hear it.
//
// Two rules it must obey:
//   · It must not cover the demo console. The console IS the argument, and
//     it is the band immediately under the hero — so the bar hides itself
//     for as long as any part of #demo is on screen.
//   · It must not stack on top of the cookie notice, which also pins to the
//     bottom. It sits on --nk-cookie-h, the height CookieBanner publishes.
"use client";

import { useEffect, useState } from "react";

export default function MobileCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("top");
    const demo = document.getElementById("demo");
    if (!hero) return;

    // Two observers, one piece of state: visible once the hero is behind us
    // AND the demo console is not on screen.
    let heroGone = false;
    let demoOn   = false;
    const settle = () => setShow(heroGone && !demoOn);

    const obs = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.target === hero) heroGone = !e.isIntersecting;
        if (e.target === demo) demoOn   = e.isIntersecting;
      }
      settle();
    }, { threshold: 0 });

    obs.observe(hero);
    if (demo) obs.observe(demo);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <style>{`
        .nk-mcta {
          position: fixed; left: 10px; right: 10px;
          bottom: calc(10px + var(--nk-cookie-h, 0px));
          z-index: 8500;
          display: flex; align-items: center; gap: 8px;
          padding: 8px; border-radius: 14px;
          background: rgba(7, 18, 29, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.14);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(8px);
          transform: translateY(140%);
          transition: transform .22s cubic-bezier(.2,.8,.3,1);
        }
        .nk-mcta-on { transform: translateY(0); }
        .nk-mcta a {
          display: inline-flex; align-items: center; justify-content: center;
          height: 44px; border-radius: 10px; text-decoration: none;
          font-size: 14px; font-weight: 700; letter-spacing: -0.01em;
        }
        .nk-mcta-go   { flex: 1 1 auto; background: #FDFBF7; color: #07121D; }
        .nk-mcta-call { flex: 0 0 auto; padding: 0 14px; color: #FDFBF7;
                        border: 1px solid rgba(255, 255, 255, 0.3); }
        /* Laptop and up the real header nav and its CTA are visible, so this
           would be a second, redundant control. */
        @media (min-width: 768px) { .nk-mcta { display: none; } }
        @media (prefers-reduced-motion: reduce) { .nk-mcta { transition: none; } }
      `}</style>
      <div className={"nk-mcta" + (show ? " nk-mcta-on" : "")}
           aria-hidden={!show}>
        <a className="nk-mcta-go" href="/signup" tabIndex={show ? 0 : -1}>
          Put Nikki on my number
        </a>
        <a className="nk-mcta-call" href="tel:+918633502031" tabIndex={show ? 0 : -1}
           aria-label="Call Nikki on 8 6 3 3 5 0 2 0 3 1">
          Call her
        </a>
      </div>
    </>
  );
}
