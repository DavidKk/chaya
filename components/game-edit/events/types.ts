import type { CommonEventsData, MapDetailData } from '@/lib/game/events'
import type { GameEditCmdOp } from '@/lib/runtime/game-link-protocol'

/** Player position from the live game; null when offline or not on a map */
export type PlayerSpot = { mapId: number; x: number; y: number }

/** Map / event operations sent through the same edit command channel */
export type EventsOp = Extract<GameEditCmdOp, { op: 'commonEvent' | 'selfSwitch' | 'teleport' | 'mapEvent' }>

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
  /** Overlay closes after running an event so the player sees it */
  afterRun?: () => void

  mapId: number | null
  eventId: number | null
  onSelectMap: (mapId: number | null, eventId?: number | null) => void
  mapDetail: MapDetailData | null
  mapLoading: boolean
  mapError: string
  player: PlayerSpot | null
  recentMaps: readonly number[]
}
