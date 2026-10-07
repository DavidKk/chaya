import { detectGameIdentity } from '../../helpers/game/game-identity'
import { gameRoomId } from '../../helpers/game/game-link'
import { createLogger } from '../../helpers/net/logger'
import { createAppEntryStore } from './app-store'
import { checkSaveSafety, isInGame, playerFingerprint, type SaveSafety } from './safety'
import { captureSave, currentVersionId, restoreSave, type SaveMeta, snapThumbnail } from './serialize'
import { createGameSavesBackend, type GameSaveEntryStore, type GameSavesBackend } from './store'
import { showSaveToastPending, showSaveToastResult } from './toast'

/** 控制器依赖的游戏与环境能力；测试中整体替换 */
export type GameSavesEnv = {
  backend: GameSavesBackend
  /** 「存到 Chaya 本机」的存放位置 */
  appStore: GameSaveEntryStore
  gameId: () => string
  now: () => number
  /** 游戏帧计数（`Graphics.frameCount`），用于按有效运行时间计时 */
  frames: () => number
  /** 可计时：窗口聚焦可见、已进入游戏、浮层未暂停游戏 */
  active: () => boolean
  safety: () => SaveSafety
  inGame: () => boolean
  fingerprint: () => string
  versionId: () => number
  capture: () => { json: string; meta: SaveMeta }
  restore: (json: string) => void
  thumb: () => string | null
  toast: {
    pending: (label: string) => void
    result: (kind: 'success' | 'failure', label: string) => void
  }
  /** 读档前：关闭浮层并恢复游戏循环 */
  beforeLoad: () => void
  /** 读档成功后：重套修改锁定、停止键鼠工具 */
  afterLoad: () => void
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; fail: (...args: unknown[]) => void }
  /** 订阅玩家的可信输入；返回取消函数 */
  onActivity: (handler: () => void) => () => void
}

export type GameSavesHostHooks = {
  overlayOpen: () => boolean
  beforeLoad: () => void
  afterLoad: () => void
}

let appStoreId: string | null = null

/** 本机存档目录与浏览器 IndexedDB 库名用稳定标识：库内游戏用库 id，否则用游戏目录或页面地址（启动令牌每次启动都会变） */
function appStoreGameId(): string {
  if (appStoreId) return appStoreId
  const libraryId = String((window as Window & { CHAYA_GAME_ID?: string }).CHAYA_GAME_ID || '').trim()
  const identity = libraryId ? null : detectGameIdentity()
  appStoreId = libraryId || (identity ? `path:${identity.gameRoot}` : `url:${location.origin}${location.pathname}`)
  return appStoreId
}

export function createDefaultGameSavesEnv(hooks: GameSavesHostHooks): GameSavesEnv {
  return {
    backend: createGameSavesBackend(appStoreGameId()),
    appStore: createAppEntryStore(appStoreGameId),
    gameId: gameRoomId,
    now: () => Date.now(),
    frames: () => (globalThis as { Graphics?: { frameCount?: number } }).Graphics?.frameCount ?? 0,
    active: () => !document.hidden && document.hasFocus() && isInGame() && !hooks.overlayOpen(),
    safety: checkSaveSafety,
    inGame: isInGame,
    fingerprint: playerFingerprint,
    versionId: currentVersionId,
    capture: captureSave,
    restore: restoreSave,
    thumb: () => snapThumbnail(),
    toast: { pending: showSaveToastPending, result: showSaveToastResult },
    beforeLoad: hooks.beforeLoad,
    afterLoad: hooks.afterLoad,
    log: createLogger('game-saves'),
    onActivity(handler) {
      const listener = (event: Event) => {
        if (event.isTrusted) handler()
      }
      const types = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const
      for (const type of types) document.addEventListener(type, listener, { capture: true, passive: true })
      return () => {
        for (const type of types) document.removeEventListener(type, listener, { capture: true })
      }
    },
  }
}
