#!/bin/sh
# Real macOS Window + WKWebView E2E integration test:
# Tests panel centering, dragging, native hit-test regions, click pass-through, switch toggles and lock operations.
set -eu
cd "$(dirname "$0")"
sh build.sh
directory=$(mktemp -d "${TMPDIR:-/tmp}/chaya-rgss-e2e.XXXXXX")
binary="$directory/native-e2e"
cleanup() {
  rm -f "$binary"
  rmdir "$directory" 2>/dev/null || true
}
trap cleanup EXIT
xcrun clang++ -std=c++17 -fobjc-arc -framework Cocoa -framework WebKit e2e_real_window.mm -o "$binary"
"$binary" "$(pwd)/../dist/libchaya-overlay.dylib"
