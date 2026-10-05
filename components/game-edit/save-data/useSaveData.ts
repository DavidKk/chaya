'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import {
  type DataError,
  type DataMissingRow,
  type DataPage,
  type DataPath,
  type DataRow,
  type DataRowAt,
  type DataStatus,
  isPrefix,
  PAGE_SIZE,
  pathKey,
  PRESET_PINS,
  samePath,
  type SearchScope,
  WATCH_DEBOUNCE_MS,
  WATCH_MAX,
  type WatchEntry,
} from '@/lib/game/save-data'

import { draftStore, markAllStale, markStale, setCell, valueStore } from './store'
import type { SaveDataSlot } from './transport'

export type LevelMeta = Omit<DataPage, 'rows' | 'offset'>

export type LevelState = {
  key: string
  meta: LevelMeta | null
  rows: DataRow[]
  loading: boolean
  error: DataError | null
}

export type SearchState = {
  query: string
  scope: SearchScope
  hits: DataRowAt[]
  running: boolean
  truncated: boolean
  scanned: number
}

export type PinRow = DataRowAt | DataMissingRow

const NOT_READY_POLL_MS = 2000

function draftWatchSnapshot(): string {
  const out: WatchEntry[] = []
  for (const d of draftStore.values()) if (d.state !== 'stale') out.push({ path: d.path, ownerOid: d.ownerOid })
  return out.length ? JSON.stringify(out) : ''
}

const emptyLevel = (key: string): LevelState => ({ key, meta: null, rows: [], loading: true, error: null })

const childKey = (path: DataPath, key: string) => pathKey([...path, key])

/** Data page state: current level (paged), live values, pins, search and the watch subscription */
export function useSaveData(slot: SaveDataSlot, onPathGone: () => void) {
  const { transport, path, onNavigate } = slot
  const levelKey = pathKey(path)
  const [level, setLevel] = useState<LevelState>(() => emptyLevel(levelKey))
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [pinRows, setPinRows] = useState<PinRow[]>([])
  const [search, setSearch] = useState<SearchState | null>(null)
  const [visible, setVisible] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const [reloadTick, setReloadTick] = useState(0)
  const [pinsTick, setPinsTick] = useState(0)

  const pathRef = useRef(path)
  pathRef.current = path
  const sidRef = useRef(0)
  const genRef = useRef<number | null>(null)
  const loadingPages = useRef(new Set<number>())
  const searchCancel = useRef<(() => void) | null>(null)
  const pinPathsRef = useRef<DataPath[]>([])
  const onPathGoneRef = useRef(onPathGone)
  onPathGoneRef.current = onPathGone
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate

  const reloadLevel = useCallback(() => setReloadTick((n) => n + 1), [])
  const reloadPins = useCallback(() => setPinsTick((n) => n + 1), [])

  const handleGenChange = useCallback(() => {
    valueStore.clear()
    markAllStale()
    reloadLevel()
    reloadPins()
  }, [reloadLevel, reloadPins])

  /* status + diffs */
  useEffect(() => {
    if (!transport) {
      setStatus(null)
      return
    }
    const offStatus = transport.onStatus((next) => {
      setStatus(next)
      if (genRef.current != null && genRef.current !== next.gen) handleGenChange()
      genRef.current = next.gen
    })
    const offDiff = transport.onDiff((diff) => {
      if (diff.sid !== sidRef.current) return
      for (const { path: p, cell } of diff.changes) setCell(pathKey(p), cell, true)
      if (!diff.replaced?.length) return
      const current = pathRef.current
      if (diff.replaced.some((p) => p.length === 0)) {
        handleGenChange()
        return
      }
      const gone = new Set(diff.replaced.map(pathKey))
      for (const [key, draft] of draftStore.entries()) if (draft.state !== 'stale' && gone.has(key)) markStale(key)
      if (diff.replaced.some((p) => isPrefix(p, current))) reloadLevel()
      if (diff.replaced.some((p) => pinPathsRef.current.some((pin) => isPrefix(p, pin)))) reloadPins()
    })
    transport.requestStatus()
    return () => {
      offStatus()
      offDiff()
    }
  }, [transport, handleGenChange, reloadLevel, reloadPins])

  /* nothing is watched before a save is loaded, so poll the status until it is ready */
  const statusReady = !!status?.ready
  useEffect(() => {
    if (!transport || statusReady) return
    const timer = setInterval(() => transport.requestStatus(), NOT_READY_POLL_MS)
    return () => clearInterval(timer)
  }, [transport, statusReady])

  /* current level */
  const loadedRef = useRef({ key: '', count: 0 })
  loadedRef.current = { key: level.key, count: level.rows.length }

  useEffect(() => {
    const sameLevel = loadedRef.current.key === levelKey
    const pages = sameLevel ? Math.max(1, Math.ceil(loadedRef.current.count / PAGE_SIZE)) : 1
    setLevel((prev) => (prev.key === levelKey ? { ...prev, loading: true } : emptyLevel(levelKey)))
    loadingPages.current.clear()
    if (!transport) return
    let alive = true
    const target = path
    Promise.all(Array.from({ length: pages }, (_, i) => transport.list(target, i * PAGE_SIZE, PAGE_SIZE)))
      .then((list) => {
        if (!alive) return
        const first = list[0]
        const rows: DataRow[] = []
        for (const p of list) {
          if (p.oid !== first.oid) break
          rows.push(...p.rows)
        }
        for (const row of rows) setCell(childKey(target, row.key), row, false)
        for (const [key, draft] of draftStore.entries()) {
          if (draft.state === 'pending' && samePath(draft.path.slice(0, -1), target) && draft.ownerOid !== first.oid) markStale(key)
        }
        const { rows: _rows, offset: _offset, ...meta } = first
        setLevel({ key: levelKey, meta, rows, loading: false, error: null })
      })
      .catch((err: DataError) => {
        if (!alive) return
        if (err?.code === 'missing' && target.length) {
          onNavigateRef.current(target.slice(0, err.existingDepth ?? 0), { replace: true })
          onPathGoneRef.current()
          return
        }
        setLevel({ key: levelKey, meta: null, rows: [], loading: false, error: err })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `path` is identified by `levelKey`
  }, [transport, levelKey, reloadTick])

  const loadMore = useCallback(() => {
    if (!transport || !level.meta || level.key !== levelKey) return
    const offset = level.rows.length
    if (offset >= level.meta.total || loadingPages.current.has(offset)) return
    loadingPages.current.add(offset)
    const target = pathRef.current
    const key = level.key
    transport
      .list(target, offset, PAGE_SIZE)
      .then((page) => {
        for (const row of page.rows) setCell(childKey(target, row.key), row, false)
        setLevel((prev) => {
          if (prev.key !== key || prev.rows.length !== offset) return prev
          if (prev.meta && prev.meta.oid !== page.oid) return prev
          return { ...prev, rows: [...prev.rows, ...page.rows], meta: prev.meta ? { ...prev.meta, total: page.total } : prev.meta }
        })
      })
      .catch(() => {})
      .finally(() => loadingPages.current.delete(offset))
  }, [transport, level, levelKey])

  /* pins: presets + user pins, fetched as rows */
  const pinPaths = useMemo(() => {
    const seen = new Set<string>()
    const out: DataPath[] = []
    for (const p of [...PRESET_PINS, ...(status?.pins.map((pin) => pin.path) ?? [])]) {
      const key = pathKey(p)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
    return out
  }, [status?.pins])
  pinPathsRef.current = pinPaths
  const pinsKey = pinPaths.map(pathKey).join('|')
  const ready = !!status?.ready

  useEffect(() => {
    if (!transport || !ready) {
      setPinRows([])
      return
    }
    let alive = true
    transport
      .rows(pinPathsRef.current)
      .then((rows) => {
        if (!alive) return
        for (const row of rows) if (!('missing' in row)) setCell(pathKey(row.path), row, false)
        setPinRows(rows)
      })
      .catch(() => alive && setPinRows([]))
    return () => {
      alive = false
    }
  }, [transport, ready, pinsKey, pinsTick])

  /* search */
  const stopSearch = useCallback(() => {
    searchCancel.current?.()
    searchCancel.current = null
    setSearch(null)
  }, [])

  const startSearch = useCallback(
    (query: string, scope: SearchScope) => {
      searchCancel.current?.()
      searchCancel.current = null
      if (!transport || !query.trim()) {
        setSearch(null)
        return
      }
      setSearch({ query, scope, hits: [], running: true, truncated: false, scanned: 0 })
      searchCancel.current = transport.search(pathRef.current, query, scope, (batch) => {
        for (const hit of batch.hits) setCell(pathKey(hit.path), hit, false)
        setSearch((prev) =>
          prev && prev.query === query && prev.scope === scope
            ? { ...prev, hits: [...prev.hits, ...batch.hits], running: !batch.done, truncated: batch.truncated, scanned: batch.scanned }
            : prev
        )
        if (batch.done) searchCancel.current = null
      })
    },
    [transport]
  )

  useEffect(() => stopSearch, [levelKey, transport, stopSearch])

  /* drafts are watched by owner so a replaced owner marks them stale right away; the snapshot ignores keystrokes */
  const draftWatchKey = useSyncExternalStore(draftStore.subscribeAll, draftWatchSnapshot, () => '')
  const draftWatch = useMemo<WatchEntry[]>(() => (draftWatchKey ? (JSON.parse(draftWatchKey) as WatchEntry[]) : []), [draftWatchKey])

  /* watch: visible rows + current level + pins + visible search hits */
  const entries = useMemo<WatchEntry[]>(() => {
    const out: WatchEntry[] = []
    const meta = level.key === levelKey ? level.meta : null
    if (meta && path.length) out.push({ path, oid: meta.oid })
    for (const row of pinRows) if (!('missing' in row)) out.push({ path: row.path, ownerOid: row.ownerOid, oid: row.oid })
    if (search) {
      for (const hit of search.hits.slice(visible.start, visible.end)) out.push({ path: hit.path, ownerOid: hit.ownerOid, oid: hit.oid })
    } else if (meta) {
      for (const row of level.rows.slice(visible.start, visible.end)) out.push({ path: [...path, row.key], ownerOid: meta.oid, oid: row.oid })
    }
    for (const d of draftWatch) out.push(d)
    return out.slice(0, WATCH_MAX)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `path` is identified by `levelKey`
  }, [level, levelKey, pinRows, search, visible, draftWatch])

  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  useEffect(() => {
    if (!transport) return
    const timer = setTimeout(() => {
      sidRef.current += 1
      transport.watch(sidRef.current, pageVisible && ready ? entries : [])
    }, WATCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [transport, entries, pageVisible, ready])

  useEffect(() => {
    if (!transport) return
    return () => {
      sidRef.current += 1
      transport.watch(sidRef.current, [])
    }
  }, [transport])

  const onRange = useCallback((start: number, end: number) => {
    setVisible((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  return {
    level: level.key === levelKey ? level : emptyLevel(levelKey),
    status,
    ready,
    pinRows,
    search,
    loadMore,
    onRange,
    reloadLevel,
    reloadPins,
    startSearch,
    stopSearch,
  }
}

export type SaveDataState = ReturnType<typeof useSaveData>
