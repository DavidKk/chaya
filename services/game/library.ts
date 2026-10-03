import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { ChayaConfig, LibraryEntry, LibraryItemView } from '@/lib/game'
import { findEnclosingAppBundle, resolveGame } from '@/lib/game'
import { libraryKindLabel } from '@/lib/game/library-label'

import { getGameFingerprintSummary } from './fingerprint'

function normalizeRootKey(gameRoot: string): string {
  return String(gameRoot || '')
    .trim()
    .replace(/[/\\]+$/, '')
}

/** 从路径字面量取出包围的 .app（不依赖磁盘，库条目可能已失效） */
function appBundleFromPathLiteral(raw: string): string | null {
  const normalized = normalizeRootKey(raw).replace(/\\/g, '/')
  if (!normalized) return null
  if (/\.app$/i.test(normalized)) return normalized
  const idx = normalized.toLowerCase().lastIndexOf('.app/')
  if (idx >= 0) return normalized.slice(0, idx + 4)
  return null
}

/** 标准 UUID v4；历史条目曾用路径 base64url，过长且难读 */
const LIBRARY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isLibraryEntryId(id: string): boolean {
  return LIBRARY_UUID_RE.test(String(id || '').trim())
}

/** 新建库条目 id（UUID）；不再由路径派生 */
export function libraryEntryId(_gameRoot?: string, _opts?: { remote?: boolean }): string {
  return randomUUID()
}

function stableLibraryId(existing: string | undefined): string {
  const id = String(existing || '').trim()
  return isLibraryEntryId(id) ? id : libraryEntryId()
}

export function displayNameFromPath(gameRoot: string): string {
  const base = path.basename(normalizeRootKey(gameRoot).replace(/\\/g, '/'))
  return base.replace(/\.app$/i, '') || base || '未命名游戏'
}

export function pathEquals(a: string, b: string): boolean {
  const left = normalizeRootKey(a)
  const right = normalizeRootKey(b)
  if (!left || !right) return false
  if (left === right) return true
  try {
    return path.resolve(left) === path.resolve(right)
  } catch {
    return false
  }
}

/** 同一 .app / 内容树视为同一作（用于清掉误标的远程重复项） */
export function sameGameFamily(a: string, b: string): boolean {
  if (pathEquals(a, b)) return true
  const left = normalizeRootKey(a)
  const right = normalizeRootKey(b)
  if (!left || !right) return false
  try {
    const bundleA = findEnclosingAppBundle(left) || appBundleFromPathLiteral(left) || (left.toLowerCase().endsWith('.app') ? left : null)
    const bundleB = findEnclosingAppBundle(right) || appBundleFromPathLiteral(right) || (right.toLowerCase().endsWith('.app') ? right : null)
    if (bundleA && bundleB && pathEquals(bundleA, bundleB)) return true
    if (bundleA && pathEquals(bundleA, right)) return true
    if (bundleB && pathEquals(bundleB, left)) return true
  } catch {
    /* */
  }
  return false
}

export function findLibraryEntry(library: LibraryEntry[], gameRoot: string): LibraryEntry | undefined {
  return library.find((item) => pathEquals(item.gameRoot, gameRoot))
}

export function normalizeRemark(raw: unknown): string | undefined {
  const next = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  return next || undefined
}

/** 展示名：有备注用备注，否则用原始 name */
export function libraryDisplayName(entry: Pick<LibraryEntry, 'name' | 'remark'>): string {
  return normalizeRemark(entry.remark) || entry.name || '未命名游戏'
}

/** 写入/更新库条目；更新时保持原下标，避免切换游戏打乱列表顺序 */
export function upsertLibraryEntry(
  library: LibraryEntry[],
  entry: { gameRoot: string; name?: string; remote?: boolean; remark?: string | null; touchOpen?: boolean }
): LibraryEntry[] {
  const remote = !!entry.remote
  const raw = normalizeRootKey(entry.gameRoot)
  if (!raw) return library
  const gameRoot = remote ? raw : path.resolve(raw)
  const prev = library.find((item) => pathEquals(item.gameRoot, gameRoot))
  const id = stableLibraryId(prev?.id)
  const name = (entry.name || '').trim() || prev?.name || displayNameFromPath(gameRoot)
  const remark = entry.remark !== undefined ? normalizeRemark(entry.remark) : normalizeRemark(prev?.remark)
  const now = Date.now()
  const touchOpen = entry.touchOpen !== false
  const next: LibraryEntry = {
    id,
    gameRoot,
    name,
    lastOpenedAt: touchOpen ? now : (prev?.lastOpenedAt ?? now),
    addedAt: prev?.addedAt && prev.addedAt > 0 ? prev.addedAt : now,
    ...(remote ? { remote: true } : {}),
    ...(remark ? { remark } : {}),
  }
  if (prev) {
    return library.map((item) => (item.id === id || pathEquals(item.gameRoot, gameRoot) ? next : item))
  }
  return [...library, next]
}

export function removeLibraryEntry(library: LibraryEntry[], gameRoot: string): LibraryEntry[] {
  const target = String(gameRoot || '').trim()
  if (!target) return library
  return library.filter((item) => !pathEquals(item.gameRoot, target))
}

export function normalizeLibrary(raw: unknown, fallbackGameRoot = ''): LibraryEntry[] {
  const list: LibraryEntry[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const gameRootRaw = String(rec.gameRoot || '').trim()
      if (!gameRootRaw) continue
      const remote = !!rec.remote
      const gameRoot = remote ? normalizeRootKey(gameRootRaw) : path.resolve(gameRootRaw)
      const id = stableLibraryId(String(rec.id || ''))
      const name = String(rec.name || '').trim() || displayNameFromPath(gameRoot)
      const remark = normalizeRemark(rec.remark)
      const lastOpenedAt = Number(rec.lastOpenedAt)
      const addedRaw = Number(rec.addedAt)
      const opened = Number.isFinite(lastOpenedAt) ? lastOpenedAt : 0
      const addedAt = Number.isFinite(addedRaw) && addedRaw > 0 ? addedRaw : opened || Date.now()
      list.push({
        id,
        gameRoot,
        name,
        lastOpenedAt: opened,
        addedAt,
        ...(remote ? { remote: true } : {}),
        ...(remark ? { remark } : {}),
      })
    }
  }

  const fallback = String(fallbackGameRoot || '').trim()
  if (fallback && !list.some((item) => pathEquals(item.gameRoot, fallback))) {
    const now = Date.now()
    list.push({
      id: libraryEntryId(),
      gameRoot: path.resolve(fallback),
      name: displayNameFromPath(fallback),
      lastOpenedAt: now,
      addedAt: now,
    })
  }

  // 不在此按 lastOpened 重排：展示排序交给控制台，避免切换时列表跳动
  return list
}

export function touchLibraryOpen(config: ChayaConfig, gameRoot: string, name?: string): ChayaConfig {
  const prev = findLibraryEntry(config.library, gameRoot)
  return {
    ...config,
    library: upsertLibraryEntry(config.library, {
      gameRoot,
      name,
      remote: prev?.remote,
      remark: prev?.remark ?? null,
    }),
  }
}

function kindLabelOf(kind: string | undefined, missing: boolean, remote: boolean): string {
  return libraryKindLabel(kind, { missing, remote, platform: process.platform })
}

function shortenPath(p: string, max = 42): string {
  const next = normalizeRootKey(p)
  if (next.length <= max) return next
  return `…${next.slice(-(max - 1))}`
}

export function toLibraryItemView(entry: LibraryEntry): LibraryItemView {
  if (entry.remote) {
    return {
      ...entry,
      remote: true,
      missing: false,
      kindLabel: kindLabelOf(undefined, false, true),
      pathLabel: 'N/A',
      hasShell: false,
    }
  }
  const resolved = resolveGame(entry.gameRoot)
  const missing = !resolved.ok
  const fingerprint = resolved.ok ? getGameFingerprintSummary(resolved) : undefined
  return {
    ...entry,
    remote: false,
    missing,
    kindLabel: kindLabelOf(resolved.ok ? resolved.kind : undefined, missing, false),
    pathLabel: shortenPath(entry.gameRoot),
    hasShell: resolved.ok ? resolved.hasShell : false,
    ...(fingerprint ? { fingerprint } : {}),
  }
}

/** 路径暂时不可访问不应删除用户记录或改变选中；missing 由视图计算。 */
export function reconcileLibraryConfig(config: ChayaConfig): {
  config: ChayaConfig
  changed: boolean
  pruned: string[]
  switchedTo: string | null
} {
  return { config, changed: false, pruned: [], switchedTo: null }
}
