#!/bin/sh
# Tests real visible/offscreen capture without starting a game or a server.
set -eu
cd "$(dirname "$0")"
directory=$(mktemp -d "${TMPDIR:-/tmp}/chaya-capture-test.XXXXXX")
binary="$directory/capture-smoke"
trap 'rm -f "$binary"; rmdir "$directory"' EXIT
xcrun clang++ -std=c++17 -fobjc-arc -framework Cocoa \
  -weak_framework ScreenCaptureKit -framework CoreMedia -framework CoreVideo \
  -framework CoreImage -framework ImageIO window-capture-smoke.mm window-capture.mm -o "$binary"
"$binary"
