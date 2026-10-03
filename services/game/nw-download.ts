import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { SHELL_CACHE_DIR_NAME } from '@/constants/path-names'
import { DATA_DIR, ROOT_PATH } from '@/constants/paths'
import { normalizeNwVersion, nwArchiveName, nwDownloadUrl, nwFileKey, type NwFlavor } from '@/lib/game/nw-download-meta'
import { findNwExeInDir, findNwLinuxBinary, looksLikeNwShellSource, resolveShellSourceRoot } from '@/lib/game/shell-layout'
import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { downloadToFile, sha256File } from '@/services/downloads/resumable'

const VERSIONS_URL = 'https://nwjs.io/versions.json'

export type NwDownloadResult = {
  version: string
  fileKey: string
  shellSource: string
  downloaded: boolean
  chromium?: string
  /** 本版本缓存目录（`data/shell-cache/<ver>-<fileKey>`） */
  packDir: string
}

export type VersionsJson = {
  latest?: string
  stable?: string
  versions?: Array<{
    version: string
    files?: string[]
    flavors?: string[]
    components?: { chromium?: string; node?: string }
  }>
}

function shellCacheDir(toolkitRoot?: string): string {
  if (!toolkitRoot || path.resolve(toolkitRoot) === ROOT_PATH) {
    return path.join(DATA_DIR, SHELL_CACHE_DIR_NAME)
  }
  return path.join(toolkitDataDir(toolkitRoot), SHELL_CACHE_DIR_NAME)
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], signal })
    let err = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} 失败 (exit ${code})${err ? `: ${err.trim()}` : ''}`))
    })
  })
}

async function extractArchive(archive: string, destDir: string, signal?: AbortSignal): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  const lower = archive.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await run('tar', ['-xzf', archive, '-C', destDir], signal)
    return
  }
  if (process.platform === 'win32') {
    // Expand-Archive；路径用单引号转义
    const esc = (p: string) => p.replace(/'/g, "''")
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${esc(archive)}' -DestinationPath '${esc(destDir)}' -Force`], signal)
    return
  }
  await run('unzip', ['-q', '-o', archive, '-d', destDir], signal)
}

function looksLikeMacAppBundle(appPath: string): boolean {
  return appPath.toLowerCase().endsWith('.app') && fs.existsSync(path.join(appPath, 'Contents', 'MacOS'))
}

/** 在解压目录里找可用壳源（.app / 含 nw.exe 的目录 / 含 nw 的目录） */
export function findShellSourceInExtract(extractRoot: string): string {
  const root = path.resolve(extractRoot)
  if (!fs.existsSync(root)) throw new Error(`解压目录不存在: ${root}`)

  const tryPath = (p: string): string | null => {
    if (!fs.existsSync(p)) return null
    try {
      if (looksLikeMacAppBundle(p)) return p
      if (!fs.statSync(p).isDirectory()) {
        if (looksLikeNwShellSource(p)) return resolveShellSourceRoot(p)
        return null
      }
      if (findNwExeInDir(p) || findNwLinuxBinary(p)) return p
      if (looksLikeNwShellSource(p)) return resolveShellSourceRoot(p)
    } catch {
      return null
    }
    return null
  }

  const queue = [root]
  for (const name of fs.readdirSync(root)) {
    queue.push(path.join(root, name))
  }
  // 再浅挖一层（zip 常包一层 nwjs-v…/）
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name)
    try {
      if (!fs.statSync(p).isDirectory()) continue
      for (const child of fs.readdirSync(p)) queue.push(path.join(p, child))
    } catch {
      /* */
    }
  }

  for (const p of queue) {
    const hit = tryPath(p)
    if (hit) return hit
  }

  throw new Error(`解压后未找到可用 NW.js 壳（.app / nw.exe / nw）: ${root}`)
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
}

export async function fetchVersionsJson(signal?: AbortSignal): Promise<VersionsJson> {
  const res = await fetch(VERSIONS_URL, { redirect: 'follow', signal: withTimeout(8_000, signal) })
  if (!res.ok) throw new Error(`拉取 NW.js 版本清单失败 HTTP ${res.status}`)
  return (await res.json()) as VersionsJson
}

/** 从 `SHASUMS256.txt` 取压缩包的 SHA-256；超时 / 网络失败返回 undefined，任务取消照常抛出 */
export async function fetchNwSha256(version: string, archiveName: string, signal?: AbortSignal): Promise<string | undefined> {
  const ver = normalizeNwVersion(version)
  try {
    const res = await fetch(`https://dl.nwjs.io/${ver}/SHASUMS256.txt`, { redirect: 'follow', signal: withTimeout(10_000, signal) })
    if (!res.ok) return undefined
    return parseShaSums(await res.text(), archiveName)
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
}

export function parseShaSums(text: string, archiveName: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (m && path.basename(m[2].trim()) === archiveName) return m[1].toLowerCase()
  }
  return undefined
}

/** 删除其它版本目录里的 `.part` 与压缩包（不动解压目录），失败忽略 */
export function pruneShellCacheParts(keepPackDir: string): void {
  const cacheRoot = path.dirname(keepPackDir)
  let dirs: string[]
  try {
    dirs = fs.readdirSync(cacheRoot)
  } catch {
    return
  }
  for (const name of dirs) {
    const dir = path.join(cacheRoot, name)
    if (path.resolve(dir) === path.resolve(keepPackDir)) continue
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      for (const file of fs.readdirSync(dir)) {
        if (/\.(zip|tar\.gz)(\.part)?$/i.test(file)) fs.rmSync(path.join(dir, file), { force: true })
      }
    } catch {
      /* */
    }
  }
}

export type EnsureLatestNwOpts = {
  toolkitRoot?: string
  /** 默认 stable（与 latest 通常相同） */
  channel?: 'stable' | 'latest'
  flavor?: NwFlavor
  /** 已有缓存仍重新下载 */
  forceDownload?: boolean
  platform?: NodeJS.Platform
  arch?: string
  signal?: AbortSignal
  onProgress?: (p: NwDownloadProgress) => void
}

export type NwDownloadProgress =
  { phase: 'resolve' } | { phase: 'download'; version: string; receivedBytes: number; totalBytes?: number; resumedFrom: number } | { phase: 'extract'; version: string }

/**
 * 下载并解压当前平台最新 NW.js 到 `data/shell-cache/`，返回可作 shellSource 的路径。
 * Windows / macOS / Linux 均支持（与本机 `process.platform` 对齐）。
 */
export async function ensureLatestNwShellSource(opts: EnsureLatestNwOpts = {}): Promise<NwDownloadResult> {
  const platform = (opts.platform ?? process.platform) as NodeJS.Platform
  const arch = opts.arch ?? process.arch
  const flavor = opts.flavor ?? 'normal'
  const fileKey = nwFileKey(platform, arch)

  opts.onProgress?.({ phase: 'resolve' })
  const versions = await fetchVersionsJson(opts.signal)
  opts.signal?.throwIfAborted()
  const channelVer = opts.channel === 'latest' ? versions.latest : versions.stable || versions.latest
  if (!channelVer) throw new Error('versions.json 未提供 stable/latest')
  const version = normalizeNwVersion(channelVer)

  const meta = versions.versions?.find((v) => normalizeNwVersion(v.version) === version)
  if (meta?.files && !meta.files.includes(fileKey)) {
    throw new Error(`NW.js ${version} 不提供 ${fileKey} 包（可选: ${meta.files.join(', ')}）`)
  }

  const cacheRoot = shellCacheDir(opts.toolkitRoot)
  const packDir = path.join(cacheRoot, `${flavor === 'sdk' ? 'sdk-' : ''}${version}-${fileKey}`)
  const extractDir = path.join(packDir, 'extract')
  const archivePath = path.join(packDir, nwArchiveName(version, fileKey, flavor))

  let shellSource: string | null = null
  let downloaded = false

  if (!opts.forceDownload && fs.existsSync(extractDir)) {
    try {
      shellSource = findShellSourceInExtract(extractDir)
    } catch {
      shellSource = null
    }
  }

  if (!shellSource) {
    fs.mkdirSync(packDir, { recursive: true })
    if (opts.forceDownload && fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true })
    }
    if (fs.existsSync(archivePath) && opts.forceDownload) fs.rmSync(archivePath, { force: true })
    const archiveName = path.basename(archivePath)
    const sha256 = await fetchNwSha256(version, archiveName, opts.signal)
    let verified = false
    if (fs.existsSync(archivePath) && sha256) {
      if ((await sha256File(archivePath, opts.signal)) === sha256) verified = true
      else fs.rmSync(archivePath, { force: true })
    }
    if (!fs.existsSync(archivePath)) {
      await downloadToFile(nwDownloadUrl(version, fileKey, flavor), archivePath, {
        signal: opts.signal,
        sha256,
        label: archiveName,
        onBytes: (p) => opts.onProgress?.({ phase: 'download', version, ...p }),
      })
      verified = Boolean(sha256)
      downloaded = true
    }
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
    opts.onProgress?.({ phase: 'extract', version })
    try {
      await extractArchive(archivePath, extractDir, opts.signal)
    } catch (e) {
      fs.rmSync(extractDir, { recursive: true, force: true })
      if (opts.signal?.aborted) throw opts.signal.reason instanceof Error ? opts.signal.reason : e
      if (!verified) {
        fs.rmSync(archivePath, { force: true })
        throw new Error(`解压 ${archiveName} 失败，已删除压缩包，重试会重新下载：${e instanceof Error ? e.message : String(e)}`)
      }
      throw new Error(`解压 ${archiveName} 失败（压缩包校验通过，已保留）：${e instanceof Error ? e.message : String(e)}`)
    }
    // 解压成功后删掉压缩包省空间
    try {
      fs.rmSync(archivePath, { force: true })
    } catch {
      /* */
    }
    shellSource = findShellSourceInExtract(extractDir)
    if (!downloaded) downloaded = true
  }

  return {
    version,
    fileKey,
    shellSource,
    downloaded,
    chromium: meta?.components?.chromium,
    packDir,
  }
}
