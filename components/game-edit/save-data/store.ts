import type { DataCell, DataPath, ValueType } from '@/lib/game/save-data'

/** Map with per-key subscriptions so a row re-renders only when its own entry changes */
export class KeyedStore<T> {
  private map = new Map<string, T>()
  private keySubs = new Map<string, Set<() => void>>()
  private allSubs = new Set<() => void>()
  private version = 0

  get = (key: string): T | undefined => this.map.get(key)

  has(key: string) {
    return this.map.has(key)
  }

  get size() {
    return this.map.size
  }

  values() {
    return [...this.map.values()]
  }

  entries() {
    return [...this.map.entries()]
  }

  set(key: string, value: T) {
    if (this.map.get(key) === value) return
    this.map.set(key, value)
    this.notify(key)
  }

  delete(key: string) {
    if (!this.map.delete(key)) return
    this.notify(key)
  }

  clear() {
    if (!this.map.size) return
    const keys = [...this.map.keys()]
    this.map.clear()
    this.version++
    for (const key of keys) this.keySubs.get(key)?.forEach((cb) => cb())
    this.allSubs.forEach((cb) => cb())
  }

  subscribeKey = (key: string, cb: () => void) => {
    let set = this.keySubs.get(key)
    if (!set) {
      set = new Set()
      this.keySubs.set(key, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (!set.size) this.keySubs.delete(key)
    }
  }

  subscribeAll = (cb: () => void) => {
    this.allSubs.add(cb)
    return () => this.allSubs.delete(cb)
  }

  getVersion = () => this.version

  private notify(key: string) {
    this.version++
    this.keySubs.get(key)?.forEach((cb) => cb())
    this.allSubs.forEach((cb) => cb())
  }
}

export type DraftState = 'pending' | 'stale' | 'error'

export type Draft = {
  path: DataPath
  /** Owner object id when the draft was made; the game rejects the write if it changed */
  ownerOid: number
  type: ValueType
  raw: string
  label?: string
  confirm?: boolean
  state: DraftState
  error?: string
}

export type ValueEntry = { cell: DataCell; changedAt: number }

/** Page-session stores (kept while switching tabs in the same window; cleared on reload) */
export const valueStore = new KeyedStore<ValueEntry>()
export const draftStore = new KeyedStore<Draft>()
/** Paths written successfully in this session (row marker) */
export const writtenStore = new KeyedStore<true>()

export function setCell(key: string, cell: DataCell, flash: boolean) {
  const prev = valueStore.get(key)
  if (prev && sameCellShallow(prev.cell, cell)) return
  valueStore.set(key, { cell, changedAt: flash && prev ? Date.now() : 0 })
}

function sameCellShallow(a: DataCell, b: DataCell) {
  return a.kind === b.kind && a.value === b.value && a.truncated === b.truncated && a.oid === b.oid && a.size === b.size && a.sig === b.sig
}

export function markStale(key: string) {
  const d = draftStore.get(key)
  if (d && d.state !== 'stale') draftStore.set(key, { ...d, state: 'stale', error: undefined })
}

export function markAllStale() {
  for (const [key] of draftStore.entries()) markStale(key)
}
