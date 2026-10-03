/**
 * Served as `/sh/mac-shell.sh`; users run it via `bash -c "$(curl …)"`.
 * Native extraction preserves executable permissions and framework symlinks that FSA cannot write.
 * Keep `${` out of the script body: it is a JS template literal.
 */
export const MAC_SHELL_SCRIPT = String.raw`#!/usr/bin/env bash
# Chaya · 安装 / 修复 macOS 游戏壳（NW.js）
set -euo pipefail

if [ -t 1 ]; then
  bold=$'\033[1m'; dim=$'\033[2m'; green=$'\033[32m'; red=$'\033[31m'; reset=$'\033[0m'
else
  bold=''; dim=''; green=''; red=''; reset=''
fi
total=6
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

[ "$(uname -s)" = Darwin ] || fail '请在 macOS 终端执行。'

printf '%sChaya · 安装 / 修复 macOS 游戏壳%s\n' "$bold" "$reset"

step 1 '选择游戏目录（请在弹出的窗口中选择）'
game=$(osascript -e 'POSIX path of (choose folder with prompt "选择游戏目录（含 www 或 index.html），请先退出游戏")')
game=$(cd "$game" && pwd -P)
case "$game/" in
  *.app/*) fail '请选择应用包外的游戏目录。' ;;
esac
info "$game"

step 2 '检查游戏'
content="$game"
[ ! -f "$game/www/index.html" ] || content="$game/www"
[ -f "$content/index.html" ] && [ -d "$content/js" ] || fail '未找到游戏内容，未做任何修改。'

app="$game/Chaya.app"

case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) fail '不支持的芯片架构。' ;;
esac
if [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
info "游戏内容：$content"
info "芯片架构：$arch"

work=$(mktemp -d "$game/.chaya-install.XXXXXX")
backup=''
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    if [ -n "$backup" ] && [ ! -e "$app" ] && [ ! -L "$app" ]; then mv "$backup" "$app"; fi
    printf '\n%s✗ 安装未完成；原壳和游戏内容已保留。请将上方错误复制给 Chaya。%s\n' "$red" "$reset"
  fi
  rm -rf "$work"
  exit "$result"
}
trap cleanup EXIT

step 3 '查询 NW.js 稳定版'
versions_json=$(curl --fail --silent --show-error --location --retry 2 --connect-timeout 20 --max-time 60 \
  --proto '=https' --proto-redir '=https' 'https://nwjs.io/versions.json')
# Here-strings, not pipes: an early-exiting reader would SIGPIPE the writer under pipefail.
version=$(awk -F'"' '$2 == "stable" { print $4; exit }' <<<"$versions_json")
[ -n "$version" ] || version=$(awk -F'"' '$2 == "latest" { print $4; exit }' <<<"$versions_json")
case "$version" in
  '') fail '无法解析 NW.js 版本。' ;;
  v*) ;;
  *) version="v$version" ;;
esac
target_chromium=$(awk -v v="\"$version\"" '
  index($0, "\"version\"") && index($0, v) { hit = 1 }
  hit && /"chromium"/ { sub(/.*"chromium"[[:space:]]*:[[:space:]]*"/, ""); sub(/".*/, ""); print; exit }' <<<"$versions_json")
info "版本：$version"

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
    info '现有游戏壳不完整或未关联本游戏，将重新安装。'
  elif [ -z "$current_chromium" ] || [ -z "$target_chromium" ]; then
    info '无法判断现有游戏壳版本。'
    confirm '重新下载并替换游戏壳？' || install=0
  elif version_lt "$current_chromium" "$target_chromium"; then
    info "现有游戏壳较旧：Chromium $current_chromium"'，'"最新 $version 为 Chromium $target_chromium"
    confirm "更新到 $version"'？' || install=0
  else
    info "现有游戏壳已是最新（Chromium $current_chromium"'），跳过下载。'
    install=0
  fi
fi

if [ "$install" = 1 ]; then
  for bin in "$app/Contents/MacOS/nwjs" "$app/Contents/MacOS/nw"; do
    if [ -f "$bin" ] && /usr/sbin/lsof -t "$bin" >/dev/null 2>&1; then
      fail '游戏正在运行，请先退出游戏再执行此命令。'
    fi
  done

  step 4 "下载 NW.js $version"'（约 100 MB，请稍候）'
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
    info "临时目录：$cache"'（重启前可断点续传）'
    zip="$cache/$zip_name"
    part="$zip.part"
    if [ -f "$zip" ] && zip_ok "$zip"; then
      info "使用已下载的缓存：$zip"
    else
      rm -f "$zip"
      if [ -s "$part" ]; then info "继续上次未完成的下载（已有 $(du -h "$part" | cut -f1 | tr -d ' ')）"; fi
      code=0
      fetch_zip --continue-at - -o "$part" || code=$?
      if ! { [ -s "$part" ] && zip_ok "$part"; }; then
        # Network errors keep the partial file for resuming; a finished or HTTP-rejected (e.g. 416) bad file is discarded.
        if [ "$code" -eq 0 ] || [ "$code" -eq 22 ]; then
          rm -f "$part"
          fail '下载文件校验失败，已删除，请重新执行。'
        fi
        fail '下载中断，已保留进度，重新执行即可继续下载。'
      fi
      mv "$part" "$zip"
      find "$cache" -maxdepth 1 -name 'nwjs-*.zip*' ! -name "$zip_name" -delete 2>/dev/null || true
      info "已下载：$(du -h "$zip" | cut -f1 | tr -d ' ')"
    fi
  else
    info "临时目录：$work"
    zip="$work/nwjs.zip"
    fetch_zip -o "$zip"
    zip_ok "$zip" || fail '下载文件校验失败。'
    info "已下载：$(du -h "$zip" | cut -f1 | tr -d ' ')"
  fi

  step 5 '解压并关联游戏内容'
  ditto -x -k "$zip" "$work/extracted"
  fresh="$work/extracted/nwjs-$version-osx-$arch/nwjs.app"
  [ -x "$fresh/Contents/MacOS/nwjs" ] || fail '下载包缺少可执行程序。'
  link="$fresh/Contents/Resources/app.nw"
  [ ! -e "$link" ] && [ ! -L "$link" ] || fail '下载包含意外的游戏内容，已停止。'
  ln -s "$content" "$link"

  step 6 '签名并安装'
  xattr -cr "$fresh"
  codesign --force --deep --sign - "$fresh"
  codesign --verify --deep "$fresh"
  if [ -e "$app" ] || [ -L "$app" ]; then
    backup="$game/Chaya.app.backup-$(date +%Y%m%d-%H%M%S)-$$"
    mv "$app" "$backup"
  fi
  mv "$fresh" "$app"

  printf '\n%s✓ 安装完成%s\n' "$green$bold" "$reset"
  [ -z "$backup" ] || info "旧壳备份：$backup"
else
  printf '\n%s✓ 保留现有游戏壳%s\n' "$green$bold" "$reset"
fi
info "游戏壳：$app"
printf '\n插件请回到网页单独安装。\n'

if confirm '现在打开游戏？'; then
  if open "$app"; then info '已启动游戏。'; else info '启动失败，请双击 Chaya.app 打开。'; fi
else
  printf '已退出；之后双击 Chaya.app 即可启动游戏。\n'
fi
`
