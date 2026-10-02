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
for bin in "$app/Contents/MacOS/nwjs" "$app/Contents/MacOS/nw"; do
  if [ -f "$bin" ] && /usr/sbin/lsof -t "$bin" >/dev/null 2>&1; then
    fail '游戏正在运行，请先退出游戏再执行此命令。'
  fi
done

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
version=$(printf '%s' "$versions_json" | sed -n 's/.*"stable"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$version" ] || version=$(printf '%s' "$versions_json" | sed -n 's/.*"latest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
case "$version" in
  '') fail '无法解析 NW.js 版本。' ;;
  v*) ;;
  *) version="v$version" ;;
esac
info "版本：$version"

step 4 "下载 NW.js $version"'（约 100 MB，请稍候）'
curl --fail --location --retry 2 --connect-timeout 20 --max-time 900 --progress-bar \
  --proto '=https' --proto-redir '=https' \
  "https://dl.nwjs.io/$version/nwjs-$version-osx-$arch.zip" -o "$work/nwjs.zip"
info "已下载：$(du -h "$work/nwjs.zip" | cut -f1 | tr -d ' ')"

step 5 '解压并关联游戏内容'
ditto -x -k "$work/nwjs.zip" "$work/extracted"
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
info "游戏壳：$app"
[ -z "$backup" ] || info "旧壳备份：$backup"
printf '\n下一步：双击 Chaya.app 启动游戏；插件请回到网页单独安装。\n'
`
