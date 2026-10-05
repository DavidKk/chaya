/** User pins, stored per game in the game's localStorage and shared by the web page and the overlay */
import { type DataPin, isValidPath, pathKey, PINS_MAX } from '@/lib/game/save-data'

import { detectGameIdentity } from '../../../helpers'
import { markStatusChanged } from './status'

const STORAGE_PREFIX = 'chaya:data-pins:'

let cache: { key: string; pins: DataPin[] } | null = null

function storageKey(): string {
  const title = ((globalThis as { $dataSystem?: { gameTitle?: string } }).$dataSystem?.gameTitle || document.title).trim()
  return STORAGE_PREFIX + `${title}|${detectGameIdentity()?.gameRoot || location.pathname}`
}

function sanitize(raw: unknown): DataPin[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DataPin[] = []
  for (const item of raw) {
    const path = (item as DataPin | null)?.path
    if (!isValidPath(path) || path.length < 2) continue
    const key = pathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    const label = (item as DataPin).label
    out.push(typeof label === 'string' && label ? { path, label: label.slice(0, 120) } : { path })
    if (out.length >= PINS_MAX) break
  }
  return out
}

export function getPins(): DataPin[] {
  const key = storageKey()
  if (cache?.key === key) return cache.pins
  let pins: DataPin[]
  try {
    pins = sanitize(JSON.parse(localStorage.getItem(key) || '[]'))
  } catch {
    pins = []
  }
  cache = { key, pins }
  return pins
}

export function setPins(pins: DataPin[]) {
  const key = storageKey()
  cache = { key, pins: sanitize(pins) }
  try {
    localStorage.setItem(key, JSON.stringify(cache.pins))
  } catch {
    /* storage full or unavailable: keep the in-memory list */
  }
  markStatusChanged()
}
