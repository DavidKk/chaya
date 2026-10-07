import type { GameSaveEntry } from '@/lib/game/game-saves'
import { tNow } from '@/lib/i18n'

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

/** 生成当前进度的存档 JSON；不改变游戏内的存档次数 */
export function captureSave(): { json: string; meta: SaveMeta } {
  const g = rm()
  if (!g.DataManager?.makeSaveContents || !g.JsonEx || !g.$gameSystem) throw new Error(tNow('saves.error.notReadySave'))
  const saveCount = g.$gameSystem._saveCount
  g.$gameSystem.onBeforeSave?.()
  if (typeof saveCount === 'number') g.$gameSystem._saveCount = saveCount
  const json = g.JsonEx.stringify(g.DataManager.makeSaveContents())
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

/**
 * 用存档 JSON 替换当前进度并切回地图，流程同 `Scene_Load`。
 * 切换前冻结当前场景：新对象已替换，旧场景再更新一帧可能访问不匹配的地图数据。
 */
export function restoreSave(json: string): void {
  const g = rm()
  const dm = g.DataManager
  if (!dm?.createGameObjects || !dm.extractSaveContents || !g.JsonEx || !g.SceneManager?.goto || !g.Scene_Map) throw new Error(tNow('saves.error.notReadyLoad'))
  const contents = g.JsonEx.parse(json)
  if (!contents || typeof contents !== 'object') throw new Error(tNow('saves.error.invalidContent'))
  dm.createGameObjects()
  dm.extractSaveContents(contents)
  dm.correctDataErrors?.()
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
