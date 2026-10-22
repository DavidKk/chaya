#!/bin/sh
# Real WebKit test: requires macOS GUI login, no game or local server.
set -eu
cd "$(dirname "$0")"
sh build.sh
directory=$(mktemp -d "${TMPDIR:-/tmp}/chaya-rgss-test.XXXXXX")
binary="$directory/native-smoke"
trap 'rm "$binary"; rmdir "$directory"' EXIT
xcrun clang++ -std=c++17 -fobjc-arc -framework Cocoa smoke.mm -o "$binary"
"$binary" "$(pwd)/../dist/libchaya-overlay.dylib"
