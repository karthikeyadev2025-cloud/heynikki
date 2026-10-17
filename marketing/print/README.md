# HeyNikki print: brochure, flyer, auto poster

Ready-to-print files are in `out/`. All text is written the way business owners in
Guntur talk: Telugu sentences, with everyday English words (call, order, booking,
WhatsApp, customer) left in English letters.

| File | What it is | Size to order |
|---|---|---|
| `heynikki-brochure-A4-2sided.pdf` | **Main brochure, every feature.** Page 1 (front) = Nikki the AI: how a call works, 8 things she does, owner tools. Page 2 (back) = Telecaller Desk, AI + Human, who it's for, plans, free offer | A4, double-sided |
| `heynikki-flyer-A5.pdf` | Quick handout about the missed call: why it costs money, and how Nikki picks up | A5, one side |
| `heynikki-auto-poster-24x18.pdf` | Back of the auto | 24 × 18 in (610 × 457 mm), landscape |
| `*.png` | One image per side (300 dpi; poster 150 dpi) for WhatsApp, or for a printer who wants an image | |

## Tell the printer

**Brochure:** "A4, double-sided, flip on long edge, 3 mm bleed already in the PDF, trim to A4.
170 GSM art paper (gloss or matt)." The PDF page is 216 × 303 mm because of the bleed; that is correct.

**Flyer:** "A5, single side, 3 mm bleed in the PDF, 130 GSM art paper."

**Auto poster:** "24 × 18 inch, 3 mm bleed in the PDF, vinyl sticker (or star flex),
outdoor inks, matt lamination." Use vinyl for the back of the auto, since it survives rain and sun.

Before a big print run, print one copy and **scan the QR with a phone**. It should start
a call to +91 86335 02031.

## Changing the text

Flyer and poster words are in `content.mjs`, brochure words in `brochure-content.mjs`. Edit there, then rebuild:

```bash
cd marketing/print
ln -sfn /opt/node-tools/node_modules node_modules   # or: npm i playwright
node build.mjs
```

The QR (`qr-call-nikki.svg`) encodes `tel:+918633502031`. If the number changes,
regenerate it: `python3 -c "import segno; segno.make('tel:+91XXXXXXXXXX', error='h').save('qr-call-nikki.svg', scale=10, border=0, dark='#0B1220', light=None)"`
and change `width="290" height="290"` to `viewBox="0 0 290 290"`.
