/**
 * Root objects of the save, readiness, and the generation counter (bumped when any root is replaced or the game
 * leaves the playable state).
 */
import { DATA_ROOTS, type DataRootKey } from '@/lib/game/save-data'

const g = globalThis as Record<string, unknown>

export function rootObject(key: DataRootKey): object | null {
  const global = DATA_ROOTS.find(([k]) => k === key)?.[1]
  const value = global ? g[global] : null
  return value != null && (typeof value === 'object' || typeof value === 'function') ? (value as object) : null
}

/** `ConfigManager` fields are accessors; the data list is the key set of `makeData()` */
export function configKeys(): string[] {
  const cm = g.ConfigManager as { makeData?: () => Record<string, unknown> } | undefined
  try {
    const data = cm?.makeData?.()
    return data && typeof data === 'object' ? Object.keys(data) : []
  } catch {
    return []
  }
}

function sceneName(): string {
  const scene = (g.SceneManager as { _scene?: { constructor?: { name?: string } } } | undefined)?._scene
  return scene?.constructor?.name ?? ''
}

function isSceneOf(globalName: string): boolean {
  const scene = (g.SceneManager as { _scene?: unknown } | undefined)?._scene
  const ctor = g[globalName]
  return !!scene && typeof ctor === 'function' && scene instanceof (ctor as new () => unknown)
}

export function isReady(): boolean {
  if (isSceneOf('Scene_Boot') || isSceneOf('Scene_Title')) return false
  if (sceneName() === 'Scene_Boot' || sceneName() === 'Scene_Title') return false
  const map = g.$gameMap as { mapId?: () => number } | undefined
  if (!g.$gameParty || !map) return false
  try {
    return Number(map.mapId?.()) > 0
  } catch {
    return false
  }
}

let gen = 1
let lastReady = false
let lastRoots: unknown[] = []
const listeners = new Set<() => void>()

export function currentGen(): number {
  return gen
}

export function onGenChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Compare the root references and readiness with the last check; returns true when the generation moved */
export function checkGen(): boolean {
  const ready = isReady()
  const roots = DATA_ROOTS.map(([, name]) => g[name])
  const changed = ready !== lastReady || (ready && roots.some((r, i) => r !== lastRoots[i]))
  lastRoots = roots
  lastReady = ready
  if (!changed) return false
  gen++
  for (const cb of [...listeners]) {
    try {
      cb()
    } catch {
      /* a listener must not block the others */
    }
  }
  return true
}
