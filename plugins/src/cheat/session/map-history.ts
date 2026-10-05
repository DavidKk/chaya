/**
 * Recently visited maps (newest first), recorded when a map scene starts and kept per game in localStorage.
 */
import { detectGameIdentity } from '../../helpers'
import { hookMethod } from '../../helpers/game/method-hook'
import { gameMap } from '../runtime/game-globals'

const STORAGE_PREFIX = 'chaya:recent-maps:'
const MAX_RECENT = 10

let recent: number[] | null = null
let uninstall: (() => void) | null = null

function storageKey(): string {
  const title = ((globalThis as { $dataSystem?: { gameTitle?: string } }).$dataSystem?.gameTitle || document.title).trim()
  return STORAGE_PREFIX + `${title}|${detectGameIdentity()?.gameRoot || location.pathname}`
}

function load(): number[] {
  if (recent) return recent
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey()) || '[]') as unknown
    recent = Array.isArray(raw)
      ? raw
          .map((v) => Math.floor(Number(v) || 0))
          .filter((id) => id > 0)
          .slice(0, MAX_RECENT)
      : []
  } catch {
    recent = []
  }
  return recent
}

export function recordMapVisit(mapId: number) {
  const id = Math.floor(Number(mapId) || 0)
  if (id <= 0) return
  const list = load()
  if (list[0] === id) return
  recent = [id, ...list.filter((m) => m !== id)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(storageKey(), JSON.stringify(recent))
  } catch {
    /* storage full or disabled: keep the in-memory list */
  }
}

export function recentMaps(): number[] {
  return [...load()]
}

/** Idempotent; safe to call before the game has loaded Scene_Map */
export function installMapHistory() {
  if (uninstall) return
  const SceneMap = (globalThis as { Scene_Map?: { prototype: object } }).Scene_Map
  if (!SceneMap) return
  uninstall = hookMethod(
    SceneMap.prototype,
    'start',
    (original) =>
      function (this: unknown, ...args: unknown[]) {
        const result = original.apply(this, args)
        try {
          recordMapVisit(gameMap()?.mapId?.() ?? 0)
        } catch {
          /* history must never break the scene */
        }
        return result
      }
  )
  const current = gameMap()?.mapId?.()
  if (current) recordMapVisit(current)
}

export function disposeMapHistory() {
  uninstall?.()
  uninstall = null
}
