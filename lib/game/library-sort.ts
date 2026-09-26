import type { LibraryEntry, LibrarySortMode } from '@/lib/game/types'

export type { LibrarySortMode }

const LIBRARY_SORT_MODES = new Set<string>(['name', 'lastOpened', 'addedAt'])

export function parseLibrarySortMode(raw: unknown, fallback: LibrarySortMode = 'name'): LibrarySortMode {
  return typeof raw === 'string' && LIBRARY_SORT_MODES.has(raw) ? (raw as LibrarySortMode) : fallback
}

function displayLabel(entry: Pick<LibraryEntry, 'name' | 'remark'>): string {
  const remark = String(entry.remark ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  return remark || entry.name || '未命名游戏'
}

/** 控制台列表排序（不改写配置数组顺序） */
export function sortLibraryEntries<T extends Pick<LibraryEntry, 'id' | 'name' | 'remark' | 'lastOpenedAt' | 'addedAt'>>(entries: readonly T[], mode: LibrarySortMode): T[] {
  const list = entries.slice()
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
