import type { BattleState } from '@/lib/game/battle'
import type { CommonEventsData, MapDetailData } from '@/lib/game/events'
import type { GameEditCmdOp } from '@/lib/runtime/game-link-protocol'
import type { MapOperationItem } from '@/lib/runtime/game-link-protocol'

import type { EventsUnavailableKind } from './useEventsData'

/** Player position from the live game; null when offline or not on a map */
/** `direction`: 2 down, 4 left, 6 right, 8 up; 0 when unknown */
export type PlayerSpot = { mapId: number; x: number; y: number; direction: number }

export function assertMapOperationCompleted(value: unknown): void {
  const status = (value as { status?: { state?: unknown; error?: unknown } } | null)?.status
  if (status?.state === 'completed') return
  throw new Error(typeof status?.error === 'string' && status.error ? status.error : '地图操作未完成')
}

/** Map / event operations sent through the same edit command channel */
export type EventsOp = Extract<
  GameEditCmdOp,
  {
    op:
      | 'commonEvent'
      | 'selfSwitch'
      | 'teleport'
      | 'mapEvent'
      | 'troop'
      | 'enemyTransform'
      | 'enemyAdd'
      | 'enemyKill'
      | 'enemyRevive'
      | 'enemyRecover'
      | 'enemyHp'
      | 'enemyMhp'
      | 'actorVital'
      | 'actorRevive'
      | 'actorRecover'
      | 'actorJoin'
  }
>

/**
 * Data and actions for 修改 › 公共事件 / 地图, shared by the web page and the in-game overlay.
 * Switch / variable values come from the workbench session.
 */
export type EventsSlot = {
  data: CommonEventsData | null
  loading: boolean
  error: string
  /** Neither a game link nor disk access: browsing is unavailable */
  unavailable?: boolean
  unavailableKind?: EventsUnavailableKind | null
  authorizing?: boolean
  onAuthorize?: () => void
  onRetry?: () => void
  /** Live game state is readable (switch values, running state, map state) */
  live: boolean
  /** Operations can be sent (overlay, or web page linked to the game) */
  canAct: boolean
  /** Player is on the map scene (common / map events only start there) */
  onMap: boolean
  /** Common events currently running in parallel / autorun on the map */
  runningCommon?: readonly number[]
  commonId: number | null
  onSelectCommon: (id: number | null) => void
  /** Resolves when the game acknowledges, rejects with the game's error */
  onAct: (op: EventsOp) => Promise<void>
  onSwitchChange: (id: number, value: boolean) => void
  onVarChange: (id: number, value: number) => void
  mapUndo?: { id: string; summary: string; values: unknown[] } | null
  onMapChanges?: (items: MapOperationItem[], summary: string) => Promise<unknown>
  onMapUndo?: (force?: boolean) => Promise<{ conflicts?: unknown[] }>
  /** Overlay closes after running an event so the player sees it (not after teleports) */
  afterRun?: () => void

  mapId: number | null
  eventId: number | null
  onSelectMap: (mapId: number | null, eventId?: number | null) => void
  /** Event page tab picked in the event detail (0-based); null follows the live active page */
  eventPage: number | null
  onSelectEventPage: (page: number) => void
  mapDetail: MapDetailData | null
  mapLoading: boolean
  mapError: string
  onReloadMap?: () => void
  player: PlayerSpot | null
  recentMaps: readonly number[]

  troopId: number | null
  onSelectTroop: (id: number | null) => void
  /** Enemies on the field while the game is in battle */
  battle: BattleState | null
}
