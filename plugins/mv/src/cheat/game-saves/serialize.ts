import type { GameSaveEntry } from '@/lib/game/game-saves'
import { tNow } from '@/lib/i18n'

import { currentCompanionFacts } from '../../agent/runtime/companion-facts'
import { companionLoadOwner } from '../../agent/runtime/companion-load-context'

type RmSaveGlobals = {
  DataManager?: {
    makeSaveContents?: () => unknown
    extractSaveContents?: (contents: unknown) => void
    createGameObjects?: () => void
    correctDataErrors?: () => void
  }
  JsonEx?: { stringify: (v: unknown) => string; parse: (s: string) => unknown }
  SceneManager?: { _scene?: { update?: () => void; isBusy?: () => boolean } | null; goto?: (scene: unknown) => void; snap?: () => unknown }
  Scene_Map?: unknown
  Graphics?: { frameCount?: number }
  Utils?: { RPGMAKER_NAME?: string }
  AudioManager?: { stopMe?: () => void; stopSe?: () => void }
  $dataSystem?: { versionId?: number }
  $gameSystem?: { _saveCount?: number; onBeforeSave?: () => void; onAfterLoad?: () => void; versionId?: () => number }
  $gameMap?: { mapId?: () => number; displayName?: () => string }
  $gameParty?: { members?: () => { name?: () => string }[] }
  $gamePlayer?: {
    x?: number
    y?: number
    direction?: () => number
    reserveTransfer?: (mapId: number, x: number, y: number, d?: number, fade?: number) => void
    requestMapReload?: () => void
  }
}

const rm = () => globalThis as unknown as RmSaveGlobals

export type SaveMeta = Pick<GameSaveEntry, 'playtimeFrames' | 'mapId' | 'mapName' | 'partyNames' | 'versionId' | 'engine'>

export function currentVersionId(): number {
  return rm().$dataSystem?.versionId ?? 0
}

export function currentEngine(): 'mv' | 'mz' {
  return rm().Utils?.RPGMAKER_NAME === 'MZ' ? 'mz' : 'mv'
}

/** 生成当前进度的存档 JSON；`onBeforeSave` 写入的存档次数、保存时帧数与 BGM 等只进存档，不留在当前进度里 */
export type CaptureSaveOptions = {
  saveKind?: 'native' | 'quick' | 'auto' | 'unknown'
  saveSlot?: number | string
}

export function captureSave(_options?: CaptureSaveOptions): { json: string; meta: SaveMeta } {
  const g = rm()
  if (!g.DataManager?.makeSaveContents || !g.JsonEx || !g.$gameSystem) throw new Error(tNow('saves.error.notReadySave'))
  const system = g.$gameSystem as Record<string, unknown>
  const before = { ...system }
  let json: string
  try {
    g.$gameSystem.onBeforeSave?.()
    const contents = g.DataManager.makeSaveContents() as Record<string, unknown>
    const facts = currentCompanionFacts()
    const currentStamp = facts?.stamp()
    if (contents && typeof contents === 'object' && currentStamp) {
      contents._chayaCompanion = {
        schemaVersion: 1,
        libraryGameId: currentStamp.scope.libraryGameId,
        dataRevision: currentStamp.scope.dataRevision,
        playthroughId: currentStamp.scope.playthroughId,
        segmentId: currentStamp.scope.segmentId,
        contextEpoch: currentStamp.contextEpoch,
        savedAt: Date.now(),
      }
    }
    json = g.JsonEx.stringify(contents)
  } finally {
    for (const key of Object.keys(system)) if (!Object.prototype.hasOwnProperty.call(before, key)) delete system[key]
    Object.assign(system, before)
  }
  const meta: SaveMeta = {
    playtimeFrames: g.Graphics?.frameCount ?? 0,
    mapId: g.$gameMap?.mapId?.() ?? 0,
    mapName: String(g.$gameMap?.displayName?.() ?? ''),
    partyNames: (g.$gameParty?.members?.() ?? [])
      .slice(0, 4)
      .map((a) => String(a.name?.() ?? ''))
      .filter(Boolean),
    versionId: currentVersionId(),
    engine: currentEngine(),
  }
  return { json, meta }
}

/** 缩略图：游戏画布等比缩到宽 160px 的 JPEG data URL；取不到画面时返回 null */
export function snapThumbnail(width = 160): string | null {
  try {
    const bitmap = rm().SceneManager?.snap?.() as { _canvas?: HTMLCanvasElement; canvas?: HTMLCanvasElement } | undefined
    const source = bitmap?.canvas ?? bitmap?._canvas
    if (!source || !source.width || !source.height) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.max(1, Math.round((source.height / source.width) * width))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}

// createGameObjects / extractSaveContents 只是给这些全局重新赋值；替换失败时放回原引用即可回滚（标题画面没有可序列化的旧进度）
const GAME_OBJECTS = [
  '$gameTemp',
  '$gameSystem',
  '$gameScreen',
  '$gameTimer',
  '$gameMessage',
  '$gameSwitches',
  '$gameVariables',
  '$gameSelfSwitches',
  '$gameActors',
  '$gameParty',
  '$gameTroop',
  '$gameMap',
  '$gamePlayer',
] as const

/** 读档失败但当前进度未被替换（或已放回原对象），无需再用备份恢复 */
export class SaveRestoreRolledBackError extends Error {}

const rolledBack = (error: unknown) => new SaveRestoreRolledBackError(error instanceof Error ? error.message : String(error))

/**
 * 用存档 JSON 替换当前进度并切回地图，流程同 `Scene_Load`。
 * 切换前冻结当前场景：新对象已替换，旧场景再更新一帧可能访问不匹配的地图数据。
 */
export type RestoreSaveOrigin = {
  kind?: 'native' | 'quick' | 'auto' | 'unknown'
  slot?: number | string
  initiatorTaskId?: string
}

export function restoreSave(json: string, origin?: RestoreSaveOrigin): void {
  const g = rm()
  const dm = g.DataManager
  if (!dm?.createGameObjects || !dm.extractSaveContents || !g.JsonEx || !g.SceneManager?.goto || !g.Scene_Map) throw rolledBack(tNow('saves.error.notReadyLoad'))
  let contents: unknown
  try {
    contents = g.JsonEx.parse(json)
  } catch (error) {
    throw rolledBack(error)
  }
  if (!contents || typeof contents !== 'object' || Array.isArray(contents)) throw rolledBack(tNow('saves.error.invalidContent'))

  const saveKind = origin?.kind ?? 'unknown'
  const saveSlot = origin?.slot
  const facts = currentCompanionFacts()
  const opId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `restore-load-${crypto.randomUUID()}` : `restore-load-${Date.now()}`
  const fromStamp = facts?.stamp()
  const fromSeg = fromStamp?.scope.segmentId ?? 'unknown'
  const fromScp = fromStamp?.scope

  // Inspect _chayaCompanion metadata inside contents
  const metaObj = (contents as Record<string, unknown>)._chayaCompanion as Record<string, unknown> | undefined

  const isMetaValid = Boolean(
    metaObj &&
    metaObj.schemaVersion === 1 &&
    typeof metaObj.libraryGameId === 'string' &&
    metaObj.libraryGameId.trim().length > 0 &&
    metaObj.libraryGameId.length <= 128 &&
    typeof metaObj.playthroughId === 'string' &&
    metaObj.playthroughId.trim().length > 0 &&
    metaObj.playthroughId.length <= 128 &&
    typeof metaObj.segmentId === 'string' &&
    metaObj.segmentId.trim().length > 0 &&
    (!fromScp || metaObj.libraryGameId === fromScp.libraryGameId) &&
    (!fromScp || metaObj.dataRevision === fromScp.dataRevision)
  )

  const initiatorTaskId = origin?.initiatorTaskId ?? companionLoadOwner()

  // 1. Begin load phase: freeze and invalidate current context before replacing globals
  facts?.onLoadLifecycle({
    kind: 'load',
    operationId: opId,
    phase: 'begin',
    saveKind,
    saveSlot,
    fromSegmentId: fromSeg,
    fromScope: fromScp,
    initiatorTaskId,
    at: Date.now(),
  })

  const before = GAME_OBJECTS.map((key) => [key, (globalThis as Record<string, unknown>)[key]] as const)
  try {
    dm.createGameObjects()
    dm.extractSaveContents(contents)
    dm.correctDataErrors?.()
  } catch (error) {
    for (const [key, value] of before) (globalThis as Record<string, unknown>)[key] = value
    facts?.onLoadLifecycle({
      kind: 'load',
      operationId: opId,
      phase: 'rollback',
      saveKind,
      saveSlot,
      fromSegmentId: fromSeg,
      fromScope: fromScp,
      initiatorTaskId,
      at: Date.now(),
    })
    throw rolledBack(error)
  }

  // 2. Commit load phase: establish new segment and link load metadata
  const toSeg = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `seg-${crypto.randomUUID()}` : `seg-${Date.now()}`

  const resolvedPlaythroughId = isMetaValid && typeof metaObj?.playthroughId === 'string' ? (metaObj.playthroughId as string) : `unknown:${fromSeg}`

  const toScp = fromScp
    ? {
        ...fromScp,
        segmentId: toSeg,
        playthroughId: resolvedPlaythroughId,
      }
    : undefined

  facts?.onLoadLifecycle({
    kind: 'load',
    operationId: opId,
    phase: 'commit',
    saveKind,
    saveSlot,
    fromSegmentId: fromSeg,
    toSegmentId: toSeg,
    fromScope: fromScp,
    toScope: toScp,
    initiatorTaskId,
    origin: isMetaValid ? 'verified_metadata' : 'linked_load_context',
    at: Date.now(),
  })
  const system = g.$gameSystem
  const player = g.$gamePlayer
  if (system?.versionId && player?.reserveTransfer && system.versionId() !== currentVersionId()) {
    const mapId = g.$gameMap?.mapId?.() ?? 0
    if (mapId > 0) {
      player.reserveTransfer(mapId, player.x ?? 0, player.y ?? 0, player.direction?.() ?? 2, 0)
      player.requestMapReload?.()
    }
  }
  const scene = g.SceneManager._scene
  if (scene) {
    scene.update = () => {}
    scene.isBusy = () => false
  }
  g.AudioManager?.stopMe?.()
  g.AudioManager?.stopSe?.()
  g.SceneManager.goto(g.Scene_Map)
  system?.onAfterLoad?.()
}
