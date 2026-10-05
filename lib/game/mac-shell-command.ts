import { bashI18nBlock } from '@/lib/remote-scripts/i18n'

import { MAC_SHELL_MESSAGES } from './mac-shell-messages'

/**
 * Served as `/sh/mac-shell.sh`; users run it via `bash -c "$(curl …)"`.
 * Native extraction preserves executable permissions and framework symlinks that FSA cannot write.
 * Keep `${` out of the script body: it is a JS template literal.
 */
const SCRIPT = String.raw`#!/usr/bin/env bash
# Chaya · Install / repair the macOS game shell (NW.js)
set -euo pipefail

@@I18N@@

if [ -t 1 ]; then
  bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; red=$'\033[31m'; reset=$'\033[0m'
else
  bold=''; dim=''; green=''; red=''; reset=''
fi
action=$(printenv CHAYA_ACTION || true)
total=6
[ "$action" != uninstall ] || total=3
step() { printf '\n%s[%s/%s] %s%s\n' "$bold" "$1" "$total" "$2" "$reset"; }
info() { printf '      %s%s%s\n' "$dim" "$1" "$reset"; }
fail() { printf '%s✗ %s%s\n' "$red" "$1" "$reset"; exit 1; }
# Defaults to "no"; only asks on an interactive stdin.
confirm() {
  answer=''
  if [ -t 0 ]; then
    printf '%s [y/N] ' "$1"
    read -r answer || answer=''
  fi
  case "$answer" in [yY] | [yY][eE][sS]) return 0 ;; esac
  return 1
}
# Succeeds when dotted version $1 < $2.
version_lt() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, "."); if (m > n) n = m
    for (i = 1; i <= n; i++) { if (x[i] + 0 < y[i] + 0) exit 0; if (x[i] + 0 > y[i] + 0) exit 1 }
    exit 1
  }'
}

[ "$(uname -s)" = Darwin ] || fail "$M_needMac"

if [ "$action" = uninstall ]; then
  printf '%s%s%s\n' "$bold" "$M_titleUninstall" "$reset"
else
  printf '%s%s%s\n' "$bold" "$M_title" "$reset"
fi

step 1 "$M_step1"
# The prompt goes in as an argument, never as AppleScript source (messages may come from a downloaded language pack).
game=$(osascript -e 'on run argv' -e 'POSIX path of (choose folder with prompt (item 1 of argv))' -e 'end run' "$M_pickPrompt")
game=$(cd "$game" && pwd -P)
case "$game/" in
  *.app/*) fail "$M_insideApp" ;;
esac
info "$game"

step 2 "$M_step2"
content="$game"
[ ! -f "$game/www/index.html" ] || content="$game/www"
[ -f "$content/index.html" ] && [ -d "$content/js" ] || fail "$M_noContent"

app="$game/Chaya.app"

# Browser mode cannot delete the bundle (framework symlinks); only Chaya-written shell names, never saves or backups.
if [ "$action" = uninstall ]; then
  set --
  for name in Chaya.app ShiruKit.app nwjs.app; do
    if [ -e "$game/$name" ] || [ -L "$game/$name" ]; then set -- "$@" "$game/$name"; fi
  done
  if [ "$#" -eq 0 ]; then
    printf '\n%s\n' "$M_nothingToRemove"
    exit 0
  fi
  for shell; do
    for bin in "$shell/Contents/MacOS/nwjs" "$shell/Contents/MacOS/nw"; do
      if [ -f "$bin" ] && /usr/sbin/lsof -t "$bin" >/dev/null 2>&1; then
        fail "$M_running"
      fi
    done
  done
  step 3 "$M_step3Uninstall"
  for shell; do
    rm -rf "$shell"
    info "$(msg "$M_removed" "$shell")"
  done
  printf '\n%s✓ %s%s\n' "$green$bold" "$M_uninstalled" "$reset"
  printf '%s\n' "$M_uninstallHint"
  exit 0
fi

case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) fail "$M_badArch" ;;
esac
if [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
info "$(msg "$M_gameContent" "$content")"
info "$(msg "$M_arch" "$arch")"

work=$(mktemp -d "$game/.chaya-install.XXXXXX")
backup=''
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    if [ -n "$backup" ] && [ ! -e "$app" ] && [ ! -L "$app" ]; then mv "$backup" "$app"; fi
    printf '\n%s✗ %s%s\n' "$red" "$M_failed" "$reset"
  fi
  rm -rf "$work"
  exit "$result"
}
trap cleanup EXIT

step 3 "$M_step3"
versions_json=$(curl --fail --silent --show-error --location --retry 2 --connect-timeout 20 --max-time 60 \
  --proto '=https' --proto-redir '=https' 'https://nwjs.io/versions.json')
# Here-strings, not pipes: an early-exiting reader would SIGPIPE the writer under pipefail.
version=$(awk -F'"' '$2 == "stable" { print $4; exit }' <<<"$versions_json")
[ -n "$version" ] || version=$(awk -F'"' '$2 == "latest" { print $4; exit }' <<<"$versions_json")
case "$version" in
  '') fail "$M_badVersion" ;;
  v*) ;;
  *) version="v$version" ;;
esac
target_chromium=$(awk -v v="\"$version\"" '
  index($0, "\"version\"") && index($0, v) { hit = 1 }
  hit && /"chromium"/ { sub(/.*"chromium"[[:space:]]*:[[:space:]]*"/, ""); sub(/".*/, ""); print; exit }' <<<"$versions_json")
info "$(msg "$M_version" "$version")"

# Existing shell: up to date and intact → skip; older → ask (default no); broken → reinstall.
install=1
if [ -e "$app" ] || [ -L "$app" ]; then
  current_chromium=$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist" 2>/dev/null || true)
  intact=0
  if [ -x "$app/Contents/MacOS/nwjs" ] && [ "$(readlink "$app/Contents/Resources/app.nw" 2>/dev/null || true)" = "$content" ] &&
    codesign --verify --deep "$app" >/dev/null 2>&1; then
    intact=1
  fi
  if [ "$intact" = 0 ]; then
    info "$M_shellBroken"
  elif [ -z "$current_chromium" ] || [ -z "$target_chromium" ]; then
    info "$M_shellUnknown"
    confirm "$M_confirmReplace" || install=0
  elif version_lt "$current_chromium" "$target_chromium"; then
    info "$(msg "$M_shellOld" "$current_chromium" "$version" "$target_chromium")"
    confirm "$(msg "$M_confirmUpdate" "$version")" || install=0
  else
    info "$(msg "$M_shellLatest" "$current_chromium")"
    install=0
  fi
fi

if [ "$install" = 1 ]; then
  for bin in "$app/Contents/MacOS/nwjs" "$app/Contents/MacOS/nw"; do
    if [ -f "$bin" ] && /usr/sbin/lsof -t "$bin" >/dev/null 2>&1; then
      fail "$M_running"
    fi
  done

  step 4 "$(msg "$M_step4" "$version")"
  zip_name="nwjs-$version-osx-$arch.zip"
  zip_url="https://dl.nwjs.io/$version/$zip_name"
  sums=$(curl --fail --silent --location --retry 2 --connect-timeout 20 --max-time 60 \
    --proto '=https' --proto-redir '=https' "https://dl.nwjs.io/$version/SHASUMS256.txt" 2>/dev/null || true)
  expected_sha=$(awk -v f="$zip_name" '$2 == f { print $1; exit }' <<<"$sums")
  zip_ok() {
    if [ -n "$expected_sha" ]; then
      [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$expected_sha" ]
    else
      unzip -tq "$1" >/dev/null 2>&1
    fi
  }
  fetch_zip() {
    curl --fail --location --retry 2 --connect-timeout 20 --max-time 900 --progress-bar \
      --proto '=https' --proto-redir '=https' "$@" "$zip_url"
  }

  # /tmp is cleared on reboot; only trust a private directory owned by this user.
  cache_dir=$(printenv CHAYA_NW_CACHE_DIR || true)
  [ -n "$cache_dir" ] || cache_dir="/tmp/chaya-nwjs-$(id -u)"
  cache=''
  if [ ! -L "$cache_dir" ] && mkdir -p -m 700 "$cache_dir" 2>/dev/null && [ -O "$cache_dir" ] && chmod 700 "$cache_dir"; then
    cache="$cache_dir"
  fi

  if [ -n "$cache" ]; then
    info "$(msg "$M_tmpCache" "$cache")"
    zip="$cache/$zip_name"
    part="$zip.part"
    if [ -f "$zip" ] && zip_ok "$zip"; then
      info "$(msg "$M_useCache" "$zip")"
    else
      rm -f "$zip"
      if [ -s "$part" ]; then info "$(msg "$M_resume" "$(du -h "$part" | cut -f1 | tr -d ' ')")"; fi
      code=0
      fetch_zip --continue-at - -o "$part" || code=$?
      if ! { [ -s "$part" ] && zip_ok "$part"; }; then
        # Network errors keep the partial file for resuming; a finished or HTTP-rejected (e.g. 416) bad file is discarded.
        if [ "$code" -eq 0 ] || [ "$code" -eq 22 ]; then
          rm -f "$part"
          fail "$M_checksumDeleted"
        fi
        fail "$M_interrupted"
      fi
      mv "$part" "$zip"
      find "$cache" -maxdepth 1 -name 'nwjs-*.zip*' ! -name "$zip_name" -delete 2>/dev/null || true
      info "$(msg "$M_downloaded" "$(du -h "$zip" | cut -f1 | tr -d ' ')")"
    fi
  else
    info "$(msg "$M_tmpWork" "$work")"
    zip="$work/nwjs.zip"
    fetch_zip -o "$zip"
    zip_ok "$zip" || fail "$M_checksum"
    info "$(msg "$M_downloaded" "$(du -h "$zip" | cut -f1 | tr -d ' ')")"
  fi

  step 5 "$M_step5"
  ditto -x -k "$zip" "$work/extracted"
  fresh="$work/extracted/nwjs-$version-osx-$arch/nwjs.app"
  [ -x "$fresh/Contents/MacOS/nwjs" ] || fail "$M_missingExe"
  link="$fresh/Contents/Resources/app.nw"
  [ ! -e "$link" ] && [ ! -L "$link" ] || fail "$M_unexpected"
  ln -s "$content" "$link"

  step 6 "$M_step6"
  xattr -cr "$fresh"
  codesign --force --deep --sign - "$fresh"
  codesign --verify --deep "$fresh"
  if [ -e "$app" ] || [ -L "$app" ]; then
    backup="$game/Chaya.app.backup-$(date +%Y%m%d-%H%M%S)-$$"
    mv "$app" "$backup"
  fi
  mv "$fresh" "$app"

  printf '\n%s✓ %s%s\n' "$green$bold" "$M_installed" "$reset"
  [ -z "$backup" ] || info "$(msg "$M_backup" "$backup")"
else
  printf '\n%s✓ %s%s\n' "$green$bold" "$M_kept" "$reset"
fi
info "$(msg "$M_shellPath" "$app")"
printf '\n%s\n' "$M_pluginsHint"

if confirm "$M_confirmOpen"; then
  if open "$app"; then info "$M_started"; else info "$M_openFailed"; fi
else
  printf '%s\n' "$M_bye"
fi
`

export const MAC_SHELL_SCRIPT = SCRIPT.replace('@@I18N@@', () => bashI18nBlock('mac-shell', MAC_SHELL_MESSAGES.en))
