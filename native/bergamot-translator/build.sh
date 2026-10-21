#!/bin/sh
set -eu

DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
case "$(uname -s)" in
  Linux) PLATFORM=linux ;;
  Darwin) PLATFORM=macos ;;
  *) echo 'Bergamot builds require Linux or macOS.' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo 'Unsupported Bergamot CPU architecture.' >&2; exit 1 ;;
esac

BUILD_DIR="$DIR/../../build/bergamot/$PLATFORM-$ARCH"
cmake -S "$DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release "$@"
cmake --build "$BUILD_DIR" --target chaya-bergamot-translator --parallel "${CMAKE_BUILD_PARALLEL_LEVEL:-2}"
cmake --install "$BUILD_DIR" --prefix "$DIR/../bin/$PLATFORM-$ARCH" --component chaya
