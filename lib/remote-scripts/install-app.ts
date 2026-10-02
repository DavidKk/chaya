/**
 * Served as `/sh/install.sh`: installs the Chaya desktop app on macOS.
 * Files fetched with curl carry no quarantine flag, so Gatekeeper does not show
 * "damaged" for the ad-hoc signed app.
 * Keep `${` out of the script body: it is a JS template literal.
 */
export const INSTALL_APP_SCRIPT = String.raw`#!/usr/bin/env bash
# Chaya · macOS 桌面应用安装 / macOS app installer
set -euo pipefail

REPO="DavidKk/chaya"
APP_NAME="Chaya.app"
MOUNT=""

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer only supports macOS."

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) die "Unsupported architecture: $(uname -m)" ;;
esac

say "Looking up the latest Chaya release ($ARCH)..."
# Newest first; prereleases included (v0.x is published as prerelease)
URLS="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=10" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed -E 's/.*"(https[^"]+)"$/\1/')" || die "Could not reach GitHub."

URL="$(printf '%s\n' "$URLS" | grep -E -- "-$ARCH-mac\.zip$" | head -n 1 || true)"
[ -n "$URL" ] || URL="$(printf '%s\n' "$URLS" | grep -E -- "-$ARCH\.dmg$" | head -n 1 || true)"
[ -n "$URL" ] || die "No macOS $ARCH build found. See https://github.com/$REPO/releases"

if [ -w /Applications ]; then
  DEST="/Applications"
else
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

TMP="$(mktemp -d)"
cleanup() {
  if [ -n "$MOUNT" ]; then hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

say "Downloading $(basename "$URL")..."
curl -fL --progress-bar -o "$TMP/pkg" "$URL"

case "$URL" in
  *.zip)
    ditto -x -k "$TMP/pkg" "$TMP/out"
    SRC="$TMP/out/$APP_NAME"
    ;;
  *.dmg)
    MOUNT="$TMP/mnt"
    hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MOUNT" "$TMP/pkg"
    SRC="$MOUNT/$APP_NAME"
    ;;
esac
[ -d "$SRC" ] || die "$APP_NAME not found in the download."

if pgrep -xq Chaya; then
  say "Quitting running Chaya..."
  osascript -e 'quit app "Chaya"' >/dev/null 2>&1 || true
  sleep 1
fi

say "Installing to $DEST/$APP_NAME..."
rm -rf "$DEST/$APP_NAME"
ditto "$SRC" "$DEST/$APP_NAME"
xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true

say "Done. Opening Chaya..."
open "$DEST/$APP_NAME"
`
