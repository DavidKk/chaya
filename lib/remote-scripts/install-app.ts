import { bashI18nBlock, type ScriptMessages } from './i18n'
import messages from './install-app-messages.json'

export const INSTALL_APP_MESSAGES: ScriptMessages<keyof (typeof messages)['en']> = messages

/**
 * Served as `/sh/install.sh`: installs the Chaya desktop app on macOS.
 * Files fetched with curl carry no quarantine flag, so Gatekeeper does not show
 * "damaged" for the ad-hoc signed app.
 * Keep `${` out of the script body: it is a JS template literal.
 */
const SCRIPT = String.raw`#!/usr/bin/env bash
# Chaya · macOS app installer
set -euo pipefail

@@I18N@@

REPO="DavidKk/chaya"
APP_NAME="Chaya.app"
MOUNT=""

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "$M_notMac"

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) die "$(msg "$M_badArch" "$(uname -m)")" ;;
esac

say "$(msg "$M_lookingUp" "$ARCH")"
# Newest first; prereleases included (v0.x is published as prerelease)
URLS="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=10" \
  | grep -o '"browser_download_url": *"[^"]*"' \
  | sed -E 's/.*"(https[^"]+)"$/\1/')" || die "$M_noGithub"

URL="$(printf '%s\n' "$URLS" | grep -E -- "-$ARCH-mac\.zip$" | head -n 1 || true)"
[ -n "$URL" ] || URL="$(printf '%s\n' "$URLS" | grep -E -- "-$ARCH\.dmg$" | head -n 1 || true)"
[ -n "$URL" ] || die "$(msg "$M_noBuild" "$ARCH" "https://github.com/$REPO/releases")"

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

say "$(msg "$M_downloading" "$(basename "$URL")")"
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
[ -d "$SRC" ] || die "$(msg "$M_notInDownload" "$APP_NAME")"

if pgrep -xq Chaya; then
  say "$M_quitting"
  osascript -e 'quit app "Chaya"' >/dev/null 2>&1 || true
  sleep 1
fi

say "$(msg "$M_installing" "$DEST/$APP_NAME")"
rm -rf "$DEST/$APP_NAME"
ditto "$SRC" "$DEST/$APP_NAME"
xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true

say "$M_done"
open "$DEST/$APP_NAME"
`

export const INSTALL_APP_SCRIPT = SCRIPT.replace('@@I18N@@', () => bashI18nBlock('install', INSTALL_APP_MESSAGES.en))
