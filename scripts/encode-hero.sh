#!/usr/bin/env bash
# Turn any footage into the three files the landing hero needs.
#
#   ./scripts/encode-hero.sh path/to/footage.mp4
#
# Writes web/public/hero.mp4, hero.webm and hero-poster.jpg, already the
# right shape and weight. Nothing else has to change — the page reads those
# three names.
#
# The numbers below are not arbitrary. The first clip we were sent was
# 10.5MB at 1708x1212 with an audio track: nearly square, so it could not
# fill a wide viewport, and about seven times too heavy for a first paint on
# Indian mobile data. This produces ~0.3MB.
set -euo pipefail

SRC="${1:?usage: encode-hero.sh <video file>}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/web/public"
FF="docker run --rm -v $(cd "$(dirname "$SRC")" && pwd):/in -v $OUT:/out -w /in linuxserver/ffmpeg"
NAME="$(basename "$SRC")"

# Centre-crop to 16:9 whatever the source shape, then 1280x720. A background
# loop sits behind text at a third opacity; more resolution is bytes nobody
# sees. -an strips audio: a muted hero can never use it, and browsers block
# autoplay with sound anyway.
CROP="crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',scale=1280:720"

echo "→ h264"
$FF -i "/in/$NAME" -vf "$CROP" -an -c:v libx264 -profile:v main -crf 30 \
    -preset slow -movflags +faststart -y /out/hero.mp4 -hide_banner -loglevel error
echo "→ webm"
$FF -i "/in/$NAME" -vf "$CROP" -an -c:v libvpx-vp9 -crf 40 -b:v 0 \
    -deadline good -cpu-used 2 -y /out/hero.webm -hide_banner -loglevel error
echo "→ poster"
$FF -i "/in/$NAME" -vf "$CROP" -frames:v 1 -q:v 6 \
    -y /out/hero-poster.jpg -hide_banner -loglevel error

ls -la "$OUT"/hero.mp4 "$OUT"/hero.webm "$OUT"/hero-poster.jpg |
  awk '{printf "  %-40s %6.2f MB\n", $9, $5/1048576}'
echo
echo "Anything over ~1.5MB will hurt on 4G. If h264 is bigger, raise -crf."
