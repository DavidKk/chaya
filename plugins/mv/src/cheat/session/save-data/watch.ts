/**
 * Per-client watcher: compares only the subscribed paths once per second within a small time budget,
 * resuming from a cursor when the budget runs out.
 */
import { type DataCell, type DataDiff, type DataPath, isValidPath, pathKey, WATCH_BUDGET_MS, WATCH_INTERVAL_MS, WATCH_MAX, type WatchEntry } from '@/lib/game/save-data'

import { cellAt } from './read'
import { resolve } from './resolve'
import { checkGen, currentGen, isReady, onGenChange } from './roots'

type Tracked = WatchEntry & { key: string; fp?: string; lastOwner?: number; lastOid?: number; missing?: boolean }

export type Watcher = { set(sid: number, entries: WatchEntry[]): void; dispose(): void }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function fingerprint(cell: DataCell): string {
  return `${cell.kind}|${String(cell.value)}|${cell.truncated ? 1 : 0}|${cell.oid ?? ''}|${cell.size ?? ''}|${cell.sig ?? ''}`
}

export function createWatcher(onDiff: (diff: DataDiff) => void): Watcher {
  let sid = 0
  let list: Tracked[] = []
  let cursor = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const offGen = onGenChange(() => {
    for (const t of list) t.fp = undefined
    if (list.length) onDiff({ sid, gen: currentGen(), changes: [], replaced: [[]] })
  })

  /** Compare one entry; returns whether it changed and whether its owner / identity was replaced */
  function check(t: Tracked, changes: DataDiff['changes'], replaced: DataPath[]) {
    const r = resolve(t.path)
    if (!r.exists) {
      if (!t.missing) {
        t.missing = true
        t.fp = 'missing'
        replaced.push(t.path)
      }
      return
    }
    t.missing = false
    if (t.lastOwner !== r.ownerOid) {
      if (t.lastOwner != null || (t.ownerOid != null && t.ownerOid !== r.ownerOid)) replaced.push(t.path)
      t.lastOwner = r.ownerOid
    }
    const cell = cellAt(t.path, r.value)
    if (cell.oid != null && t.lastOid !== cell.oid) {
      if (t.lastOid != null || (t.oid != null && t.oid !== cell.oid)) replaced.push(t.path)
      t.lastOid = cell.oid
    }
    const fp = fingerprint(cell)
    if (fp === t.fp) return
    const isNew = t.fp == null
    t.fp = fp
    changes.push({ path: t.path, cell })
    if (!isNew && cell.oid != null && cell.kind !== 'cycle') {
      /* container size / keys changed: the client refetches if it is on that level */
      if (!replaced.includes(t.path)) replaced.push(t.path)
    }
  }

  function emit(changes: DataDiff['changes'], replaced: DataPath[]) {
    if (!changes.length && !replaced.length) return
    onDiff({ sid, gen: currentGen(), changes, ...(replaced.length ? { replaced } : {}) })
  }

  function tick() {
    if (disposed || !list.length) return
    checkGen()
    if (!isReady()) return
    const changes: DataDiff['changes'] = []
    const replaced: DataPath[] = []
    const start = now()
    const total = list.length
    for (let n = 0; n < total; n++) {
      if (cursor >= list.length) cursor = 0
      try {
        check(list[cursor], changes, replaced)
      } catch {
        /* a broken getter-free path should not stop the round */
      }
      cursor++
      if (now() - start > WATCH_BUDGET_MS) break
    }
    emit(changes, replaced)
  }

  function syncTimer() {
    if (list.length && !timer) timer = setInterval(tick, WATCH_INTERVAL_MS)
    if (!list.length && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    set(nextSid, entries) {
      if (disposed) return
      sid = nextSid
      const prev = new Map(list.map((t) => [t.key, t]))
      const next: Tracked[] = []
      const seen = new Set<string>()
      for (const e of Array.isArray(entries) ? entries.slice(0, WATCH_MAX) : []) {
        if (!isValidPath(e?.path) || !e.path.length) continue
        const key = pathKey(e.path)
        if (seen.has(key)) continue
        seen.add(key)
        const old = prev.get(key)
        next.push(old ? { ...old, oid: e.oid, ownerOid: e.ownerOid } : { path: e.path, oid: e.oid, ownerOid: e.ownerOid, key })
      }
      list = next
      cursor = 0
      syncTimer()
      if (!list.length) return
      checkGen()
      if (!isReady()) return
      const changes: DataDiff['changes'] = []
      const replaced: DataPath[] = []
      for (const t of list) {
        if (t.fp != null) continue
        try {
          check(t, changes, replaced)
        } catch {
          /* */
        }
      }
      emit(changes, replaced)
    },
    dispose() {
      disposed = true
      list = []
      offGen()
      syncTimer()
    },
  }
}
