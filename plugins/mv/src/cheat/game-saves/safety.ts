import type { SaveWaitReason } from '@/lib/game/game-saves'

type Rm = {
  SceneManager?: { _scene?: unknown; _nextScene?: unknown; isSceneChanging?: () => boolean }
  Scene_Map?: new () => unknown
  Scene_Title?: new () => unknown
  $gameParty?: { inBattle?: () => boolean }
  $gameMap?: { isEventRunning?: () => boolean; mapId?: () => number }
  $gameMessage?: { isBusy?: () => boolean }
  $gamePlayer?: { isTransferring?: () => boolean; isMoving?: () => boolean; x?: number; y?: number }
}

const rm = () => globalThis as unknown as Rm

export type SaveSafety = { ok: true } | { ok: false; reason: SaveWaitReason }

/** 当前是否可保存；游戏自身禁用存档不影响，本功能就是为这类段落准备的 */
export function checkSaveSafety(): SaveSafety {
  const g = rm()
  const scene = g.SceneManager?._scene
  if (!g.Scene_Map || !(scene instanceof g.Scene_Map) || g.SceneManager?.isSceneChanging?.()) return { ok: false, reason: 'notMap' }
  if (g.$gameParty?.inBattle?.()) return { ok: false, reason: 'battle' }
  if (g.$gameMap?.isEventRunning?.()) return { ok: false, reason: 'event' }
  if (g.$gameMessage?.isBusy?.()) return { ok: false, reason: 'message' }
  if (g.$gamePlayer?.isTransferring?.()) return { ok: false, reason: 'transfer' }
  if (g.$gamePlayer?.isMoving?.()) return { ok: false, reason: 'moving' }
  if (g.SceneManager?._nextScene || (scene as { _menuCalling?: boolean })._menuCalling) return { ok: false, reason: 'menu' }
  return { ok: true }
}

/** 已进入游戏（有地图对象且不在标题画面） */
export function isInGame(): boolean {
  const g = rm()
  const scene = g.SceneManager?._scene
  if (g.Scene_Title && scene instanceof g.Scene_Title) return false
  return !!g.$gameMap && (g.$gameMap.mapId?.() ?? 0) > 0
}

/** 玩家位置指纹：用于挂机判定 */
export function playerFingerprint(): string {
  const g = rm()
  return `${g.$gameMap?.mapId?.() ?? 0}:${g.$gamePlayer?.x ?? -1}:${g.$gamePlayer?.y ?? -1}`
}
