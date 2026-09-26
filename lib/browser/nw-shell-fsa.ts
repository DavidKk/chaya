/**
 * 浏览器侧 NW 壳：代理下载 → OPFS 缓存 zip → 解压写入游戏目录（可断点续写）。
 * FSA 无系统解压 API，只能逐文件写入；中断后可跳过已写满的文件并复用缓存 zip。
 */
import { unzipSync } from 'fflate'

import { SHELL_APP_NAME, SHELL_BUNDLE_BASE, SHELL_LAUNCHER_LINUX, SHELL_LAUNCHER_MAC, SHELL_LAUNCHER_WIN, SHELL_WIN_DIR_NAME } from '@/constants/brand'
import { normalizeNwVersion, nwFileKey } from '@/lib/game/nw-download-meta'

import { detectClientArch, dirExists, ensurePath, fileByteLength, fileExists, getDir, writeBytesFile, writeTextFile } from './fsa'

export type NwShellProgress = {
  phase: 'shell'
  message: string
  percent?: number
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function cacheFileName(version: string, fileKey: string): string {
  return `${normalizeNwVersion(version)}-${fileKey}.zip`
}

async function opfsCacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle('chaya-nw-shell', { create: true })
  } catch {
    return null
  }
}

async function readZipFromOpfs(version: string, fileKey: string): Promise<Uint8Array | null> {
  const dir = await opfsCacheDir()
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(cacheFileName(version, fileKey))
    const file = await handle.getFile()
    if (file.size < 1_000_000) return null
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
}

async function writeZipToOpfs(version: string, fileKey: string, data: Uint8Array): Promise<void> {
  const dir = await opfsCacheDir()
  if (!dir) return
  try {
    const handle = await dir.getFileHandle(cacheFileName(version, fileKey), { create: true })
    const writable = await handle.createWritable()
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    await writable.write(copy)
    await writable.close()
  } catch {
    /* 缓存失败不影响安装 */
  }
}

async function downloadNwZip(version: string, fileKey: string, onProgress?: (p: NwShellProgress) => void): Promise<Uint8Array> {
  const proxyUrl = `/api/remote/nw-archive?version=${encodeURIComponent(version)}&file=${encodeURIComponent(fileKey)}`
  onProgress?.({ phase: 'shell', message: `下载 NW.js ${version}（约 200MB）…`, percent: 0 })

  const res = await fetch(proxyUrl)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`下载 NW.js 失败 HTTP ${res.status}${t ? `: ${t.slice(0, 160)}` : ''}`)
  }

  const total = Number(res.headers.get('content-length') || 0)
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onProgress?.({ phase: 'shell', message: `下载完成 ${formatMb(buf.byteLength)}`, percent: 100 })
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value?.length) continue
    chunks.push(value)
    received += value.length
    const pct = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : undefined
    onProgress?.({
      phase: 'shell',
      message: total > 0 ? `下载 NW.js ${version}… ${formatMb(received)} / ${formatMb(total)}` : `下载 NW.js ${version}… ${formatMb(received)}`,
      percent: pct,
    })
  }

  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  onProgress?.({ phase: 'shell', message: `下载完成 ${formatMb(received)}`, percent: 100 })
  return out
}

/** 优先 OPFS 缓存，未命中再下载并写入缓存 */
export async function loadNwZip(version: string, fileKey: string, onProgress?: (p: NwShellProgress) => void): Promise<Uint8Array> {
  const cached = await readZipFromOpfs(version, fileKey)
  if (cached) {
    onProgress?.({
      phase: 'shell',
      message: `使用浏览器缓存 ${formatMb(cached.byteLength)}（跳过下载）`,
      percent: 100,
    })
    return cached
  }
  const buf = await downloadNwZip(version, fileKey, onProgress)
  void writeZipToOpfs(version, fileKey, buf)
  return buf
}

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch('https://nwjs.io/versions.json')
  if (!res.ok) throw new Error(`拉取 NW.js 版本失败 HTTP ${res.status}`)
  const j = (await res.json()) as { stable?: string; latest?: string }
  return normalizeNwVersion(j.stable || j.latest || '')
}

/**
 * zip 内路径 → 相对写入路径。
 * 剥掉顶层 nwjs-v…/；mac 把 nwjs.app 重命名为统一 SHELL_APP_NAME。
 */
function zipRelPath(entryPath: string, remapAppTo?: string): string[] | null {
  if (entryPath.endsWith('/')) return null
  const parts = entryPath.split('/').filter(Boolean)
  let rel = parts[0]?.startsWith('nwjs') && !parts[0].endsWith('.app') ? parts.slice(1) : parts
  if (remapAppTo && rel[0]?.toLowerCase() === 'nwjs.app') {
    rel = [remapAppTo, ...rel.slice(1)]
  }
  return rel.length ? rel : null
}

/** 逐文件写入；同名且大小一致则跳过（断点续写） */
async function writeZipEntriesResume(
  destRoot: FileSystemDirectoryHandle,
  files: Record<string, Uint8Array>,
  onProgress?: (p: NwShellProgress) => void,
  label = '写入',
  remapAppTo?: string
): Promise<{ written: number; skipped: number }> {
  const entries = Object.entries(files).filter(([, data]) => data && data.length > 0)
  if (entries.length === 0) throw new Error('NW.js 压缩包为空')

  let done = 0
  let written = 0
  let skipped = 0
  const total = entries.length

  for (const [entryPath, data] of entries) {
    const rel = zipRelPath(entryPath, remapAppTo)
    if (!rel) continue
    const fileName = rel[rel.length - 1]!
    const dirParts = rel.slice(0, -1)
    const dir = dirParts.length ? await ensurePath(destRoot, dirParts) : destRoot
    const existing = await fileByteLength(dir, fileName)
    if (existing === data.byteLength) {
      skipped += 1
    } else {
      await writeBytesFile(dir, fileName, data)
      written += 1
    }
    done += 1
    if (done === 1 || done === total || done % 25 === 0) {
      const pct = Math.min(99, Math.round((done / total) * 100))
      const skipHint = skipped > 0 ? `（已跳过 ${skipped}）` : ''
      onProgress?.({
        phase: 'shell',
        message: `${label}… ${done}/${total}${skipHint}`,
        percent: pct,
      })
    }
  }

  const skipHint = skipped > 0 ? `，跳过 ${skipped} 个已有文件` : ''
  onProgress?.({ phase: 'shell', message: `${label}完成${skipHint}`, percent: 100 })
  return { written, skipped }
}

export async function looksLikeMacNwApp(appDir: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const contents = await getDir(appDir, 'Contents')
    const macOs = await getDir(contents, 'MacOS')
    for (const bin of ['nwjs', 'nw', 'node-webkit']) {
      if (await fileExists(macOs, bin)) return true
    }
  } catch {
    /* */
  }
  return false
}

export async function isCompleteMacShell(root: FileSystemDirectoryHandle, appName: string): Promise<boolean> {
  if (!(await dirExists(root, appName))) return false
  return looksLikeMacNwApp(await getDir(root, appName))
}

export async function isCompleteWinShell(root: FileSystemDirectoryHandle, dirName: string): Promise<boolean> {
  if (!(await dirExists(root, dirName))) return false
  return fileExists(await getDir(root, dirName), 'nw.exe')
}

export async function installWindowsShellFsa(projectRoot: FileSystemDirectoryHandle, onProgress?: (p: NwShellProgress) => void): Promise<{ version: string; dirName: string }> {
  const arch = detectClientArch()
  const fileKey = nwFileKey('win32', arch === 'ia32' ? 'ia32' : arch)
  const version = await fetchLatestVersion()
  const buf = await loadNwZip(version, fileKey, onProgress)
  onProgress?.({ phase: 'shell', message: '解压中…' })
  const files = unzipSync(buf)
  const shellDir = await getDir(projectRoot, SHELL_WIN_DIR_NAME, true)
  await writeZipEntriesResume(shellDir, files, onProgress, `写入 ${SHELL_WIN_DIR_NAME}/`)
  if (!(await fileExists(shellDir, 'nw.exe'))) {
    throw new Error(`解压后未找到 ${SHELL_WIN_DIR_NAME}/nw.exe`)
  }
  return { version, dirName: SHELL_WIN_DIR_NAME }
}

function macLauncherScript(): string {
  const app = SHELL_APP_NAME
  return `#!/bin/bash
# ${SHELL_BUNDLE_BASE} — 原位启动（传内容根，不把游戏嵌进壳）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/${app}"
BIN="$APP/Contents/MacOS/nwjs"
[ -x "$BIN" ] || BIN="$APP/Contents/MacOS/nw"
CONTENT="$DIR"
if [ -f "$DIR/www/index.html" ]; then CONTENT="$DIR/www"; fi
if [ ! -f "$CONTENT/index.html" ]; then
  echo "未找到游戏内容（index.html）。请把本脚本放在发布根或内容根旁。"
  read -r _
  exit 1
fi
# 可选：链 app.nw，之后也可直接双击 ${app}（浏览器无法建软链，首次由此脚本创建）
LINK="$APP/Contents/Resources/app.nw"
if [ -d "$APP/Contents/Resources" ] && [ ! -e "$LINK" ]; then
  ln -sfn "$CONTENT" "$LINK" 2>/dev/null || true
fi
exec "$BIN" "$CONTENT"
`
}

function winLauncherScript(): string {
  return `@echo off
REM ${SHELL_BUNDLE_BASE} — 原位启动（传内容根，不把游戏嵌进壳）
setlocal
set "DIR=%~dp0"
set "DIR=%DIR:~0,-1%"
set "EXE=%DIR%\\${SHELL_WIN_DIR_NAME}\\nw.exe"
set "CONTENT=%DIR%"
if exist "%DIR%\\www\\index.html" set "CONTENT=%DIR%\\www"
if not exist "%CONTENT%\\index.html" (
  echo 未找到游戏内容（index.html）。请把本脚本放在发布根或内容根旁。
  pause
  exit /b 1
)
start "" "%EXE%" "%CONTENT%"
`
}

function linuxLauncherScript(): string {
  return `#!/bin/bash
# ${SHELL_BUNDLE_BASE} — 原位启动（传内容根）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/${SHELL_WIN_DIR_NAME}/nw"
[ -x "$BIN" ] || BIN="$DIR/${SHELL_WIN_DIR_NAME}/nwjs"
CONTENT="$DIR"
if [ -f "$DIR/www/index.html" ]; then CONTENT="$DIR/www"; fi
if [ ! -f "$CONTENT/index.html" ]; then
  echo "未找到游戏内容（index.html）"
  exit 1
fi
exec "$BIN" "$CONTENT"
`
}

/**
 * 在发布根写入一键启动脚本。游戏仍在 www/ 原位，不拷进壳。
 * （浏览器 FSA 无法创建软链 / 无法 chmod；Mac 首次用 .command 可顺带 ln -s）
 */
export async function writeShellLaunchers(projectRoot: FileSystemDirectoryHandle, os: 'win' | 'mac' | 'linux'): Promise<string> {
  if (os === 'win') {
    await writeTextFile(projectRoot, SHELL_LAUNCHER_WIN, winLauncherScript())
    return SHELL_LAUNCHER_WIN
  }
  if (os === 'mac') {
    await writeTextFile(projectRoot, SHELL_LAUNCHER_MAC, macLauncherScript())
    return SHELL_LAUNCHER_MAC
  }
  await writeTextFile(projectRoot, SHELL_LAUNCHER_LINUX, linuxLauncherScript())
  return SHELL_LAUNCHER_LINUX
}
