import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { SHELL_CACHE_DIR_NAME } from '@/constants/path-names'
import { DATA_DIR, ROOT_PATH } from '@/constants/paths'
import { normalizeNwVersion, nwArchiveName, nwDownloadUrl, nwFileKey, type NwFlavor } from '@/lib/game/nw-download-meta'
import { findNwExeInDir, findNwLinuxBinary, looksLikeNwShellSource, resolveShellSourceRoot } from '@/lib/game/shell-layout'
import { toolkitDataDir } from '@/lib/game/toolkit-data'

const VERSIONS_URL = 'https://nwjs.io/versions.json'

export type NwDownloadResult = {
  version: string
  fileKey: string
  shellSource: string
  downloaded: boolean
  chromium?: string
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

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
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

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`下载 NW.js 失败 HTTP ${res.status}: ${url}`)
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  try {
    const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
    await pipeline(nodeStream, fs.createWriteStream(tmp))
    fs.renameSync(tmp, dest)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* */
    }
    throw e
  }
}

async function extractArchive(archive: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  const lower = archive.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await run('tar', ['-xzf', archive, '-C', destDir])
    return
  }
  if (process.platform === 'win32') {
    // Expand-Archive；路径用单引号转义
    const esc = (p: string) => p.replace(/'/g, "''")
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${esc(archive)}' -DestinationPath '${esc(destDir)}' -Force`])
    return
  }
  await run('unzip', ['-q', '-o', archive, '-d', destDir])
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

export async function fetchVersionsJson(): Promise<VersionsJson> {
  const res = await fetch(VERSIONS_URL, { redirect: 'follow', signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`拉取 NW.js 版本清单失败 HTTP ${res.status}`)
  return (await res.json()) as VersionsJson
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
}

/**
 * 下载并解压当前平台最新 NW.js 到 `data/shell-cache/`，返回可作 shellSource 的路径。
 * Windows / macOS / Linux 均支持（与本机 `process.platform` 对齐）。
 */
export async function ensureLatestNwShellSource(opts: EnsureLatestNwOpts = {}): Promise<NwDownloadResult> {
  const platform = (opts.platform ?? process.platform) as NodeJS.Platform
  const arch = opts.arch ?? process.arch
  const flavor = opts.flavor ?? 'normal'
  const fileKey = nwFileKey(platform, arch)

  const versions = await fetchVersionsJson()
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
    if (!fs.existsSync(archivePath) || opts.forceDownload) {
      if (fs.existsSync(archivePath) && opts.forceDownload) fs.rmSync(archivePath, { force: true })
      await downloadToFile(nwDownloadUrl(version, fileKey, flavor), archivePath)
      downloaded = true
    }
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
    await extractArchive(archivePath, extractDir)
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
  }
}
