/** Sliced iterative DFS from one level; hits stream out per slice and the search can be cancelled */
import { annotate, type DataPath, type DataRowAt, PATH_DEPTH_MAX, SEARCH_HIT_MAX, SEARCH_NODE_MAX, SEARCH_SLICE_MS, type SearchBatch, type SearchScope } from '@/lib/game/save-data'

import { liveNames } from './names'
import { ensureReady, rowAt } from './read'
import { childKeys, childValue, isTraversable, resolveContainer } from './resolve'

type Frame = { path: DataPath; obj: object; keys: string[]; i: number }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function matcher(query: string, scope: SearchScope) {
  const q = query.trim().toLowerCase()
  const n = q && Number.isFinite(Number(q)) ? Number(q) : null
  const bool = q === 'true' ? true : q === 'false' ? false : null
  const byName = (key: string, label: string | undefined) => key.toLowerCase().includes(q) || (!!label && label.toLowerCase().includes(q))
  const byValue = (value: unknown) => {
    if (typeof value === 'string') return value.toLowerCase().includes(q)
    if (typeof value === 'number') return n != null && value === n
    if (typeof value === 'boolean') return bool != null && value === bool
    return false
  }
  return (key: string, label: string | undefined, value: unknown) =>
    scope === 'name' ? byName(key, label) : scope === 'value' ? byValue(value) : byName(key, label) || byValue(value)
}

/** Starts a search; returns a cancel function. `onBatch` receives every slice and a final `done` batch */
export function startSearch(path: DataPath, query: string, scope: SearchScope, onBatch: (batch: SearchBatch) => void): () => void {
  ensureReady()
  const root = resolveContainer(path)
  if (!root.ok || !query.trim()) {
    onBatch({ hits: [], done: true, truncated: false, scanned: 0 })
    return () => {}
  }
  const match = matcher(query, scope)
  const seen = new WeakSet<object>([root.obj])
  const stack: Frame[] = [{ path, obj: root.obj, keys: childKeys(path, root.obj), i: 0 }]
  let scanned = 0
  let hitCount = 0
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const slice = () => {
    timer = null
    if (cancelled) return
    const hits: DataRowAt[] = []
    const start = now()
    let truncated = false
    try {
      while (stack.length) {
        if (scanned >= SEARCH_NODE_MAX || hitCount >= SEARCH_HIT_MAX) {
          truncated = true
          break
        }
        const frame = stack[stack.length - 1]
        if (frame.i >= frame.keys.length) {
          stack.pop()
          continue
        }
        const key = frame.keys[frame.i++]
        scanned++
        const value = childValue(frame.path, frame.obj, key)
        const childPath = [...frame.path, key]
        const label = annotate(frame.path, key, value, liveNames).label
        if (match(key, label, value)) {
          const row = rowAt(childPath)
          if (!('missing' in row)) {
            hits.push(row)
            hitCount++
          }
        }
        const isConfigRoot = childPath.length === 1 && key === 'config'
        if (!isConfigRoot && isTraversable(value) && !seen.has(value) && childPath.length < PATH_DEPTH_MAX) {
          seen.add(value)
          stack.push({ path: childPath, obj: value, keys: childKeys(childPath, value), i: 0 })
        } else if (isConfigRoot) {
          const c = resolveContainer(childPath)
          if (c.ok) stack.push({ path: childPath, obj: c.obj, keys: childKeys(childPath, c.obj), i: 0 })
        }
        if (now() - start > SEARCH_SLICE_MS) break
      }
    } catch {
      truncated = true
      stack.length = 0
    }
    const done = truncated || !stack.length
    onBatch({ hits, done, truncated, scanned })
    if (!done) timer = setTimeout(slice, 0)
  }

  timer = setTimeout(slice, 0)
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
}
