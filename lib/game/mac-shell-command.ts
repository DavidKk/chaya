/** Native extraction preserves executable permissions and framework symlinks that FSA cannot write. */
export const MAC_SHELL_COMMAND = String.raw`/bin/bash <<'CHAYA_INSTALL'
set -euo pipefail
[ "$(uname -s)" = Darwin ] || { echo '请在 macOS 终端执行。'; exit 1; }
game=$(osascript -e 'POSIX path of (choose folder with prompt "选择游戏目录（含 www 或 index.html），请先退出游戏")')
game=$(cd "$game" && pwd -P)
case "$game/" in *.app/*) echo '请选择应用包外的游戏目录。'; exit 1;; esac
content="$game"
[ ! -f "$game/www/index.html" ] || content="$game/www"
[ -f "$content/index.html" ] && [ -d "$content/js" ] || { echo '未找到游戏内容，未做任何修改。'; exit 1; }
app="$game/Chaya.app"
for bin in "$app/Contents/MacOS/nwjs" "$app/Contents/MacOS/nw"; do
  if [ -f "$bin" ] && /usr/sbin/lsof -t "$bin" >/dev/null 2>&1; then
    echo '请先退出游戏，再执行此命令。'; exit 1
  fi
done
case "$(uname -m)" in arm64) arch=arm64;; x86_64) arch=x64;; *) echo '不支持的芯片架构'; exit 1;; esac
if [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
work=$(mktemp -d "$game/.chaya-install.XXXXXX")
backup=''
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    if [ -n "$backup" ] && [ ! -e "$app" ] && [ ! -L "$app" ]; then mv "$backup" "$app"; fi
    echo '安装未完成；原壳和游戏内容已保留。请将上方错误复制给 Chaya。'
  fi
  rm -rf "$work"
  exit "$result"
}
trap cleanup EXIT
version=v0.116.0
echo '正在下载并安装 NW.js，请稍候…'
curl --fail --location --retry 2 --connect-timeout 20 --max-time 900 --proto '=https' --proto-redir '=https' \
  "https://dl.nwjs.io/$version/nwjs-$version-osx-$arch.zip" -o "$work/nwjs.zip"
ditto -x -k "$work/nwjs.zip" "$work/extracted"
fresh="$work/extracted/nwjs-$version-osx-$arch/nwjs.app"
[ -x "$fresh/Contents/MacOS/nwjs" ] || { echo '下载包缺少可执行程序。'; exit 1; }
link="$fresh/Contents/Resources/app.nw"
[ ! -e "$link" ] && [ ! -L "$link" ] || { echo '下载包含意外的游戏内容，已停止。'; exit 1; }
ln -s "$content" "$link"
xattr -cr "$fresh"
codesign --force --deep --sign - "$fresh"
codesign --verify --deep "$fresh"
if [ -e "$app" ] || [ -L "$app" ]; then
  backup="$game/Chaya.app.backup-$(date +%Y%m%d-%H%M%S)-$$"
  mv "$app" "$backup"
fi
mv "$fresh" "$app"
echo "安装完成：$app"
[ -z "$backup" ] || echo "旧壳备份：$backup"
echo '现在可以双击 Chaya.app 启动游戏。插件请在网页中单独安装。'
CHAYA_INSTALL`
