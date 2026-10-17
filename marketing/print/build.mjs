// Builds the print-ready HeyNikki flyer and auto-rickshaw poster.
//
//   node marketing/print/build.mjs
//
// Writes to marketing/print/out/:
//   heynikki-flyer-A5-2sided.pdf   page 1 Telugu (front), page 2 English (back)
//   heynikki-auto-poster-24x18.pdf page 1 Telugu, page 2 English
//   *.png                          one image per side, for WhatsApp / preview
//   *.html                         the source pages, to tweak in a browser
//
// Every PDF page carries a 3 mm bleed on all sides: the background runs past
// the trim line and all text stays at least 6 mm inside it. Tell the printer
// "3 mm bleed, trim to A5" (or 24 x 18 in for the auto poster).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { te, en, PHONE_DISPLAY, PHONE_SHORT, WEBSITE } from "./content.mjs";

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
  talk: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9v2M11 7.5v5M14 8.5v3M17 9.5v1"/>`,
  done: `<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2-5.4A8.4 8.4 0 1 1 21 11.5z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
  lang: `<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>`,
  sim: `<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>`,
  list: `<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>`,
};
const svg = (name, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon[name]}</svg>`;
const whyIcons = ["clock", "lang", "sim", "list"];

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anek+Telugu:wght@500;600;700;800&family=Noto+Sans+Telugu:wght@400;500;600;700&family=Poppins:wght@500;600;700;800&display=block" rel="stylesheet">`;

const base = `
  :root {
    --navy: #0B1220; --navy2: #132036; --ink: #0F172A; --muted: #475569;
    --green: #10B981; --teal: #14B8A6; --orange: #F97316; --yellow: #FACC15;
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
const FW = 148 + BLEED * 2, FH = 210 + BLEED * 2;
const flyerCss = `
  @page { size: ${FW}mm ${FH}mm; margin: 0; }
  .flyer { width: ${FW}mm; height: ${FH}mm; display: flex; flex-direction: column; background: var(--paper); }
  .f-top { background: var(--navy); color: #fff; padding: ${BLEED + 6}mm ${BLEED + 8}mm 6mm; position: relative; }
  .f-top::before { content: ""; position: absolute; right: -30mm; top: -30mm; width: 90mm; height: 90mm; border-radius: 50%;
    background: radial-gradient(circle, rgba(20,184,166,.45), rgba(20,184,166,0) 65%); }
  .f-top::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1.6mm; background: var(--grad); }
  .f-bar { display: flex; align-items: center; justify-content: space-between; position: relative; }
  .f-logo { display: flex; align-items: center; gap: 2.6mm; }
  .f-logo .logo { width: 11mm; height: 11mm; }
  .f-logo .brand { font-size: 6.4mm; color: #fff; }
  .f-tag { font-family: var(--head); font-weight: 600; font-size: 3.3mm; color: #A7F3D0; border: .35mm solid rgba(167,243,208,.5);
    border-radius: 10mm; padding: .9mm 3mm; }
  .f-head { position: relative; font-family: var(--head); font-weight: 800; color: #fff; margin-top: 4.5mm; line-height: 1.1; }
  .te .f-head { font-size: 10mm; }
  .en .f-head { font-size: 8.6mm; letter-spacing: -0.02em; }
  .f-head span { display: block; }
  .f-head span:last-child { color: var(--yellow); }
  .f-sub { position: relative; margin-top: 2.6mm; font-size: 3.6mm; line-height: 1.5; color: #CBD5E1; max-width: 120mm; }
  .te .f-sub { font-size: 3.5mm; }
  .f-pain { position: relative; display: inline-flex; align-items: center; gap: 2mm; margin-top: 3.4mm; background: var(--orange); color: #fff;
    font-family: var(--head); font-weight: 700; font-size: 4mm; padding: 1.2mm 4mm; border-radius: 1.6mm; }
  .f-pain .ic { width: 4.4mm; height: 4.4mm; }

  .f-body { flex: 1; padding: 5mm ${BLEED + 8}mm 4.5mm; display: flex; flex-direction: column; justify-content: space-between; gap: 3.6mm; }
  .h2 { font-family: var(--head); font-weight: 800; font-size: 4.6mm; color: var(--navy); margin-bottom: 2.4mm; display: flex; align-items: center; gap: 2mm; }
  .h2::before { content: ""; width: 1.3mm; height: 4.4mm; border-radius: 1mm; background: var(--grad); }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.6mm; }
  .step { background: var(--mint); border-radius: 2.6mm; padding: 2.6mm 2.2mm 2.4mm; position: relative; text-align: center; }
  .step .n { position: absolute; top: -2.2mm; left: 50%; transform: translateX(-50%); width: 5.6mm; height: 5.6mm; border-radius: 50%;
    background: var(--navy); color: #fff; font: 700 3.2mm/5.6mm "Poppins", sans-serif; }
  .step .ic { width: 6.6mm; height: 6.6mm; color: #059669; margin: 1.4mm auto 1.2mm; display: block; }
  .step p { font-size: 3mm; line-height: 1.4; font-weight: 600; color: var(--ink); }
  .te .step p { font-size: 2.95mm; }

  .why { display: grid; grid-template-columns: 1fr 1fr; gap: 2.2mm 4mm; }
  .why div { display: flex; gap: 2.4mm; align-items: flex-start; }
  .why .ic { flex: none; width: 6.6mm; height: 6.6mm; padding: 1.3mm; border-radius: 2mm; background: var(--navy); color: #5EEAD4; }
  .why b { display: block; font-family: var(--head); font-weight: 700; font-size: 3.5mm; line-height: 1.25; color: var(--navy); }
  .why small { display: block; font-size: 2.8mm; line-height: 1.4; color: var(--muted); }

  .for { display: flex; flex-wrap: wrap; gap: 1.6mm; }
  .for span { font-size: 2.9mm; font-weight: 600; padding: .5mm 2.4mm; border-radius: 10mm; border: .3mm solid var(--line); color: var(--ink); background: #F8FAFC; }
  .for-row { display: flex; align-items: center; gap: 3mm; }
  .for-row .h2 { margin: 0; flex: none; }

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
    <h1 class="f-head">${t.headline.map((l) => `<span>${l}</span>`).join("")}</h1>
    <p class="f-sub">${t.sub}</p>
    <div class="f-pain">${svg("phone")}${t.pain}</div>
  </div>

  <div class="f-body">
    <div>
      <h2 class="h2">${t.howTitle}</h2>
      <div class="steps">
        ${t.steps.map((s, i) => `<div class="step"><span class="n">${i + 1}</span>${svg(["phone", "talk", "done"][i])}<p>${s}</p></div>`).join("")}
      </div>
    </div>
    <div>
      <h2 class="h2">${t.whyTitle}</h2>
      <div class="why">
        ${t.why.map(([b, s], i) => `<div>${svg(whyIcons[i])}<span><b>${b}</b><small>${s}</small></span></div>`).join("")}
      </div>
    </div>
    <div class="for-row">
      <h2 class="h2">${t.forTitle}</h2>
      <div class="for">${t.forList.map((x) => `<span>${x}</span>`).join("")}</div>
    </div>
  </div>

  <div class="f-cta">
    <div>
      <div class="offer">${t.offer}</div>
      <div class="offer-sub">${t.offerSub}</div>
      <div class="cta">${t.cta} ${t.ctaSub}</div>
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
  .a-head { position: relative; margin-top: 20mm; font-family: var(--head); font-weight: 800; line-height: 1.08; }
  .te .a-head { font-size: 60mm; }
  .en .a-head { font-size: 56mm; letter-spacing: -0.02em; }
  .a-head span { display: block; }
  .a-head span:last-child { color: var(--yellow); }
  .a-sub { position: relative; margin-top: 10mm; font-family: var(--head); font-weight: 600; font-size: 17mm; line-height: 1.3; color: #CBD5E1; max-width: 560mm; }
  .te .a-sub { font-size: 16.5mm; }
  .en .a-sub { font-size: 15.5mm; }
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

const doc = (title, css, body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>${fonts}
<style>${base}${css}</style></head><body>${body}</body></html>`;

const jobs = [
  { name: "heynikki-flyer-A5-2sided", title: "HeyNikki flyer", css: flyerCss, pages: [te, en].map(flyerPage), w: FW, h: FH,
    pngNames: ["heynikki-flyer-front-telugu", "heynikki-flyer-back-english"], dpi: 300 },
  { name: "heynikki-auto-poster-24x18", title: "HeyNikki auto poster", css: autoCss, pages: [te, en].map(autoPage), w: AW, h: AH,
    pngNames: ["heynikki-auto-poster-telugu", "heynikki-auto-poster-english"], dpi: 150 },
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
