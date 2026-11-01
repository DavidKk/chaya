#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p ../dist
xcrun clang++ -std=c++17 -fobjc-arc -dynamiclib -framework Cocoa -framework WebKit \
  -weak_framework ScreenCaptureKit -framework CoreMedia -framework CoreVideo \
  -framework CoreImage -framework ImageIO host.mm window-capture.mm -o ../dist/libchaya-overlay.dylib
