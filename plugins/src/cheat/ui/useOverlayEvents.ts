import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { EventsOp, EventsSlot, PlayerSpot } from '@/components/game-edit/events/types'
import { isEventsTab, type TabId } from '@/components/game-edit/tabs'
import type { CommonEventsData, MapDetailData } from '@/lib/game/events'

import { buildLiveCommonEventsData, isOnMapScene, runCommonEventOnMap } from '../session/live-events'
import { buildLiveMapDetail, playerSpot, runMapEvent, runningCommonEvents, setSelfSwitch, teleportPlayer } from '../session/live-map'
import { recentMaps } from '../session/map-history'

type EventsView = { commonId: number | null; mapId: number | null; eventId: number | null }

function viewHost() {
  return window as Window & { __chayaEventsView?: EventsView }
}

type Scene = { onMap: boolean; player: PlayerSpot | null; recent: number[]; running: number[] }

function readScene(): Scene {
  const onMap = isOnMapScene()
  const spot = playerSpot()
  return { onMap, player: spot.mapId > 0 ? spot : null, recent: recentMaps(), running: runningCommonEvents() }
}

function sameScene(a: Scene, b: Scene) {
  return (
    a.onMap === b.onMap &&
    a.player?.mapId === b.player?.mapId &&
    a.player?.x === b.player?.x &&
    a.player?.y === b.player?.y &&
    a.recent.join() === b.recent.join() &&
    a.running.join() === b.running.join()
  )
}

function applyOp(op: EventsOp) {
  switch (op.op) {
    case 'commonEvent':
      return runCommonEventOnMap(op.id)
    case 'selfSwitch':
      return setSelfSwitch(op.mapId, op.eventId, op.letter, op.value)
    case 'teleport':
      return teleportPlayer(op.mapId, op.x, op.y, op.direction, op.near)
    case 'mapEvent':
      return runMapEvent(op.mapId, op.eventId)
  }
}

type Options = {
  open: boolean
  tab: TabId
  selectTab: (tab: TabId) => void
  onClose: () => void
  onSwitchChange: (id: number, value: boolean) => void
}

/** In-game 公共事件 / 地图: data built in-process, operations applied directly */
export function useOverlayEvents({ open, tab, selectTab, onClose, onSwitchChange }: Options) {
  const [view, setView] = useState<EventsView>(() => viewHost().__chayaEventsView ?? { commonId: null, mapId: null, eventId: null })
  const [data, setData] = useState<CommonEventsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mapDetail, setMapDetail] = useState<MapDetailData | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState('')
  const [scene, setScene] = useState<Scene>(() => ({ onMap: false, player: null, recent: [], running: [] }))
  const active = open && isEventsTab(tab)
  const mapRef = useRef(view.mapId)
  mapRef.current = view.mapId

  useEffect(() => {
    viewHost().__chayaEventsView = view
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

  useEffect(() => {
    if (!active) return
    const tick = () => {
      const next = readScene()
      setScene((prev) => (sameScene(prev, next) ? prev : next))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [active])

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
        applyOp(op)
        if ((op.op === 'selfSwitch' || op.op === 'mapEvent') && mapRef.current != null) void loadMap(mapRef.current)
      },
      onSwitchChange,
      afterRun: onClose,
      mapId: view.mapId,
      eventId: view.eventId,
      onSelectMap: (mapId, eventId) => {
        setView((v) => ({ ...v, mapId, eventId: eventId ?? null }))
        if (tab !== 'map') selectTab('map')
      },
      mapDetail: mapDetail?.mapId === view.mapId ? mapDetail : null,
      mapLoading,
      mapError,
      player: scene.player,
      recentMaps: scene.recent,
    }),
    [data, loading, error, scene, view, tab, selectTab, loadMap, onSwitchChange, onClose, mapDetail, mapLoading, mapError]
  )

  return { slot, refresh }
}
