/** Data locks: path + owner identity + value, written back every 200 ms; dropped when the owner is replaced */
import { type DataLockInfo, type DataPath, isPrefix, LOCK_INTERVAL_MS, pathKey, presetLockFor, type PrimitiveValue, samePrimitive } from '@/lib/game/save-data'

import { Cheats } from '../../runtime/cheats'
import { resolve } from './resolve'
import { markStatusChanged } from './status'
import { runRefreshes, writeValue } from './writers'

type LockEntry = { path: DataPath; ownerOid: number; value: Exclude<PrimitiveValue, null>; label?: string }

const table = new Map<string, LockEntry>()
let timer: ReturnType<typeof setInterval> | null = null

export function isPathLocked(path: DataPath): boolean {
  return table.has(pathKey(path))
}

export function lockList(): DataLockInfo[] {
  return [...table.values()].map(({ path, value, label }) => ({ path, value, label }))
}

export function setDataLock(entry: LockEntry) {
  table.set(pathKey(entry.path), entry)
  ensureTimer()
  markStatusChanged()
}

export function removeDataLock(path: DataPath) {
  if (table.delete(pathKey(path))) markStatusChanged()
  stopIfEmpty()
}

export function clearDataLocks() {
  if (!table.size) return
  table.clear()
  stopIfEmpty()
  markStatusChanged()
}

/** Elements at or after `index` of the array at `path` moved: their locks (and those below them) would hit other elements */
export function dropLocksFrom(path: DataPath, index: number) {
  let dropped = false
  for (const [key, entry] of table) {
    if (entry.path.length <= path.length || !isPrefix(path, entry.path)) continue
    const i = Number(entry.path[path.length])
    if (Number.isInteger(i) && i >= index) {
      table.delete(key)
      dropped = true
    }
  }
  if (!dropped) return
  stopIfEmpty()
  markStatusChanged()
}

/** A write on a locked path moves the lock to the new value */
export function syncLockValue(path: DataPath, value: unknown) {
  const entry = table.get(pathKey(path))
  if (!entry) return
  if (value === null || value === undefined || typeof value === 'object') return removeDataLock(path)
  if (entry.value !== value) {
    entry.value = value as LockEntry['value']
    markStatusChanged()
  }
}

function ensureTimer() {
  if (timer) return
  timer = setInterval(tick, LOCK_INTERVAL_MS)
}

function stopIfEmpty() {
  if (table.size || !timer) return
  clearInterval(timer)
  timer = null
}

export function tickLocks() {
  tick()
}

function tick() {
  const refreshes: (string | null)[] = []
  let dropped = false
  for (const [key, entry] of table) {
    try {
      const r = resolve(entry.path)
      const preset = presetLockFor(entry.path)
      const presetTaken = !!preset && Cheats.isLocked(preset.kind, preset.id)
      if (presetTaken || !r.exists || r.ownerOid !== entry.ownerOid || (r.value != null && typeof r.value === 'object')) {
        table.delete(key)
        dropped = true
        continue
      }
      if (samePrimitive(r.value, entry.value)) continue
      refreshes.push(writeValue(entry.path, r.owner, r.key, entry.value).refresh)
    } catch {
      /* keep the lock; the next tick retries */
    }
  }
  runRefreshes(refreshes)
  if (dropped) {
    stopIfEmpty()
    markStatusChanged()
  }
}

export function disposeLocks() {
  table.clear()
  if (timer) clearInterval(timer)
  timer = null
}
