/** Web ↔ 游戏 DataChannel 消息（JSON） */

import type { ActorDraft, ActorVitalLockKind, ItemKind, RunActionId, RunFlagKey, SessionState } from '@/components/game-edit/types'
import type { CommonEventsData, MapDetailData, SelfSwitchLetter } from '@/lib/game/events'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
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
  | { op: 'expRate'; value: number }
  | { op: 'actor'; id: number; patch: Partial<ActorDraft> }
  | { op: 'actorVitalLock'; actorId: number; kind: ActorVitalLockKind; on: boolean; value: number }
  | { op: 'actorOwnedLock'; actorId: number; kind: 'skills' | 'states'; entryId: number; on: boolean; owned: boolean }
  | { op: 'commonEvent'; id: number }
  | { op: 'selfSwitch'; mapId: number; eventId: number; letter: SelfSwitchLetter; value: boolean }
  /** `near`: land on the first passable neighbour when the target tile is blocked */
  | { op: 'teleport'; mapId: number; x: number; y: number; direction?: 2 | 4 | 6 | 8; near?: boolean }
  /** Current map only; the game rejects it when `mapId` is not the current map */
  | { op: 'mapEvent'; mapId: number; eventId: number }
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
  /** Recently visited map ids, newest first */
  recentMaps?: number[]
  /** Common events running in parallel / autorun on the current map */
  runningCommon?: number[]
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

export type GameLinkMessage =
  | TranslationPacket
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
