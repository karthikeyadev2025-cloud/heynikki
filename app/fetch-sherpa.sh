#!/usr/bin/env bash
# Downloads the sherpa-onnx Android AAR (wake-word engine) into android/app/libs.
# It is ~120 MB so it is not committed. Run once after cloning.
set -euo pipefail
V=1.13.7
D="$(cd "$(dirname "$0")" && pwd)/android/app/libs"
mkdir -p "$D"
[ -f "$D/sherpa-onnx-$V.aar" ] && { echo "already have sherpa-onnx-$V.aar"; exit 0; }
curl -L -o "$D/sherpa-onnx-$V.aar" "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$V/sherpa-onnx-$V.aar"
echo "fetched $D/sherpa-onnx-$V.aar"
