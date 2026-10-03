/**
 * 浏览器侧 NW 壳：直连 dl.nwjs.io 下载 → OPFS 缓存 zip → 解压写入游戏目录（可断点续写）。
 * CDN 无 CORS，浏览器无法 fetch 读包体：触发官方下载后由用户选本地 zip。
 * FSA 无系统解压 API，只能逐文件写入；中断后可跳过已写满的文件并复用缓存 zip。
 * 步骤拆为 prepare / 打开下载 / 选文件 / 写入，由下载中心任务（cloud-shell-task）编排。
 */
import { unzipSync } from 'fflate'

import { SHELL_APP_NAME, SHELL_BUNDLE_BASE, SHELL_LAUNCHER_LINUX, SHELL_LAUNCHER_MAC, SHELL_LAUNCHER_WIN, SHELL_WIN_DIR_NAME } from '@/constants/brand'
import { normalizeNwVersion, nwArchiveName, nwDownloadUrl, nwFileKey } from '@/lib/game/nw-download-meta'

import { detectClientArch, dirExists, ensurePath, fileByteLength, fileExists, getDir, writeBytesFile, writeTextFile } from './fsa'

export type NwWriteProgress = { done: number; total: number; skipped: number }

const MIN_ZIP_BYTES = 1_000_000

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

/** 只拿 File 句柄，读入内存留到排队之后 */
async function cachedZipFile(version: string, fileKey: string): Promise<File | null> {
  const dir = await opfsCacheDir()
  if (!dir) return null
  try {
    const file = await (await dir.getFileHandle(cacheFileName(version, fileKey))).getFile()
    return file.size < MIN_ZIP_BYTES ? null : file
  } catch {
    return null
  }
}

/** 写入 OPFS 缓存；失败不影响安装 */
export async function cacheNwZip(version: string, fileKey: string, data: Uint8Array): Promise<void> {
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

/** 缓存的压缩包损坏时删除 */
export async function dropCachedNwZip(version: string, fileKey: string): Promise<void> {
  const dir = await opfsCacheDir()
  await dir?.removeEntry(cacheFileName(version, fileKey)).catch(() => {})
}

type OpenFilePickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (options?: { multiple?: boolean; types?: Array<{ description?: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle[]>
  }

/** 触发浏览器从官方 CDN 下载（不经本站代理） */
export function openOfficialNwDownload(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.click()
}

export class WrongNwFileError extends Error {
  constructor(readonly expected: string) {
    super(`请选择 ${expected}`)
  }
}

/** 浏览器重名下载会追加 ` (1)`；去掉后必须等于期望的压缩包名 */
export function matchesArchiveName(fileName: string, archiveName: string): boolean {
  return fileName.replace(/ \(\d+\)(?=\.zip$)/i, '') === archiveName
}

function checkPickedFile(file: File, archiveName: string): File {
  if (!matchesArchiveName(file.name, archiveName)) throw new WrongNwFileError(archiveName)
  if (file.size < MIN_ZIP_BYTES) throw new Error(`所选文件过小（${formatMb(file.size)}），请选择已下载完成的 ${archiveName}`)
  return file
}

/** 须在用户点击里调用（打开文件选择框）；只校验文件名与大小，不读入内存 */
export async function pickLocalNwZip(archiveName: string): Promise<File> {
  const w = window as OpenFilePickerWindow
  if (typeof w.showOpenFilePicker === 'function') {
    const [handle] = await w.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'NW.js zip', accept: { 'application/zip': ['.zip'] } }],
    })
    return checkPickedFile(await handle.getFile(), archiveName)
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,application/zip'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('未选择 NW.js 压缩包'))
        return
      }
      try {
        resolve(checkPickedFile(file, archiveName))
      } catch (e) {
        reject(e)
      }
    }
    input.oncancel = () => reject(new DOMException('已取消选择 NW.js 压缩包', 'AbortError'))
    input.click()
  })
}

async function fetchLatestVersion(signal?: AbortSignal): Promise<string> {
  const res = await fetch('https://nwjs.io/versions.json', { signal })
  if (!res.ok) throw new Error(`拉取 NW.js 版本失败 HTTP ${res.status}`)
  const j = (await res.json()) as { stable?: string; latest?: string }
  return normalizeNwVersion(j.stable || j.latest || '')
}

export type WinShellPlan = { version: string; fileKey: string; archiveName: string; url: string; cached: File | null }

/** 拉最新版本号并查 OPFS 缓存 */
export async function prepareWinShell(signal?: AbortSignal): Promise<WinShellPlan> {
  const arch = detectClientArch()
  const fileKey = nwFileKey('win32', arch === 'ia32' ? 'ia32' : arch)
  const version = await fetchLatestVersion(signal)
  return { version, fileKey, archiveName: nwArchiveName(version, fileKey), url: nwDownloadUrl(version, fileKey), cached: await cachedZipFile(version, fileKey) }
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

/** 逐文件写入；同名且大小一致则跳过（断点续写）；每个文件前检查取消 */
async function writeZipEntriesResume(
  destRoot: FileSystemDirectoryHandle,
  files: Record<string, Uint8Array>,
  opts: { signal?: AbortSignal; onProgress?: (p: NwWriteProgress) => void; remapAppTo?: string } = {}
): Promise<{ written: number; skipped: number }> {
  const entries = Object.entries(files).filter(([, data]) => data && data.length > 0)
  if (entries.length === 0) throw new Error('NW.js 压缩包为空')

  let done = 0
  let written = 0
  let skipped = 0
  const total = entries.length
  opts.onProgress?.({ done, total, skipped })

  for (const [entryPath, data] of entries) {
    opts.signal?.throwIfAborted()
    const rel = zipRelPath(entryPath, opts.remapAppTo)
    done += 1
    if (rel) {
      const fileName = rel[rel.length - 1]!
      const dirParts = rel.slice(0, -1)
      const dir = dirParts.length ? await ensurePath(destRoot, dirParts) : destRoot
      if ((await fileByteLength(dir, fileName)) === data.byteLength) skipped += 1
      else {
        await writeBytesFile(dir, fileName, data)
        written += 1
      }
    }
    if (done === total || done % 10 === 0) opts.onProgress?.({ done, total, skipped })
  }
  return { written, skipped }
}

/** 解压失败（缓存或所选文件损坏）时抛出，调用方据此删除缓存并让用户重新选文件 */
export class CorruptNwZipError extends Error {}

/** 解压并写入 `<projectRoot>/<SHELL_WIN_DIR_NAME>/`，最后检查 nw.exe */
export async function writeWinShell(
  projectRoot: FileSystemDirectoryHandle,
  zip: Uint8Array,
  opts: { signal?: AbortSignal; onProgress?: (p: NwWriteProgress) => void } = {}
): Promise<void> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zip)
  } catch (e) {
    throw new CorruptNwZipError(`NW.js 压缩包损坏：${e instanceof Error ? e.message : String(e)}`)
  }
  const shellDir = await getDir(projectRoot, SHELL_WIN_DIR_NAME, true)
  await writeZipEntriesResume(shellDir, files, opts)
  if (!(await fileExists(shellDir, 'nw.exe'))) {
    throw new Error(`解压后未找到 ${SHELL_WIN_DIR_NAME}/nw.exe`)
  }
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
