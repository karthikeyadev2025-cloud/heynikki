// Builds the print-ready HeyNikki brochure, flyer and auto-rickshaw poster.
//
//   node marketing/print/build.mjs
//
// Writes to marketing/print/out/:
//   heynikki-brochure-A4-2sided.pdf  page 1 Nikki/AI (front), page 2 Desk + plans (back)
//   heynikki-flyer-A5.pdf            one side: the missed-call handout
//   heynikki-auto-poster-24x18.pdf   back of the auto
//   *.png                            one image per side, for WhatsApp / preview
//   *.html                           the source pages, to tweak in a browser
//
// Every PDF page carries a 3 mm bleed on all sides: the background runs past
// the trim line and all text stays at least 6 mm inside it. Tell the printer
// "3 mm bleed, trim to A4" (A5, or 24 x 18 in for the auto poster).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { mix, PHONE_DISPLAY, PHONE_SHORT, WEBSITE } from "./content.mjs";
import * as bro from "./brochure-content.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const qr = readFileSync(join(here, "qr-call-nikki.svg"), "utf8");
const logo = readFileSync(join(here, "../../assets/heynikki-icon.svg"), "utf8")
  .replace(/<\?xml[^>]*>/, "")
  .replace(/width="256" height="256"/, "");

const BLEED = 3; // mm

// Line icons, drawn at 24x24 like the site's lucide set.
const icon = {
  phone: `<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>`,
  missed: `<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/><path d="m16 2 6 6M22 2l-6 6"/>`,
  store: `<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/>`,
  rupee: `<path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3c6.7 0 6.7-10 0-10"/>`,
  calendar: `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>`,
  bag: `<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>`,
  regular: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>`,
  callout: `<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/><path d="M16 2h6v6M22 2l-7 7"/>`,
  chat: `<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2-5.4A8.4 8.4 0 1 1 21 11.5z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>`,
  volume: `<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>`,
  shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>`,
  dash: `<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>`,
  mobile: `<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>`,
  code: `<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>`,
  list: `<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>`,
  alarm: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>`,
  spark: `<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 3v4M17 5h4"/>`,
  chart: `<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-3"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
};
const svg = (name, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon[name]}</svg>`;

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anek+Telugu:wght@500;600;700;800&family=Noto+Sans+Telugu:wght@400;500;600;700&family=Poppins:wght@500;600;700;800&display=block" rel="stylesheet">`;

const base = `
  :root {
    --navy: #0B1220; --navy2: #132036; --ink: #0F172A; --muted: #475569;
    --green: #10B981; --red: #EF4444; --teal: #14B8A6; --orange: #F97316; --yellow: #FACC15;
    --paper: #FFFFFF; --mint: #ECFDF5; --line: #E2E8F0;
    --grad: linear-gradient(110deg, #10B981 0%, #14B8A6 55%, #F97316 100%);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--paper); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .te { --head: "Anek Telugu", "Noto Sans Telugu", sans-serif; --body: "Noto Sans Telugu", "Anek Telugu", sans-serif; }
  .en { --head: "Poppins", sans-serif; --body: "Poppins", sans-serif; }
  .page { position: relative; overflow: hidden; break-after: page; font-family: var(--body); color: var(--ink); }
  .page:last-child { break-after: auto; }
  .num { font-family: "Poppins", sans-serif; font-weight: 800; letter-spacing: 0.01em; white-space: nowrap; }
  .logo svg { display: block; width: 100%; height: 100%; }
  .brand { font-family: "Poppins", sans-serif; font-weight: 700; letter-spacing: -0.01em; }
  /* Solid, not gradient-clipped text: clipped text prints with a stray hairline in some RIPs. */
  .brand b { font-weight: 800; color: var(--green); }
`;

// ── A5 flyer: 148 x 210 mm trim ─────────────────────────────────
// One story, top to bottom: the missed call you already know (the phone
// notification), why it costs you, Nikki picking up instead, how to try her.
const FW = 148 + BLEED * 2, FH = 210 + BLEED * 2;
const flyerCss = `
  @page { size: ${FW}mm ${FH}mm; margin: 0; }
  .flyer { width: ${FW}mm; height: ${FH}mm; display: flex; flex-direction: column; background: var(--paper); }
  .f-top { background: var(--navy); color: #fff; padding: ${BLEED + 5}mm ${BLEED + 8}mm 5.5mm; position: relative; }
  .f-top::before { content: ""; position: absolute; right: -34mm; top: -24mm; width: 100mm; height: 100mm; border-radius: 50%;
    background: radial-gradient(circle, rgba(239,68,68,.30), rgba(239,68,68,0) 65%); }
  .f-bar { display: flex; align-items: center; justify-content: space-between; position: relative; }
  .f-logo { display: flex; align-items: center; gap: 2.6mm; }
  .f-logo .logo { width: 10mm; height: 10mm; }
  .f-logo .brand { font-size: 5.8mm; color: #fff; }
  .f-tag { font-family: var(--head); font-weight: 600; font-size: 3.1mm; color: #A7F3D0; border: .35mm solid rgba(167,243,208,.5);
    border-radius: 10mm; padding: .8mm 3mm; }
  .kicker { position: relative; margin-top: 4.5mm; font-family: var(--head); font-weight: 600; font-size: 4mm; color: #CBD5E1; }

  /* The missed-call notification every shop owner has seen. */
  .notif { position: relative; margin-top: 2.6mm; display: flex; align-items: center; gap: 3mm; width: 78mm;
    background: #fff; border-radius: 3.4mm; padding: 2.6mm 3.4mm; box-shadow: 0 1.2mm 0 rgba(0,0,0,.35); }
  .notif .ic { flex: none; width: 9mm; height: 9mm; padding: 2mm; border-radius: 50%; background: #FEE2E2; color: var(--red); }
  .notif b { display: block; font-family: var(--head); font-weight: 800; font-size: 4.4mm; color: var(--red); line-height: 1.2; }
  .notif small { display: block; font-size: 2.9mm; color: var(--muted); }

  .f-head { position: relative; font-family: var(--head); font-weight: 800; color: #fff; margin-top: 4.5mm; line-height: 1.12; }
  .te .f-head { font-size: 10mm; }
  .en .f-head { font-size: 9.6mm; letter-spacing: -0.02em; }
  .f-head span { display: block; }
  .f-head span:first-child { display: inline-block; background: var(--red); padding: 1mm 3mm 0; border-radius: 2mm; margin-bottom: 1.4mm; }

  .f-body { flex: 1; padding: 4.5mm ${BLEED + 8}mm 4mm; display: flex; flex-direction: column; justify-content: space-between; gap: 3mm; }
  .h2 { font-family: var(--head); font-weight: 800; font-size: 4.6mm; color: var(--navy); margin-bottom: 2.2mm; }
  .why { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.4mm; }
  .why div { background: #FEF2F2; border-top: 1mm solid var(--red); border-radius: 1.6mm 1.6mm 2.4mm 2.4mm; padding: 2.2mm 2.4mm 2.4mm; }
  .why .ic { width: 6mm; height: 6mm; color: var(--red); display: block; margin-bottom: 1.2mm; }
  .why b { display: block; font-family: var(--head); font-weight: 800; font-size: 3.6mm; line-height: 1.25; color: var(--navy); }
  .why small { display: block; margin-top: 1mm; font-size: 2.9mm; line-height: 1.4; color: #334155; }

  .fix { background: var(--mint); border: .4mm solid #A7F3D0; border-radius: 3mm; padding: 3mm 3.4mm 2.8mm; }
  .fix .h2 { color: #047857; margin-bottom: 2.4mm; display: flex; align-items: center; gap: 2mm; }
  .fix .h2 .ic { width: 6mm; height: 6mm; padding: 1.2mm; border-radius: 50%; background: var(--green); color: #fff; flex: none; }
  .flow { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: center; gap: 1.6mm; }
  .flow span { background: #fff; border-radius: 2mm; padding: 1.6mm 1.6mm; text-align: center; font-family: var(--head); font-weight: 700;
    font-size: 3.1mm; line-height: 1.3; color: var(--navy); min-height: 10mm; display: flex; align-items: center; justify-content: center; }
  .flow i { font: normal 800 6mm/1 "Poppins", sans-serif; color: var(--green); }
  .ticks { display: flex; justify-content: center; gap: 4mm; margin-top: 2.4mm; flex-wrap: wrap; }
  .ticks span { font-family: var(--head); font-weight: 700; font-size: 3.1mm; color: #047857; }
  .ticks span::before { content: "✓ "; color: var(--green); }

  .f-cta { background: var(--navy); color: #fff; padding: 4.5mm ${BLEED + 8}mm ${BLEED + 6}mm; position: relative;
    display: grid; grid-template-columns: 1fr auto; gap: 5mm; align-items: center; }
  .f-cta::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1.6mm; background: var(--grad); }
  .offer { display: inline-block; background: var(--yellow); color: var(--navy); font-family: var(--head); font-weight: 800;
    font-size: 4.2mm; padding: 1.2mm 3.4mm; border-radius: 1.6mm; }
  .offer-sub { font-size: 2.9mm; color: #94A3B8; margin-top: 1.4mm; }
  .cta { font-family: var(--head); font-weight: 700; font-size: 4mm; margin-top: 2.6mm; color: #fff; }
  .phone { display: flex; align-items: center; gap: 2.4mm; margin-top: 1mm; }
  .phone .ic { width: 8mm; height: 8mm; padding: 1.7mm; border-radius: 50%; background: var(--green); color: #fff; }
  .phone .num { font-size: 7.2mm; color: #fff; }
  .site { margin-top: 1mm; font: 600 3.2mm "Poppins", sans-serif; color: #5EEAD4; }
  .qr { background: #fff; border-radius: 2.6mm; padding: 2.2mm; width: 28mm; text-align: center; }
  .qr svg { display: block; width: 23.6mm; height: 23.6mm; }
  .qr p { font-size: 2.4mm; font-weight: 700; color: var(--navy); margin-top: 1mm; line-height: 1.2; }
`;

const flyerPage = (t) => `
<section class="page flyer ${t.lang}" lang="${t.lang}">
  <div class="f-top">
    <div class="f-bar">
      <div class="f-logo"><div class="logo">${logo}</div><div class="brand">Hey<b>Nikki</b></div></div>
      <div class="f-tag">${t.tag}</div>
    </div>
    <p class="kicker">${t.kicker}</p>
    <div class="notif">${svg("missed")}<span><b>${t.notif[0]}</b><small>${t.notif[1]}</small></span></div>
    <h1 class="f-head">${t.headline.map((l) => `<span>${l}</span>`).join("")}</h1>
  </div>

  <div class="f-body">
    <div>
      <h2 class="h2">${t.whyTitle}</h2>
      <div class="why">
        ${t.why.map(([b, s], i) => `<div>${svg(["store", "clock", "rupee"][i])}<b>${b}</b><small>${s}</small></div>`).join("")}
      </div>
    </div>
    <div class="fix">
      <h2 class="h2">${svg("phone")}${t.fixTitle}</h2>
      <div class="flow">${t.flow.map((f) => `<span>${f}</span>`).join("<i>→</i>")}</div>
      <div class="ticks">${t.ticks.map((x) => `<span>${x}</span>`).join("")}</div>
    </div>
  </div>

  <div class="f-cta">
    <div>
      <div class="offer">${t.offer}</div>
      <div class="offer-sub">${t.offerSub}</div>
      <div class="cta">${t.cta}</div>
      <div class="phone">${svg("phone")}<span class="num">${PHONE_DISPLAY}</span></div>
      <div class="site">${WEBSITE}</div>
    </div>
    <div class="qr">${qr}<p>${t.scan}</p></div>
  </div>
</section>`;

// ── Auto-rickshaw back poster: 24 x 18 in (610 x 457 mm) trim ──────
// Read from the vehicle behind, at 3–10 m, for a few seconds. So: one
// headline, one line of what it is, the number as big as it will go.
const AW = 610 + BLEED * 2, AH = 457 + BLEED * 2;
const autoCss = `
  @page { size: ${AW}mm ${AH}mm; margin: 0; }
  .auto { width: ${AW}mm; height: ${AH}mm; background: var(--navy); color: #fff;
    padding: ${BLEED + 22}mm ${BLEED + 26}mm ${BLEED + 20}mm; display: flex; flex-direction: column; }
  .auto::before { content: ""; position: absolute; right: -120mm; top: -140mm; width: 420mm; height: 420mm; border-radius: 50%;
    background: radial-gradient(circle, rgba(20,184,166,.40), rgba(20,184,166,0) 65%); }
  .auto::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: ${BLEED + 9}mm; background: var(--grad); }
  .a-bar { position: relative; display: flex; align-items: center; justify-content: space-between; }
  .a-logo { display: flex; align-items: center; gap: 9mm; }
  .a-logo .logo { width: 44mm; height: 44mm; }
  .a-logo .brand { font-size: 26mm; color: #fff; }
  .a-free { background: var(--yellow); color: var(--navy); font-family: var(--head); font-weight: 800; font-size: 17mm;
    padding: 5mm 13mm; border-radius: 6mm; transform: rotate(-3deg); box-shadow: 0 3mm 0 rgba(0,0,0,.25); }
  .a-head { position: relative; margin-top: 26mm; font-family: var(--head); font-weight: 800; line-height: 1.08; }
  .te .a-head { font-size: 56mm; }
  .en .a-head { font-size: 52mm; letter-spacing: -0.02em; }
  .a-head span { display: block; }
  .a-head span:first-child { display: inline-block; background: var(--red); padding: 4mm 12mm 0; border-radius: 7mm; margin-bottom: 5mm; }
  .a-head span:last-child { color: var(--yellow); }
  .a-sub { position: relative; margin-top: 10mm; font-family: var(--head); font-weight: 600; font-size: 17mm; line-height: 1.3; color: #fff; max-width: 560mm; }
  .te .a-sub { font-size: 18mm; }
  .en .a-sub { font-size: 19mm; }
  .a-call { position: relative; margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 14mm;
    background: #fff; color: var(--navy); border-radius: 10mm; padding: 9mm 12mm 9mm 14mm; }
  .a-call .lbl { font-family: var(--head); font-weight: 700; font-size: 13mm; color: #059669; line-height: 1.1; }
  .a-call .row { display: flex; align-items: center; gap: 8mm; margin-top: 2mm; }
  .a-call .ic { width: 36mm; height: 36mm; padding: 7mm; border-radius: 50%; background: var(--green); color: #fff; flex: none; }
  .a-call .num { font-size: 50mm; line-height: 1; color: var(--navy); }
  .a-qr { flex: none; text-align: center; }
  .a-qr svg { display: block; width: 74mm; height: 74mm; }
  .a-qr p { font-size: 8.5mm; font-weight: 700; margin-top: 2mm; }
  .a-site { position: relative; margin-top: 7mm; font: 700 12mm "Poppins", sans-serif; color: #5EEAD4; }
`;

const autoPage = (t) => `
<section class="page auto ${t.lang}" lang="${t.lang}">
  <div class="a-bar">
    <div class="a-logo"><div class="logo">${logo}</div><div class="brand">Hey<b>Nikki</b></div></div>
    <div class="a-free">${t.autoFree}</div>
  </div>
  <h1 class="a-head">${t.autoHeadline.map((l) => `<span>${l}</span>`).join("")}</h1>
  <p class="a-sub">${t.autoSub}</p>
  <div class="a-call">
    <div>
      <div class="lbl">${t.autoCall}</div>
      <div class="row">${svg("phone")}<span class="num">${PHONE_SHORT}</span></div>
    </div>
    <div class="a-qr">${qr}<p>${t.scan}</p></div>
  </div>
  <div class="a-site">${WEBSITE}</div>
</section>`;

// ── A4 brochure: 210 x 297 mm trim, both sides ─────────────────────
// Front is Nikki (the AI), back is the Desk (your people). Every feature
// card on the homepage appears once, in the same order the site tells it.
const BW = 210 + BLEED * 2, BH = 297 + BLEED * 2;
const PAD = BLEED + 11; // side margin inside the trim
const brochureCss = `
  @page { size: ${BW}mm ${BH}mm; margin: 0; }
  .bro { width: ${BW}mm; height: ${BH}mm; display: flex; flex-direction: column; background: var(--paper); }
  .b-hero { background: var(--navy); color: #fff; padding: ${BLEED + 9}mm ${PAD}mm 8mm; position: relative; overflow: hidden; }
  .b-hero, .b-foot, .b-cta { flex: none; }
  .b-hero.desk { padding: ${BLEED + 7}mm ${PAD}mm 6.5mm; }
  .b-hero::before { content: ""; position: absolute; right: -40mm; top: -40mm; width: 130mm; height: 130mm; border-radius: 50%;
    background: radial-gradient(circle, rgba(20,184,166,.42), rgba(20,184,166,0) 65%); }
  .b-hero::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1.8mm; background: var(--grad); }
  .b-hero.desk::before { background: radial-gradient(circle, rgba(249,115,22,.34), rgba(249,115,22,0) 65%); }
  .b-bar { position: relative; display: flex; align-items: center; justify-content: space-between; }
  .b-logo { display: flex; align-items: center; gap: 3mm; }
  .b-logo .logo { width: 12mm; height: 12mm; }
  .b-logo .brand { font-size: 7mm; color: #fff; }
  .b-tag { font-family: var(--head); font-weight: 600; font-size: 3.6mm; color: #A7F3D0; border: .35mm solid rgba(167,243,208,.5);
    border-radius: 10mm; padding: 1mm 3.6mm; }
  .desk .b-tag { color: #FED7AA; border-color: rgba(254,215,170,.55); }
  .b-head { position: relative; margin-top: 7mm; font-family: var(--head); font-weight: 800; line-height: 1.12; }
  .te .b-head { font-size: 11.5mm; }
  .en .b-head { font-size: 12.5mm; letter-spacing: -0.02em; }
  .b-head span { display: block; }
  .b-head span:last-child { color: var(--yellow); }
  .desk .b-head { font-size: 10mm; margin-top: 5mm; }
  .desk .b-head span { color: #fff; }
  .b-sub { position: relative; margin-top: 3.4mm; font-size: 4mm; line-height: 1.55; color: #CBD5E1; max-width: 170mm; }
  .te .b-sub { font-size: 3.8mm; }
  .b-pain { position: relative; display: inline-flex; align-items: center; gap: 2.2mm; margin-top: 4.4mm; background: var(--red); color: #fff;
    font-family: var(--head); font-weight: 700; font-size: 4.2mm; padding: 1.4mm 4.4mm; border-radius: 1.8mm; }
  .b-pain .ic { width: 4.8mm; height: 4.8mm; }

  .b-body { flex: 1; padding: 5.5mm ${PAD}mm 5.5mm; display: flex; flex-direction: column; justify-content: space-between; gap: 3.6mm; }
  .bh2 { font-family: var(--head); font-weight: 800; font-size: 5.4mm; color: var(--navy); margin-bottom: 2.6mm; display: flex; align-items: center; gap: 2.4mm; }
  .bh2::before { content: ""; width: 1.5mm; height: 5.4mm; border-radius: 1mm; background: var(--grad); }
  .bh2.or::before { background: var(--orange); }

  .b-how { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 2mm; align-items: center; }
  .b-how div { display: flex; align-items: center; gap: 2.6mm; background: var(--mint); border-radius: 2.6mm; padding: 2.6mm 3mm; min-height: 15mm; }
  .b-how .n { flex: none; width: 7mm; height: 7mm; border-radius: 50%; background: var(--navy); color: #fff; font: 700 3.6mm/7mm "Poppins", sans-serif; text-align: center; }
  .b-how p { font-family: var(--head); font-weight: 700; font-size: 3.5mm; line-height: 1.3; color: var(--navy); }
  .b-how i { font: normal 800 6mm/1 "Poppins", sans-serif; color: var(--green); }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3.2mm 6mm; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.6mm; }
  .feat { display: flex; gap: 3mm; align-items: flex-start; }
  .feat .ic { flex: none; width: 9mm; height: 9mm; padding: 1.9mm; border-radius: 2.4mm; background: var(--navy); color: #5EEAD4; }
  .feat b { display: block; font-family: var(--head); font-weight: 700; font-size: 4mm; line-height: 1.3; color: var(--navy); }
  .feat small { display: block; margin-top: .4mm; font-size: 3.15mm; line-height: 1.45; color: #475569; }
  .te .feat small { font-size: 3.05mm; }

  .owner { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
  .owner .feat { background: #F1F5F9; border-radius: 2.6mm; padding: 3mm; }
  .owner .feat .ic { background: var(--green); color: #fff; }

  .b-foot { background: var(--navy); color: #fff; padding: 5mm ${PAD}mm ${BLEED + 6}mm; display: flex; align-items: center; justify-content: space-between; gap: 6mm; position: relative; }
  .b-foot::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1.8mm; background: var(--grad); }
  .b-foot .phone .num { font-size: 7.4mm; }
  .b-foot .turn { font-family: var(--head); font-weight: 700; font-size: 3.8mm; color: var(--yellow); text-align: right; }

  /* Back side: the Desk */
  .desk-card { background: #FFF7ED; border-left: 1mm solid var(--orange); border-radius: 1.6mm 2.6mm 2.6mm 1.6mm; padding: 2.6mm 2.8mm;
    display: flex; gap: 2.4mm; align-items: flex-start; }
  .desk-card .ic { flex: none; width: 6.6mm; height: 6.6mm; color: #EA580C; margin-top: .4mm; }
  .desk-card b { display: block; font-family: var(--head); font-weight: 700; font-size: 3.8mm; line-height: 1.3; color: var(--navy); }
  .desk-card small { display: block; margin-top: .6mm; font-size: 3.05mm; line-height: 1.45; color: #475569; }
  .te .desk-card small { font-size: 2.95mm; }

  .brains { display: grid; grid-template-columns: 1fr 1fr 1fr; background: var(--navy); border-radius: 3.4mm; overflow: hidden; }
  .brains > div { padding: 2.8mm 3.2mm; color: #fff; text-align: center; }
  .brains > div:nth-child(2) { background: var(--grad); }
  .brains .ic { width: 6.6mm; height: 6.6mm; margin: 0 auto 1mm; display: block; color: #5EEAD4; }
  .brains > div:nth-child(2) .ic { color: #fff; }
  .brains > div:nth-child(3) .ic { color: #FDBA74; }
  .brains b { display: block; font-family: var(--head); font-weight: 800; font-size: 4.2mm; }
  .brains small { display: block; margin-top: .8mm; font-size: 3mm; line-height: 1.4; color: #CBD5E1; }
  .brains > div:nth-child(2) small { color: #fff; }

  .chips { display: flex; flex-wrap: wrap; gap: 1.4mm; }
  .chips span { font-size: 2.75mm; font-weight: 600; padding: .6mm 2mm; border-radius: 10mm; border: .3mm solid var(--line); background: #F8FAFC; color: var(--ink); }

  .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; align-items: stretch; }
  .plan { border: .35mm solid var(--line); border-radius: 3mm; padding: 3.2mm 3.2mm 3mm; position: relative; }
  .plan.hot { background: var(--navy); color: #fff; border-color: var(--navy); }
  .plan .pop { position: absolute; top: -2.6mm; left: 3.4mm; background: var(--yellow); color: var(--navy); font-family: var(--head); font-weight: 800;
    font-size: 2.7mm; padding: .5mm 2.4mm; border-radius: 10mm; white-space: nowrap; }
  .plan h3 { font-family: var(--head); font-weight: 800; font-size: 4.4mm; }
  .plan .price { margin-top: .6mm; font: 800 7mm "Poppins", sans-serif; letter-spacing: -0.02em; }
  .plan .price small { font: 600 3mm var(--body); opacity: .65; margin-left: 1mm; letter-spacing: 0; }
  .plan ul { list-style: none; margin-top: 1.4mm; display: grid; gap: 1mm; }
  .plan li { font-size: 2.95mm; line-height: 1.4; padding-left: 3.4mm; position: relative; color: #475569; }
  .plan.hot li { color: #CBD5E1; }
  .plan li::before { content: "✓"; position: absolute; left: 0; color: var(--green); font-weight: 800; }

  .b-cta { background: var(--navy); color: #fff; padding: 4.5mm ${PAD}mm ${BLEED + 7}mm; position: relative;
    display: grid; grid-template-columns: 1fr auto; gap: 6mm; align-items: center; }
  .b-cta::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1.8mm; background: var(--grad); }
  .b-cta .offer { font-size: 4.8mm; }
  .b-cta .offer-sub { font-size: 3.2mm; }
  .b-cta .cta { font-size: 4.4mm; }
  .b-cta .phone .num { font-size: 8.4mm; }
  .b-cta .site { font-size: 3.6mm; }
  .b-cta .qr { width: 33mm; }
  .b-cta .qr svg { width: 28.6mm; height: 28.6mm; }
  .b-cta .qr p { font-size: 2.7mm; }
`;

const heroBar = (t, tag) => `
    <div class="b-bar">
      <div class="b-logo"><div class="logo">${logo}</div><div class="brand">Hey<b>Nikki</b></div></div>
      <div class="b-tag">${tag}</div>
    </div>`;
const feat = ([b, s], ic) => `<div class="feat">${svg(ic)}<span><b>${b}</b><small>${s}</small></span></div>`;

const brochureFront = (t) => `
<section class="page bro ${t.lang}" lang="${t.lang}">
  <div class="b-hero">
    ${heroBar(t, t.tag)}
    <h1 class="b-head">${t.headline.map((l) => `<span>${l}</span>`).join("")}</h1>
    <p class="b-sub">${t.sub}</p>
    <div class="b-pain">${svg("missed")}${t.pain}</div>
  </div>
  <div class="b-body">
    <div>
      <h2 class="bh2">${t.howTitle}</h2>
      <div class="b-how">${t.how.map((h, i) => `<div><span class="n">${i + 1}</span><p>${h}</p></div>`).join("<i>→</i>")}</div>
    </div>
    <div>
      <h2 class="bh2">${t.aiTitle}</h2>
      <div class="grid2">${t.ai.map((f, i) => feat(f, ["calendar", "bag", "regular", "users", "callout", "chat", "volume", "shield"][i])).join("")}</div>
    </div>
    <div>
      <h2 class="bh2">${t.ownerTitle}</h2>
      <div class="owner">${t.owner.map((f, i) => feat(f, ["dash", "mobile", "phone", "code"][i])).join("")}</div>
    </div>
  </div>
  <div class="b-foot">
    <div class="phone">${svg("phone")}<span class="num">${PHONE_DISPLAY}</span></div>
    <div class="turn">${t.turnOver} →</div>
  </div>
</section>`;

const brochureBack = (t) => `
<section class="page bro ${t.lang}" lang="${t.lang}">
  <div class="b-hero desk">
    ${heroBar(t, t.deskTag)}
    <h1 class="b-head"><span>${t.deskTitle}</span></h1>
    <p class="b-sub">${t.deskSub}</p>
  </div>
  <div class="b-body">
    <div class="grid3">
      ${t.desk.map(([b, s], i) => `<div class="desk-card">${svg(["list", "alarm", "regular", "spark", "callout", "chart"][i])}<span><b>${b}</b><small>${s}</small></span></div>`).join("")}
    </div>
    <div>
      <h2 class="bh2">${t.brainsTitle}</h2>
      <div class="brains">${t.brains.map(([b, s], i) => `<div>${svg(["spark", "phone", "users"][i])}<b>${b}</b><small>${s}</small></div>`).join("")}</div>
    </div>
    <div>
      <h2 class="bh2">${t.forTitle}</h2>
      <div class="chips">${t.forList.map((x) => `<span>${x}</span>`).join("")}</div>
    </div>
    <div>
      <h2 class="bh2">${t.plansTitle}</h2>
      <div class="plans">${t.plans.map(([name, price, pts], i) => `
        <div class="plan${i === 1 ? " hot" : ""}">${i === 1 ? `<span class="pop">${t.popular}</span>` : ""}
          <h3>${name}</h3><div class="price">₹${price}<small>${t.perMonth}</small></div>
          <ul>${pts.map((p) => `<li>${p}</li>`).join("")}</ul>
        </div>`).join("")}</div>
    </div>
  </div>
  <div class="b-cta f-cta">
    <div>
      <div class="offer">${t.offer}</div>
      <div class="offer-sub">${t.offerSub}</div>
      <div class="cta">${t.cta}</div>
      <div class="phone">${svg("phone")}<span class="num">${PHONE_DISPLAY}</span></div>
      <div class="site">${WEBSITE}</div>
    </div>
    <div class="qr">${qr}<p>${t.scan}</p></div>
  </div>
</section>`;

const doc = (title, css, body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>${fonts}
<style>${base}${css}</style></head><body>${body}</body></html>`;

// Brochure pages reuse the flyer's CTA styles, minus its page size.
const brochureAllCss = flyerCss.replace(/@page[^}]*}/, "") + brochureCss;
const jobs = [
  { name: "heynikki-brochure-A4-2sided", title: "HeyNikki brochure", css: brochureAllCss,
    pages: [brochureFront(bro.mix), brochureBack(bro.mix)], w: BW, h: BH,
    pngNames: ["heynikki-brochure-front-ai", "heynikki-brochure-back-desk"], dpi: 300 },
  { name: "heynikki-flyer-A5", title: "HeyNikki flyer", css: flyerCss, pages: [flyerPage(mix)], w: FW, h: FH,
    pngNames: ["heynikki-flyer-A5"], dpi: 300 },
  { name: "heynikki-auto-poster-24x18", title: "HeyNikki auto poster", css: autoCss, pages: [autoPage(mix)], w: AW, h: AH,
    pngNames: ["heynikki-auto-poster"], dpi: 150 },
];

const browser = await chromium.launch();
for (const j of jobs) {
  const html = doc(j.title, j.css, j.pages.join("\n"));
  const htmlPath = join(out, `${j.name}.html`);
  writeFileSync(htmlPath, html);

  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: join(out, `${j.name}.pdf`), preferCSSPageSize: true, printBackground: true });
  await page.close();

  // One raster per side at print resolution, for the printer who wants a
  // JPG/PNG and for sending on WhatsApp.
  for (let i = 0; i < j.pages.length; i++) {
    const pxW = Math.round((j.w / 25.4) * 96), pxH = Math.round((j.h / 25.4) * 96);
    const scale = j.dpi / 96;
    const p = await browser.newPage({ viewport: { width: pxW, height: pxH }, deviceScaleFactor: scale });
    await p.setContent(doc(j.title, j.css, j.pages[i]), { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(out, `${j.pngNames[i]}.png`), clip: { x: 0, y: 0, width: pxW, height: pxH } });
    await p.close();
  }
  console.log("built", j.name);
}
await browser.close();
