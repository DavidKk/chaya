/**
 * Companion Facts helper routines.
 * Scene detection, revision detection, and safe UUID generation.
 */

import type { FactMapInfo, FactSceneKind } from '@/lib/game-agent/companion/types'

import { call } from './companion-facts-mechanics'
import { currentAgentRuntimeIdentity } from './identity'

type Loose = Record<string, unknown>
const g = () => globalThis as unknown as Loose

export function generateUuid(prefix: string): string {
  const hex = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${hex}`
}

export function detectDataRevision(runtimeInstanceId?: string): string {
  const w = g()
  const versionId = (w.$dataSystem as Loose | undefined)?.versionId
  const engine = (w.Utils as Loose | undefined)?.RPGMAKER_NAME === 'MZ' ? 'mz' : 'mv'
  if (typeof versionId === 'number' || typeof versionId === 'string') {
    return `${versionId}:${engine}`
  }
  const resolvedRuntimeId = runtimeInstanceId || currentAgentRuntimeIdentity()?.runtimeInstanceId || 'unknown'
  return `unknown:${resolvedRuntimeId}:${engine}`
}

export function currentSceneKind(): { kind: FactSceneKind; rawName: string | null } {
  const currentScene = (g().SceneManager as Loose | undefined)?._scene
  if (!currentScene) return { kind: 'other', rawName: null }
  const rawName = currentScene.constructor?.name || String(currentScene)
  if (rawName.includes('Scene_Map')) return { kind: 'map', rawName }
  if (rawName.includes('Scene_Battle')) return { kind: 'battle', rawName }
  if (rawName.includes('Scene_Menu')) return { kind: 'menu', rawName }
  if (rawName.includes('Scene_Title')) return { kind: 'title', rawName }
  if (rawName.includes('Scene_Gameover')) return { kind: 'gameover', rawName }
  if (rawName.includes('Scene_Shop')) return { kind: 'shop', rawName }
  if (rawName.includes('Scene_Save')) return { kind: 'save', rawName }
  if (rawName.includes('Scene_Load')) return { kind: 'load', rawName }
  return { kind: 'other', rawName }
}

export function readCurrentMapInfo(): FactMapInfo {
  const w = g()
  const mapId = Number(call<number>(w.$gameMap, 'mapId') ?? 0)
  const displayName = call<string>(w.$gameMap, 'displayName') || undefined
  const width = call<number>(w.$gameMap, 'width') || undefined
  const height = call<number>(w.$gameMap, 'height') || undefined
  return { mapId, displayName, width, height }
}

export function checkGameIsPaused(): boolean {
  const w = g()
  if (typeof document !== 'undefined' && document.hidden) return true
  const scene = (w.SceneManager as Loose | undefined)?._scene
  if (scene) {
    const isActive = call<boolean>(scene, 'isActive')
    if (isActive === false) return true
  }
  return false
}
