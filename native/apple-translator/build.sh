#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$DIR/../bin"
TARGET="$BIN_DIR/chaya-apple-translator"

mkdir -p "$BIN_DIR"

if [ "$(uname)" != "Darwin" ]; then
  echo "[chaya-apple-translator] Skipping native build on non-macOS platform."
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "[chaya-apple-translator] swiftc compiler not found, skipping native build."
  exit 0
fi

echo "[chaya-apple-translator] Compiling native Swift translator daemon..."
swiftc -O -parse-as-library "$DIR/main.swift" -o "$TARGET"
echo "[chaya-apple-translator] Build succeeded: $TARGET"
