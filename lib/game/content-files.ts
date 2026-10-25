import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import {
  GAME_CONTENT_DIR,
  GAME_CONTENT_RELS,
  GAME_PLUGINS_CACHE_DIR,
  GAME_PLUGINS_DISABLED_REL,
  type GameContentKind,
  gameContentRelPath,
  gamePluginsCacheRelDir,
  gamePluginsDisabledRelPath,
  LEGACY_FLAT_FILES,
} from '@/lib/game/content-paths'
import { publicGameFile } from '@/services/storage/game-files'

export type { GameContentKind }
export {
  GAME_CONTENT_DIR,
  GAME_CONTENT_RELS,
  GAME_PLUGINS_CACHE_DIR,
  GAME_PLUGINS_DISABLED_REL,
  gameContentRelPath,
  gamePluginsCacheRelDir,
  gamePluginsDisabledRelPath,
  LEGACY_FLAT_FILES,
}

/** @deprecated 用 GAME_CONTENT_RELS；保留别名以免外部误用旧名 */
export const GAME_CONTENT_FILES = GAME_CONTENT_RELS

/** 旧品牌 / 管线文件名（只读回退）— 与 LEGACY_FLAT_FILES 相同 */
export const LEGACY_GAME_CONTENT_FILES = LEGACY_FLAT_FILES

/** Documents owned by the storage daemon and materialized into its per-game read view. */
const STORAGE_DOCUMENT_KINDS: ReadonlySet<GameContentKind> = new Set<GameContentKind>([
  'seed',
  'cacheNdjson',
  'switches',
  'translationPlay',
  'translationPreview',
  'gameEdit',
  'inputAssistance',
  'gameSaves',
])

/**
 * Resolve the storage daemon's per-game read view from its on-disk registry.
 * This is plain fs (no `storageCall` / `Atomics.wait`), so it is safe on the
 * poll / inventory hot path, while still pointing at the same files the daemon
 * writes — not the stale copies under the game's own `chaya/` directory.
 */
type StorageDirectoryRegistry = { file: string; mtimeMs: number; byRoot: Map<string, string> }
let registryCache: StorageDirectoryRegistry | null = null

function storageDirectoryRegistry(): StorageDirectoryRegistry | null {
  if (typeof DATA_DIR !== 'string' || !DATA_DIR) return null
  const file = path.join(DATA_DIR, 'runtime', 'game-directories.json')
  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0
  } catch {
    mtimeMs = 0
  }
  if (!mtimeMs) {
    registryCache = null
    return null
  }
  if (registryCache && registryCache.file === file && registryCache.mtimeMs === mtimeMs) return registryCache

  const byRoot = new Map<string, string>()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [root, state] of Object.entries(raw as Record<string, unknown>)) {
        if (!state || typeof state !== 'object') continue
        const directory = (state as { directory?: unknown }).directory
        if (typeof directory === 'string' && directory) byRoot.set(path.resolve(root), path.resolve(directory))
      }
    }
  } catch {
    /* A missing or malformed registry falls back to in-game files below. */
  }
  registryCache = { file, mtimeMs, byRoot }
  return registryCache
}

function storageGameDirectory(contentRoot: string): string | null {
  const registry = storageDirectoryRegistry()
  if (!registry) return null
  const key = path.resolve(contentRoot)
  const direct = registry.byRoot.get(key)
  if (direct) return direct
  // Symlinked roots may only match by their resolved canonical path.
  try {
    const real = fs.realpathSync(contentRoot)
    for (const [root, directory] of registry.byRoot) {
      try {
        if (fs.realpathSync(root) === real) return directory
      } catch {
        /* skip unresolvable entries */
      }
    }
  } catch {
    /* contentRoot not on disk yet */
  }
  return null
}

export function gameContentPath(contentRoot: string, kind: GameContentKind): string {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) return publicGameFile(contentRoot, kind)
  return path.join(path.resolve(contentRoot), gameContentRelPath(kind))
}

export function gameContentCandidatePaths(contentRoot: string, kind: GameContentKind, opts?: { alsoParent?: boolean }): string[] {
  if (STORAGE_DOCUMENT_KINDS.has(kind)) return [publicGameFile(contentRoot, kind)]
  const root = path.resolve(contentRoot)
  const dirs = opts?.alsoParent ? [root, path.dirname(root)] : [root]
  const out: string[] = []
  for (const dir of dirs) {
    out.push(path.join(dir, gameContentRelPath(kind)))
    for (const name of LEGACY_FLAT_FILES[kind]) {
      out.push(path.join(dir, name))
    }
  }
  return out
}

export function gameContentReadPath(contentRoot: string, kind: GameContentKind, opts?: { alsoParent?: boolean }): string | null {
  return gameContentCandidatePaths(contentRoot, kind, opts).find((p) => fs.existsSync(p)) ?? null
}

/**
 * Resolve game content under the content root without storage IPC.
 * Safe on Next.js poll / inventory / stamp — never `publicGameFile` / `Atomics.wait`.
 * Prefer this over `gameContentReadPath` for any path that must not block the console.
 */
export function localGameContentFile(contentRoot: string, kind: GameContentKind): string | null {
  // Storage-backed documents live in the daemon's read view, not under contentRoot.
  // Resolve their canonical directory first so poll / inventory paths read the same
  // files the daemon writes, without taking the storage IPC (Atomics.wait) path.
  if (STORAGE_DOCUMENT_KINDS.has(kind)) {
    const directory = storageGameDirectory(contentRoot)
    if (directory) {
      const canonical = path.join(directory, GAME_CONTENT_RELS[kind])
      if (fs.existsSync(canonical)) return canonical
    }
  }
  const roots = [path.resolve(contentRoot)]
  const parent = path.dirname(roots[0])
  if (parent !== roots[0]) roots.push(parent)
  for (const root of roots) {
    const primary = path.join(root, GAME_CONTENT_DIR, GAME_CONTENT_RELS[kind])
    if (fs.existsSync(primary)) return primary
    for (const name of LEGACY_FLAT_FILES[kind]) {
      const candidate = path.join(root, name)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

export function ensureGameContentDir(contentRoot: string, kind: GameContentKind): string {
  const file = gameContentPath(contentRoot, kind)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  return file
}

/** 内容根下 `chaya/plugins`（跟踪插件磁盘缓存） */
export function gamePluginsCacheDir(contentRoot: string): string {
  return path.join(path.resolve(contentRoot), gamePluginsCacheRelDir())
}

export function ensureGamePluginsCacheDir(contentRoot: string): string {
  const dir = gamePluginsCacheDir(contentRoot)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function gamePluginsDisabledPath(contentRoot: string): string {
  return path.join(path.resolve(contentRoot), gamePluginsDisabledRelPath())
}

export function isGamePluginsDisabled(contentRoot: string): boolean {
  return fs.existsSync(gamePluginsDisabledPath(contentRoot))
}

/** 清空目录内文件（不删目录本身；忽略子目录名以 `.` 开头的占位） */
export function emptyDirContents(dir: string): string[] {
  const removed: string[] = []
  if (!fs.existsSync(dir)) return removed
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    try {
      const st = fs.lstatSync(full)
      if (st.isDirectory()) {
        fs.rmSync(full, { recursive: true, force: true })
      } else {
        fs.unlinkSync(full)
      }
      removed.push(name)
    } catch {
      /* */
    }
  }
  return removed
}

export type MigrateGameContentResult = {
  contentRoot: string
  moved: Array<{ kind: GameContentKind; from: string; to: string }>
  skipped: Array<{ kind: GameContentKind; reason: string; path?: string }>
}

/**
 * 将内容根旧扁平产物迁到 `chaya/{translate|config}/…`。
 * 目标已存在则跳过；迁成功后删除该 kind 的全部旧扁平副本。
 */
export function migrateGameContentFiles(contentRoot: string): MigrateGameContentResult {
  const root = path.resolve(contentRoot)
  const moved: MigrateGameContentResult['moved'] = []
  const skipped: MigrateGameContentResult['skipped'] = []

  for (const kind of Object.keys(GAME_CONTENT_RELS) as GameContentKind[]) {
    if (['seed', 'cacheNdjson', 'switches', 'translationPlay', 'translationPreview', 'gameEdit', 'inputAssistance', 'gameSaves'].includes(kind)) {
      skipped.push({ kind, reason: 'storage-daemon-imports-and-retains-source' })
      continue
    }
    const dest = gameContentPath(root, kind)
    if (fs.existsSync(dest)) {
      skipped.push({ kind, reason: 'target-exists', path: dest })
      continue
    }

    let source: string | null = null
    for (const name of LEGACY_FLAT_FILES[kind]) {
      const candidate = path.join(root, name)
      if (fs.existsSync(candidate)) {
        source = candidate
        break
      }
      const parentCandidate = path.join(path.dirname(root), name)
      if (fs.existsSync(parentCandidate)) {
        source = parentCandidate
        break
      }
    }

    if (!source) {
      skipped.push({ kind, reason: 'no-legacy' })
      continue
    }

    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(source, dest)
      moved.push({ kind, from: source, to: dest })
    } catch {
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(source, dest)
        fs.unlinkSync(source)
        moved.push({ kind, from: source, to: dest })
      } catch (err) {
        skipped.push({ kind, reason: err instanceof Error ? err.message : 'move-failed', path: source })
        continue
      }
    }

    for (const name of LEGACY_FLAT_FILES[kind]) {
      for (const dir of [root, path.dirname(root)]) {
        const leftover = path.join(dir, name)
        if (leftover === dest) continue
        if (!fs.existsSync(leftover)) continue
        try {
          fs.unlinkSync(leftover)
        } catch {
          /* */
        }
      }
    }
  }

  return { contentRoot: root, moved, skipped }
}
