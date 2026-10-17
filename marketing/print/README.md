# HeyNikki print: flyer + auto poster

Ready-to-print files are in `out/`.

| File | What it is | Size to order |
|---|---|---|
| `heynikki-flyer-A5-2sided.pdf` | Flyer. **Page 1 = Telugu (front), page 2 = English (back)** | A5 (148 × 210 mm), double-sided |
| `heynikki-auto-poster-24x18.pdf` | Auto-rickshaw back poster. Page 1 Telugu, page 2 English: pick one per auto | 24 × 18 in (610 × 457 mm), landscape |
| `*.png` | One image per side (flyer at 300 dpi, poster at 150 dpi) for WhatsApp, or for a printer who asks for an image | |

## Tell the printer

**Flyer:** "A5, double-sided, flip on long edge, 3 mm bleed already in the PDF, trim to A5.
170 GSM art paper (gloss or matt)." The PDF page is 154 × 216 mm because of the bleed;
that is correct.

**Auto poster:** "24 × 18 inch, 3 mm bleed in the PDF, print on vinyl sticker (or star flex),
outdoor inks, matt lamination." Use vinyl for the back of the auto, since it survives rain and sun.

Before a big print run, print one copy and **scan the QR with a phone**. It should start
a call to +91 86335 02031.

## Changing the text

All words, the phone number and the price are in `content.mjs`. Edit there, then rebuild:

```bash
cd marketing/print
ln -sfn /opt/node-tools/node_modules node_modules   # or: npm i playwright
node build.mjs
```

The QR (`qr-call-nikki.svg`) encodes `tel:+918633502031`. If the number changes,
regenerate it: `python3 -c "import segno; segno.make('tel:+91XXXXXXXXXX', error='h').save('qr-call-nikki.svg', scale=10, border=0, dark='#0B1220', light=None)"`
and change `width="290" height="290"` to `viewBox="0 0 290 290"`.
