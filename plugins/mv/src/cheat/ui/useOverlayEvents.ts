import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { assertMapOperationCompleted, type EventsOp, type EventsSlot, type PlayerSpot } from '@/components/game-edit/events/types'
import { type TabId, usesEventsSlot } from '@/components/game-edit/tabs'
import { battleSignature, type BattleState } from '@/lib/game/battle'
import type { CommonEventsData, MapDetailData } from '@/lib/game/events'
import { readViewState, writeViewState } from '@/lib/view-state'

import { gameRoomId } from '../../helpers'
import { addEnemy, killEnemy, readBattleState, recoverEnemy, reviveEnemy, transformEnemy, writeEnemyHp, writeEnemyMhp } from '../session/live-battle'
import { buildLiveCommonEventsData, isOnMapScene, runCommonEventOnMap } from '../session/live-events'
import { buildLiveMapDetail, playerSpot, runMapEvent, runningCommonEvents, setSelfSwitch, teleportPlayer } from '../session/live-map'
import { joinActor, recoverActor, reviveActor, writeActorVital } from '../session/live-party'
import { startTroopBattle } from '../session/live-troop'
import { recentMaps } from '../session/map-history'
import { latestMapUndo, runLocalMapChanges, undoLocalMapChange } from '../session/map-operations/runtime'

type EventsView = { commonId: number | null; mapId: number | null; eventId: number | null; eventPage: number | null; troopId: number | null }

function viewHost() {
  return window as Window & { __chayaEventsView?: EventsView }
}

const optionalId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

/** Kept on window across overlay remounts and in sessionStorage across page refreshes */
function initialEventsView(): EventsView {
  const saved = (viewHost().__chayaEventsView ?? readViewState('events')) as Partial<EventsView> | undefined
  const mapId = optionalId(saved?.mapId)
  const eventId = mapId == null ? null : optionalId(saved?.eventId)
  const page = saved?.eventPage
  const eventPage = eventId != null && typeof page === 'number' && Number.isInteger(page) && page >= 0 ? page : null
  return { commonId: optionalId(saved?.commonId), mapId, eventId, eventPage, troopId: optionalId(saved?.troopId) }
}

type Scene = { onMap: boolean; player: PlayerSpot | null; recent: number[]; running: number[]; battle: BattleState | null }

function readScene(): Scene {
  const onMap = isOnMapScene()
  const spot = playerSpot()
  return { onMap, player: spot.mapId > 0 ? spot : null, recent: recentMaps(), running: runningCommonEvents(), battle: readBattleState() }
}

function sameScene(a: Scene, b: Scene) {
  return (
    a.onMap === b.onMap &&
    a.player?.mapId === b.player?.mapId &&
    a.player?.x === b.player?.x &&
    a.player?.y === b.player?.y &&
    a.player?.direction === b.player?.direction &&
    a.recent.join() === b.recent.join() &&
    a.running.join() === b.running.join() &&
    battleSignature(a.battle) === battleSignature(b.battle)
  )
}

async function completedMapOperation<T>(operation: Promise<T>): Promise<void> {
  assertMapOperationCompleted(await operation)
}

function applyOp(op: EventsOp) {
  switch (op.op) {
    case 'commonEvent':
      return runCommonEventOnMap(op.id, op.from)
    case 'selfSwitch':
      return setSelfSwitch(op.mapId, op.eventId, op.letter, op.value)
    case 'teleport':
      return teleportPlayer(op)
    case 'mapEvent':
      return runMapEvent(op)
    case 'troop':
      return startTroopBattle(op)
    case 'enemyTransform':
      return transformEnemy(op)
    case 'enemyAdd':
      return addEnemy(op)
    case 'enemyKill':
      return killEnemy(op)
    case 'enemyRevive':
      return reviveEnemy(op)
    case 'enemyRecover':
      return recoverEnemy(op)
    case 'enemyHp':
      return writeEnemyHp(op)
    case 'enemyMhp':
      return writeEnemyMhp(op)
    case 'actorVital':
      return writeActorVital(op)
    case 'actorRevive':
      return reviveActor(op)
    case 'actorRecover':
      return recoverActor(op)
    case 'actorJoin':
      return joinActor(op)
  }
}

type Options = {
  open: boolean
  tab: TabId
  selectTab: (tab: TabId) => void
  onClose: () => void
  onSwitchChange: (id: number, value: boolean) => void
  onVarChange: (id: number, value: number) => void
}

/** In-game 公共事件 / 地图: data built in-process, operations applied directly */
export function useOverlayEvents({ open, tab, selectTab, onClose, onSwitchChange, onVarChange }: Options) {
  const [view, setView] = useState<EventsView>(initialEventsView)
  const [data, setData] = useState<CommonEventsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mapDetail, setMapDetail] = useState<MapDetailData | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState('')
  const [scene, setScene] = useState<Scene>(() => ({ onMap: false, player: null, recent: [], running: [], battle: null }))
  const [mapUndo, setMapUndo] = useState(() => latestMapUndo())
  const sceneRef = useRef(scene)
  const active = open && usesEventsSlot(tab)
  const mapRef = useRef(view.mapId)
  mapRef.current = view.mapId

  useEffect(() => {
    viewHost().__chayaEventsView = view
    writeViewState('events', view)
  }, [view])

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError('')
    try {
      setData(await buildLiveCommonEventsData({ force }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMap = useCallback(async (mapId: number) => {
    setMapLoading(true)
    setMapError('')
    try {
      const detail = await buildLiveMapDetail(mapId)
      if (mapRef.current === mapId) setMapDetail(detail)
    } catch (err) {
      if (mapRef.current === mapId) setMapError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mapRef.current === mapId) setMapLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active && !data && !loading && !error) void load()
  }, [active, data, loading, error, load])

  useEffect(() => {
    if (!active || tab !== 'map' || view.mapId == null || mapDetail?.mapId === view.mapId) return
    void loadMap(view.mapId)
  }, [active, tab, view.mapId, mapDetail, loadMap])

  /** 只有事件 / 战斗页开着才跟场景。其它页和关掉的浮层不轮询。 */
  const polling = open && usesEventsSlot(tab)
  useEffect(() => {
    if (!polling) return
    const tick = () => {
      const next = readScene()
      const previous = sceneRef.current
      if (!sameScene(previous, next)) {
        sceneRef.current = next
        setScene(next)
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [polling, open])

  const refresh = useCallback(() => {
    void load(true)
    if (mapRef.current != null) void loadMap(mapRef.current)
  }, [load, loadMap])

  const slot = useMemo(
    (): EventsSlot => ({
      data,
      loading,
      error,
      live: true,
      canAct: true,
      onMap: scene.onMap,
      runningCommon: scene.running,
      commonId: view.commonId,
      onSelectCommon: (id) => {
        setView((v) => ({ ...v, commonId: id }))
        if (tab !== 'common') selectTab('common')
      },
      onAct: async (op) => {
        if (op.op === 'commonEvent') {
          await completedMapOperation(
            runLocalMapChanges({
              requestId: crypto.randomUUID(),
              gameId: gameRoomId(),
              summary: `执行公共事件 #${op.id}`,
              items: [{ label: `公共事件 #${op.id}`, action: { kind: 'commonEvent', id: op.id, from: op.from } }],
            })
          )
        } else if (op.op === 'mapEvent') {
          await completedMapOperation(
            runLocalMapChanges({
              requestId: crypto.randomUUID(),
              gameId: gameRoomId(),
              summary: `执行地图事件 #${op.eventId}`,
              items: [{ label: `地图事件 #${op.eventId}`, action: { kind: 'mapEvent', mapId: op.mapId, eventId: op.eventId, page: op.page, from: op.from } }],
            })
          )
        } else if (op.op === 'selfSwitch') {
          await completedMapOperation(
            runLocalMapChanges({
              requestId: crypto.randomUUID(),
              gameId: gameRoomId(),
              summary: `独立开关 ${op.letter}`,
              items: [{ label: `#${op.eventId}`, changes: [{ kind: 'selfSwitch', mapId: op.mapId, eventId: op.eventId, letter: op.letter, value: op.value }] }],
            })
          )
          setMapUndo(latestMapUndo())
        } else if (op.op === 'teleport') {
          await completedMapOperation(
            runLocalMapChanges({
              requestId: crypto.randomUUID(),
              gameId: gameRoomId(),
              summary: `传送到 ${op.mapId}:${op.x},${op.y}`,
              items: [{ label: `${op.mapId}:${op.x},${op.y}`, changes: [{ kind: 'position', mapId: op.mapId, x: op.x, y: op.y, direction: op.direction ?? 2, near: op.near }] }],
            })
          )
          setMapUndo(latestMapUndo())
        } else await applyOp(op)
        if (op.op === 'teleport' || op.op.startsWith('enemy') || op.op.startsWith('actor')) setScene((sceneRef.current = readScene()))
        if ((op.op === 'selfSwitch' || op.op === 'teleport' || op.op === 'mapEvent') && mapRef.current != null) void loadMap(mapRef.current)
      },
      onSwitchChange: (id, value) => {
        void runLocalMapChanges({
          requestId: crypto.randomUUID(),
          gameId: gameRoomId(),
          summary: `开关 #${id}`,
          items: [{ label: `开关 #${id}`, changes: [{ kind: 'switch', id, value }] }],
        }).then(() => {
          onSwitchChange(id, value)
          setMapUndo(latestMapUndo())
        })
      },
      onVarChange: (id, value) => {
        void runLocalMapChanges({
          requestId: crypto.randomUUID(),
          gameId: gameRoomId(),
          summary: `变量 #${id}`,
          items: [{ label: `变量 #${id}`, changes: [{ kind: 'variable', id, value }] }],
        }).then(() => {
          onVarChange(id, value)
          setMapUndo(latestMapUndo())
        })
      },
      mapUndo,
      onMapChanges: async (items, summary) => {
        const result = await runLocalMapChanges({ requestId: crypto.randomUUID(), gameId: gameRoomId(), summary, items })
        setMapUndo(latestMapUndo())
        return result
      },
      onMapUndo: async (force) => {
        const result = await undoLocalMapChange({ requestId: crypto.randomUUID(), gameId: gameRoomId(), stepId: mapUndo?.id, force })
        setMapUndo(latestMapUndo())
        return result
      },
      afterRun: onClose,
      mapId: view.mapId,
      eventId: view.eventId,
      onSelectMap: (mapId, eventId) => {
        setView((v) => ({ ...v, mapId, eventId: eventId ?? null, eventPage: null }))
        if (tab !== 'map') selectTab('map')
      },
      eventPage: view.eventPage,
      onSelectEventPage: (eventPage) => setView((v) => ({ ...v, eventPage })),
      mapDetail: mapDetail?.mapId === view.mapId ? mapDetail : null,
      mapLoading,
      mapError,
      onReloadMap: () => {
        if (mapRef.current != null) void loadMap(mapRef.current)
      },
      player: scene.player,
      recentMaps: scene.recent,
      battle: scene.battle,
      troopId: view.troopId,
      onSelectTroop: (troopId) => {
        setView((v) => ({ ...v, troopId }))
        if (tab !== 'troop') selectTab('troop')
      },
    }),
    [data, loading, error, scene, view, tab, selectTab, loadMap, onSwitchChange, onVarChange, onClose, mapDetail, mapLoading, mapError, mapUndo]
  )

  return { slot, refresh }
}
