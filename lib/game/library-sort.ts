import type { LibraryEntry, LibrarySortMode } from '@/lib/game/types'

export type { LibrarySortMode }

const LIBRARY_SORT_MODES = new Set<string>(['manual', 'name', 'lastOpened', 'addedAt'])

export function parseLibrarySortMode(raw: unknown, fallback: LibrarySortMode = 'name'): LibrarySortMode {
  return typeof raw === 'string' && LIBRARY_SORT_MODES.has(raw) ? (raw as LibrarySortMode) : fallback
}

function displayLabel(entry: Pick<LibraryEntry, 'name' | 'remark'>): string {
  const remark = String(entry.remark ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  return remark || entry.name || '未命名游戏'
}

/** 按给定 id 重排；未出现的条目按原顺序接在末尾，重复 id 忽略 */
export function orderLibraryEntries<T extends { id: string }>(entries: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(entries.map((item) => [item.id, item]))
  const seen = new Set<string>()
  const next: T[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    next.push(item)
  }
  for (const item of entries) if (!seen.has(item.id)) next.push(item)
  return next
}

/** 把 source 插到 target 前或后。顺序没变、或找不到条目时返回 null */
export function reorderLibraryIds(ids: readonly string[], sourceId: string, targetId: string, after: boolean): string[] | null {
  if (!sourceId || sourceId === targetId || !ids.includes(sourceId)) return null
  const next = ids.filter((id) => id !== sourceId)
  const index = next.indexOf(targetId)
  if (index < 0) return null
  next.splice(index + (after ? 1 : 0), 0, sourceId)
  if (next.length === ids.length && next.every((id, at) => id === ids[at])) return null
  return next
}

/** 控制台列表排序（不改写配置数组顺序）。`manual` 就是当前数组顺序 */
export function sortLibraryEntries<T extends Pick<LibraryEntry, 'id' | 'name' | 'remark' | 'lastOpenedAt' | 'addedAt'>>(entries: readonly T[], mode: LibrarySortMode): T[] {
  const list = entries.slice()
  if (mode === 'manual') return list
  const label = (e: T) => displayLabel(e)
  list.sort((a, b) => {
    if (mode === 'name') {
      const byName = label(a).localeCompare(label(b), 'zh-Hans', { sensitivity: 'base', numeric: true })
      if (byName !== 0) return byName
      return a.id.localeCompare(b.id)
    }
    if (mode === 'lastOpened') {
      const byTime = (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)
      if (byTime !== 0) return byTime
      return label(a).localeCompare(label(b), 'zh-Hans', { sensitivity: 'base', numeric: true })
    }
    const byAdded = (b.addedAt || 0) - (a.addedAt || 0)
    if (byAdded !== 0) return byAdded
    return label(a).localeCompare(label(b), 'zh-Hans', { sensitivity: 'base', numeric: true })
  })
  return list
}
