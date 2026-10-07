/** Web ↔ 游戏 DataChannel 消息（JSON） */

import type { ActorDraft, ActorVitalLockKind, ItemKind, RunActionId, RunFlagKey, SessionState } from '@/components/game-edit/types'
import type { ActorVitalKey, BattleState } from '@/lib/game/battle'
import type { CommonEventsData, MapDetailData, SelfSwitchLetter } from '@/lib/game/events'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import type { GameSavesErrorCode, GameSavesOp, GameSavesSnapshot, GameSavesStatus, SaveWaitReason } from '@/lib/game/game-saves'
import type { InputAssistConfig, InputChord, MacroEvent } from '@/lib/game/input-assistance'
import type {
  DataCell,
  DataDiff,
  DataErrorCode,
  DataMissingRow,
  DataOp,
  DataPage,
  DataPath,
  DataRowAt,
  DataStatus,
  SearchBatch,
  SearchScope,
  WatchEntry,
} from '@/lib/game/save-data/types'
import type { LinkChunkPacket } from '@/lib/runtime/link-chunks'
import type { TranslationPacket } from '@/lib/runtime/translation-rpc'

export type GameLinkRole = 'web' | 'game'

export type GameLinkHello = {
  type: 'hello'
  role: GameLinkRole
  gameId?: string
  name?: string
  contentRoot?: string
  gameRoot?: string
}

export type GameLinkQuit = { type: 'quit'; reason?: string }
export type GameLinkPing = { type: 'ping'; t: number }
export type GameLinkPong = { type: 'pong'; t: number }

/** Web → 游戏：订阅实时会话 */
export type GameEditSubscribe = { type: 'edit.subscribe' }
export type GameEditUnsubscribe = { type: 'edit.unsubscribe' }

/** 改值载荷（不含 type / cmdId） */
export type GameEditCmdOp =
  | { op: 'gold'; value: number }
  | { op: 'goldLock'; on: boolean; value: number }
  | { op: 'count'; kind: ItemKind; id: number; value: number }
  | { op: 'var'; id: number; value: number }
  | { op: 'sw'; id: number; value: boolean }
  | { op: 'countLock'; kind: ItemKind; id: number; on: boolean; value: number }
  | { op: 'varLock'; id: number; on: boolean; value: number }
  | { op: 'swLock'; id: number; on: boolean; value: number }
  | { op: 'runFlag'; key: RunFlagKey; value: boolean }
  | { op: 'runAction'; id: RunActionId }
  | { op: 'walkRate'; value: number }
  | { op: 'runRate'; value: number }
  /** Walk and run together */
  | { op: 'moveRate'; value: number }
  /** Whole-game update speed (scene updates per frame) */
  | { op: 'gameSpeed'; value: number }
  | { op: 'expRate'; value: number }
  | { op: 'actor'; id: number; patch: Partial<ActorDraft> }
  | { op: 'actorVitalLock'; actorId: number; kind: ActorVitalLockKind; on: boolean; value: number }
  | { op: 'actorOwnedLock'; actorId: number; kind: 'skills' | 'states'; entryId: number; on: boolean; owned: boolean }
  /** `from`: start at this command index of the list (entering the branch it sits in) */
  | { op: 'commonEvent'; id: number; from?: number }
  | { op: 'selfSwitch'; mapId: number; eventId: number; letter: SelfSwitchLetter; value: boolean }
  /** `near`: land on the first passable neighbour when the target tile is blocked */
  | { op: 'teleport'; mapId: number; x: number; y: number; direction?: 2 | 4 | 6 | 8; near?: boolean }
  /** Current map only; the game rejects it when `mapId` is not the current map. `page` (0-based) + `from` run that page's list from a command index instead of the active page */
  | { op: 'mapEvent'; mapId: number; eventId: number; page?: number; from?: number }
  /** Battle against a troop from the map scene (like Battle Processing); `count` resizes the visible members (copies / hides) */
  | { op: 'troop'; id: number; canEscape: boolean; canLose: boolean; count?: number }
  /** In battle: `fromEnemyId` guards against the field having changed since the last state push */
  | { op: 'enemyTransform'; index: number; fromEnemyId: number; enemyId: number }
  | { op: 'enemyAdd'; enemyId: number }
  | { op: 'enemyKill'; index: number; fromEnemyId: number }
  | { op: 'enemyRevive'; index: number; fromEnemyId: number }
  | { op: 'enemyRecover'; index: number; fromEnemyId: number }
  | { op: 'enemyHp'; index: number; fromEnemyId: number; hp: number }
  | { op: 'enemyMhp'; index: number; fromEnemyId: number; mhp: number }
  /** In battle, by actor id */
  | { op: 'actorVital'; actorId: number; key: ActorVitalKey; value: number }
  | { op: 'actorRevive'; actorId: number }
  | { op: 'actorRecover'; actorId: number }
  | { op: 'actorJoin'; actorId: number }
  | DataOp

/** Web → 游戏：改值指令（cmdId 用于 ack / 去重重试） */
export type GameEditCmd = { type: 'edit.cmd'; cmdId: string } & GameEditCmdOp

/** 游戏 → Web：命令已应用 */
export type GameEditAck = {
  type: 'edit.ack'
  cmdId: string
  fields: string[]
  ok: boolean
  /** Failure reason shown to the user */
  error?: string
  /** Op-specific result (data ops); replayed for duplicate cmdIds */
  result?: unknown
}

/** 游戏 → Web：会话快照（不含 hotkeys） */
export type GameEditStateMsg = {
  type: 'edit.state'
  session: Omit<SessionState, 'hotkeys' | 'hotkeysGlobal'>
  ready: boolean
  error?: string
  /** On the map scene (common events can only run on the map) */
  onMap?: boolean
  /** Current map and player tile; 0 when no map is loaded */
  mapId?: number
  playerX?: number
  playerY?: number
  /** Player facing: 2 down, 4 left, 6 right, 8 up */
  playerDir?: number
  /** Recently visited map ids, newest first */
  recentMaps?: number[]
  /** Common events running in parallel / autorun on the current map */
  runningCommon?: number[]
  /** Enemies on the field; only while the battle scene is active */
  battle?: BattleState
}

export type GameEditCatalogMessage = { type: 'edit.catalog'; catalog: GameEditCatalog } | { type: 'edit.catalog.request' }

/** Common events and call references: large, requested on demand rather than pushed; the game sends it chunked via `link.chunk` */
export type GameEditEventsMessage = { type: 'edit.events'; data: CommonEventsData | { ok: false; error: string } } | { type: 'edit.events.request'; force?: boolean }

/** One map's events with pages, requested when the map page opens it; sent chunked */
export type GameEditMapMessage = { type: 'edit.map'; mapId: number; data: MapDetailData | { ok: false; error: string } } | { type: 'edit.map.request'; mapId: number }

/** Save data reads (request / response by `reqId`); writes are `edit.cmd` data ops */
export type GameDataMessage =
  | { type: 'data.list'; reqId: string; path: DataPath; offset: number; limit: number }
  | { type: 'data.read'; reqId: string; path: DataPath }
  | { type: 'data.rows'; reqId: string; paths: DataPath[] }
  | { type: 'data.watch'; sid: number; entries: WatchEntry[] }
  | { type: 'data.search'; reqId: string; path: DataPath; query: string; scope: SearchScope }
  | { type: 'data.search.cancel'; reqId: string }
  | { type: 'data.status.request' }
  | { type: 'data.page'; reqId: string; ok: true; page: DataPage }
  | { type: 'data.page'; reqId: string; ok: false; error: string; code?: DataErrorCode; existingDepth?: number }
  | { type: 'data.value'; reqId: string; ok: boolean; cell?: DataCell; error?: string; code?: DataErrorCode }
  | { type: 'data.rows.result'; reqId: string; ok: boolean; rows?: (DataRowAt | DataMissingRow)[]; error?: string; code?: DataErrorCode }
  | ({ type: 'data.diff' } & DataDiff)
  | ({ type: 'data.search.hits'; reqId: string } & SearchBatch)
  | ({ type: 'data.status' } & DataStatus)

/** 游戏内插件日志（id 为游戏进程内自增，重启游戏会从头计） */
export type GameLinkLogEntry = { id: number; ts: number; level: string; source: string; message: string; meta?: unknown }

/** 游戏 → Web：浏览器模式日志不经服务器，连上后先补发积压再实时推送 */
export type GameLinkLogBatch = { type: 'log.batch'; entries: GameLinkLogEntry[] }

export type InputAssistMessage =
  | { type: 'assist.cmd'; reqId: string; gameId: string; op: 'snapshot' | 'stopAll' | 'recordFinish' | 'recordCancel' }
  | { type: 'assist.cmd'; reqId: string; gameId: string; op: 'configure'; globalConfig: InputAssistConfig; gameConfig: InputAssistConfig }
  | { type: 'assist.cmd'; reqId: string; gameId: string; op: 'start' | 'stop' | 'test'; ruleId: string }
  | { type: 'assist.cmd'; reqId: string; gameId: string; op: 'recordStart'; kind: 'binding' | 'macro' }
  | {
      type: 'assist.reply'
      reqId: string
      ok: boolean
      error?: string
      globalConfig?: InputAssistConfig
      gameConfig?: InputAssistConfig
      status?: { running: string[]; pending: string[]; counts: Record<string, number>; error?: string; recording: boolean }
      result?: InputChord | MacroEvent[] | null
    }
  | { type: 'assist.recorded'; result: InputChord | MacroEvent[] | null }
  | { type: 'assist.config'; globalConfig: InputAssistConfig; gameConfig: InputAssistConfig }
  | { type: 'assist.status'; status: { running: string[]; pending: string[]; counts: Record<string, number>; error?: string; recording: boolean } }

/** 游戏存档：命令由游戏侧执行；`saves.changed` 在任一端写入后推送 */
export type GameSavesMessage =
  | ({ type: 'saves.cmd'; reqId: string; gameId: string } & GameSavesOp)
  | { type: 'saves.reply'; reqId: string; ok: true; snapshot: GameSavesSnapshot; result?: string | null }
  | { type: 'saves.reply'; reqId: string; ok: false; error: string; code?: GameSavesErrorCode; reason?: SaveWaitReason }
  | { type: 'saves.status'; gameId: string; status: GameSavesStatus }
  | { type: 'saves.changed'; gameId: string; snapshot: GameSavesSnapshot }

export type GameLinkMessage =
  | TranslationPacket
  | InputAssistMessage
  | GameSavesMessage
  | GameLinkLogBatch
  | GameEditCatalogMessage
  | GameEditEventsMessage
  | GameEditMapMessage
  | GameDataMessage
  | LinkChunkPacket
  | GameLinkHello
  | GameLinkQuit
  | GameLinkPing
  | GameLinkPong
  | GameEditSubscribe
  | GameEditUnsubscribe
  | GameEditCmd
  | GameEditAck
  | GameEditStateMsg

export const GAME_LINK_CHANNEL = 'chaya'
/** 浏览器模式信令鉴权头：页面生成令牌并写入游戏 Env（`CHAYA_LINK_TOKEN`），双方请求信令时携带 */
export const GAME_LINK_TOKEN_HEADER = 'X-Chaya-Link-Token'
export const GAME_LINK_STUN = 'stun:stun.cloudflare.com:3478'

export function parseGameLinkMessage(raw: string): GameLinkMessage | null {
  try {
    const data = JSON.parse(raw) as GameLinkMessage
    if (!data || typeof data !== 'object' || !('type' in data)) return null
    return data
  } catch {
    return null
  }
}

export function encodeGameLinkMessage(msg: GameLinkMessage): string {
  return JSON.stringify(msg)
}
