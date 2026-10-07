import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { EventsOp, EventsSlot, PlayerSpot } from '@/components/game-edit/events/types'
import { type TabId, usesEventsSlot } from '@/components/game-edit/tabs'
import { battleSignature, type BattleState } from '@/lib/game/battle'
import type { CommonEventsData, MapDetailData } from '@/lib/game/events'
import { readViewState, writeViewState } from '@/lib/view-state'

import { addEnemy, killEnemy, readBattleState, recoverEnemy, reviveEnemy, transformEnemy, writeEnemyHp, writeEnemyMhp } from '../session/live-battle'
import { buildLiveCommonEventsData, isOnMapScene, runCommonEventOnMap } from '../session/live-events'
import { buildLiveMapDetail, playerSpot, runMapEvent, runningCommonEvents, setSelfSwitch, teleportPlayer } from '../session/live-map'
import { joinActor, recoverActor, reviveActor, writeActorVital } from '../session/live-party'
import { startTroopBattle } from '../session/live-troop'
import { recentMaps } from '../session/map-history'

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
  const sceneRef = useRef(scene)
  const active = (open && usesEventsSlot(tab)) || (!open && tab === 'map' && view.mapId != null)
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

  /** Any open tab polls the scene so 修改 › 战斗 can flag a running battle */
  const polling = active || open
  useEffect(() => {
    if (!polling) return
    const tick = () => {
      const next = readScene()
      const previous = sceneRef.current
      if (!open && previous.player?.mapId === mapRef.current && next.player?.mapId && next.player.mapId !== previous.player.mapId) {
        setView((current) => ({ ...current, mapId: next.player!.mapId, eventId: null, eventPage: null }))
      }
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
        await applyOp(op)
        if (op.op === 'teleport' || op.op.startsWith('enemy') || op.op.startsWith('actor')) setScene((sceneRef.current = readScene()))
        if ((op.op === 'selfSwitch' || op.op === 'teleport' || op.op === 'mapEvent') && mapRef.current != null) void loadMap(mapRef.current)
      },
      onSwitchChange,
      onVarChange,
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
    [data, loading, error, scene, view, tab, selectTab, loadMap, onSwitchChange, onVarChange, onClose, mapDetail, mapLoading, mapError]
  )

  return { slot, refresh }
}
