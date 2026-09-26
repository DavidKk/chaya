import fs from 'node:fs'
import path from 'node:path'

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

export function gameContentPath(contentRoot: string, kind: GameContentKind): string {
  return path.join(path.resolve(contentRoot), gameContentRelPath(kind))
}

export function gameContentCandidatePaths(contentRoot: string, kind: GameContentKind, opts?: { alsoParent?: boolean }): string[] {
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
