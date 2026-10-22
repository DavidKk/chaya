#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p ../dist
xcrun clang++ -std=c++17 -fobjc-arc -dynamiclib -framework Cocoa -framework WebKit host.mm -o ../dist/libchaya-overlay.dylib
