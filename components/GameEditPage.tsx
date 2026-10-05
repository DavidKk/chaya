'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type ActorPaneId,
  editActorHref,
  editCommonHref,
  editDataHref,
  editMapHref,
  editTabHref,
  emptySession,
  GameEditWorkbench,
  isEventsTab,
  loadGameStoredHotkeys,
  loadGlobalHotkeys,
  parseActorIdSegment,
  parseActorPaneSegment,
  parseDataSegments,
  parseTabId,
  saveGameStoredHotkeys,
  saveGlobalHotkeys,
  type SessionState,
  type TabId,
} from '@/components/game-edit'
import type { EventsSlot } from '@/components/game-edit/events/types'
import { useEventsData } from '@/components/game-edit/events/useEventsData'
import { useLinkSaveDataTransport } from '@/components/game-edit/save-data/link-transport'
import type { DataRootView, SaveDataSlot } from '@/components/game-edit/save-data/transport'
import { pageMainFlush } from '@/components/layoutClasses'
import { Button, EmptyState } from '@/components/sk'
import { buildOptimisticHandlers, useGameEditLinkSync } from '@/hooks/useGameEditLinkSync'
import { readApiErrorMessage } from '@/lib/api-error'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { hrefWithQuery, parseFlag01 } from '@/lib/url/search-params'
import { useQueryPatch } from '@/lib/url/use-query-patch'

export function GameEditPage() {
  const params = useParams<{ tab?: string; pane?: string[] }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { replaceQuery } = useQueryPatch()
  const tab = parseTabId(params.tab)
  const actorId = tab === 'actor' ? parseActorIdSegment(params.pane?.[0]) : null
  const actorPane: ActorPaneId = tab === 'actor' && actorId != null ? (parseActorPaneSegment(params.pane?.[1]) ?? 'actor') : 'actor'
  const commonId = tab === 'common' ? parseActorIdSegment(params.pane?.[0]) : null
  const mapId = tab === 'map' ? parseActorIdSegment(params.pane?.[0]) : null
  const mapEventId = tab === 'map' && mapId != null ? parseActorIdSegment(params.pane?.[1]) : null
  const mapEventPage = mapEventId != null ? parseActorIdSegment(params.pane?.[2]) : null
  const events = useEventsData({ enabled: isEventsTab(tab), mapId })
  const filter = searchParams.get('q') ?? ''
  const onlyOwned = parseFlag01(searchParams.get('owned'), false)
  const onlyNamed = parseFlag01(searchParams.get('named'), true)

  /** Web「修改」不挂翻译；旧链 /cheat/trans → 顶栏翻译 */
  useEffect(() => {
    if (tab !== 'trans') return
    router.replace(hrefWithQuery('/translate/run', searchParams.toString()))
  }, [tab, router, searchParams])

  const setTab = useCallback(
    (next: TabId) => {
      router.push(hrefWithQuery(editTabHref(next), searchParams.toString()))
    },
    [router, searchParams]
  )
  const setActorId = useCallback(
    (next: number) => {
      router.push(hrefWithQuery(editActorHref(next, actorPane), searchParams.toString()))
    },
    [router, searchParams, actorPane]
  )
  const setActorPane = useCallback(
    (next: ActorPaneId) => {
      router.push(hrefWithQuery(editActorHref(actorId, next), searchParams.toString()))
    },
    [router, searchParams, actorId]
  )
  const setFilter = useCallback((next: string) => replaceQuery({ q: next || null }), [replaceQuery])
  const setOnlyOwned = useCallback((on: boolean) => replaceQuery({ owned: on ? '1' : null }), [replaceQuery])
  const setOnlyNamed = useCallback((on: boolean) => replaceQuery({ named: on ? null : '0' }), [replaceQuery])

  const [catalog, setCatalog] = useState<GameEditCatalog | null>(null)
  const [error, setError] = useState('')
  const [liveError, setLiveError] = useState('')
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<SessionState>(() => ({
    ...emptySession(),
    hotkeys: loadGameStoredHotkeys(),
    hotkeysGlobal: loadGlobalHotkeys(),
  }))

  const receiveCatalog = useCallback((next: GameEditCatalog) => {
    setCatalog(next)
    setError('')
    setLoading(false)
  }, [])
  const { linked, connected, scene, sendCmd, runCmd, requestCatalog } = useGameEditLinkSync(setSession, setLiveError, receiveCatalog)

  const handlers = useMemo(() => buildOptimisticHandlers(setSession, sendCmd, (id) => catalog?.actors.find((a) => a.id === id)?.name), [sendCmd, catalog])

  const { reloadMap } = events
  /** Map state (player position, active pages) changes after a transfer lands */
  const lastSceneMap = useRef(scene.mapId)
  useEffect(() => {
    if (lastSceneMap.current === scene.mapId) return
    lastSceneMap.current = scene.mapId
    if (tab === 'map' && mapId != null) reloadMap()
  }, [scene.mapId, tab, mapId, reloadMap])

  const eventsQuery = searchParams.toString()
  const eventsSlot: EventsSlot = {
    data: events.data,
    loading: events.loading,
    error: events.error,
    unavailable: events.unavailable,
    live: linked,
    canAct: linked,
    onMap: scene.onMap,
    runningCommon: scene.runningCommon,
    commonId,
    onSelectCommon: (id) => router.push(hrefWithQuery(editCommonHref(id), eventsQuery)),
    onAct: async (op) => {
      await runCmd(op)
      if (op.op === 'selfSwitch' || op.op === 'mapEvent') reloadMap()
    },
    onSwitchChange: handlers.setSwitch,
    onVarChange: handlers.setVar,
    mapId,
    eventId: mapEventId,
    onSelectMap: (nextMap, nextEvent) => router.push(hrefWithQuery(editMapHref(nextMap, nextEvent), eventsQuery)),
    eventPage: mapEventPage != null ? mapEventPage - 1 : null,
    onSelectEventPage: (page) => router.push(hrefWithQuery(editMapHref(mapId, mapEventId, page + 1), eventsQuery)),
    mapDetail: events.mapDetail,
    mapLoading: events.mapLoading,
    mapError: events.mapError,
    onReloadMap: reloadMap,
    player: linked && scene.mapId > 0 ? { mapId: scene.mapId, x: scene.playerX, y: scene.playerY, direction: scene.playerDir } : null,
    recentMaps: scene.recentMaps,
  }

  const paneKey = tab === 'data' ? (params.pane ?? []).join('/') : ''
  const dataPath = useMemo(() => (tab === 'data' ? (parseDataSegments(paneKey ? paneKey.split('/') : []) ?? []) : []), [tab, paneKey])
  const dataRootView: DataRootView = searchParams.get('list') === 'all' ? 'all' : 'pins'
  const saveDataTransport = useLinkSaveDataTransport(tab === 'data' && linked, runCmd)
  const onDataNavigate = useCallback(
    (next: string[], opts?: { replace?: boolean; root?: DataRootView }) => {
      const query = new URLSearchParams(searchParams.toString())
      if (!next.length && opts?.root === 'all') query.set('list', 'all')
      else query.delete('list')
      const href = hrefWithQuery(editDataHref(next), query.toString())
      if (opts?.replace) router.replace(href)
      else router.push(href)
    },
    [router, searchParams]
  )
  const saveDataSlot: SaveDataSlot = useMemo(
    () => ({ transport: saveDataTransport, path: dataPath, rootView: dataRootView, onNavigate: onDataNavigate, surface: 'page' }),
    [saveDataTransport, dataPath, dataRootView, onDataNavigate]
  )

  const refresh = useCallback(async () => {
    if (connected) {
      requestCatalog()
      return
    }
    setLoading(true)
    try {
      const statusResponse = await fetch('/api/status')
      const status = await statusResponse.json()
      if (status.canUseDisk === false) {
        setError('')
        return
      }
      const res = await fetch('/api/game-edit/catalog')
      const data = (await res.json()) as GameEditCatalog | { ok: false; error?: string | { message?: string } }
      if (!res.ok || !data.ok) {
        setCatalog(null)
        setError(readApiErrorMessage(data, '加载失败'))
        return
      }
      setError('')
      setCatalog(data)
    } catch {
      setCatalog(null)
      setError('加载失败')
    } finally {
      setLoading(false)
    }
  }, [connected, requestCatalog])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 进入角色二级后若无人物 id，自动落到第一个可见人物（三级） */
  useEffect(() => {
    if (tab !== 'actor' || !catalog?.ok || actorId != null) return
    const list = catalog.actors.filter((a) => (onlyNamed ? !!a.name : true))
    const first = list[0] ?? catalog.actors[0]
    if (!first) return
    router.replace(hrefWithQuery(editActorHref(first.id, actorPane), searchParams.toString()))
  }, [tab, catalog, actorId, actorPane, onlyNamed, router, searchParams])

  const displayError = error || liveError || (!linked ? (connected ? '等待游戏数据同步…' : '尚未连接游戏，请在游戏库点击“连接游戏”') : '')

  if (tab === 'run' && !linked) {
    return (
      <div className={pageMainFlush}>
        <EmptyState title={connected ? '等待游戏数据同步' : '等待游戏连接'} message={liveError || '收到游戏真实状态后显示运行设置，当前不会使用默认数值。'}>
          <Button className="mt-3" onClick={() => router.push('/game')}>
            返回游戏库
          </Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className={pageMainFlush}>
      <GameEditWorkbench
        tab={tab}
        setTab={setTab}
        actorPane={actorPane}
        setActorPane={setActorPane}
        actorId={actorId}
        setActorId={setActorId}
        filter={filter}
        setFilter={setFilter}
        onlyOwned={onlyOwned}
        setOnlyOwned={setOnlyOwned}
        onlyNamed={onlyNamed}
        setOnlyNamed={setOnlyNamed}
        loading={loading}
        error={displayError}
        catalog={catalog}
        session={session}
        onRefresh={() => {
          void refresh()
          if (isEventsTab(tab)) events.refresh()
        }}
        onGoldChange={handlers.setGold}
        onGoldLockChange={handlers.setGoldLock}
        onWalkRateChange={handlers.setWalkRate}
        onRunRateChange={handlers.setRunRate}
        onExpRateChange={handlers.setExpRate}
        onRunFlagChange={handlers.setRunFlag}
        onRunAction={handlers.runAction}
        onHotkeysChange={(scope, hotkeys) => {
          if (scope === 'game') {
            saveGameStoredHotkeys(hotkeys)
            setSession((prev) => ({ ...prev, hotkeys }))
            return
          }
          saveGlobalHotkeys(hotkeys)
          setSession((prev) => ({ ...prev, hotkeysGlobal: hotkeys }))
        }}
        onHotkeysReload={() => {
          setSession((prev) => ({
            ...prev,
            hotkeys: loadGameStoredHotkeys(),
            hotkeysGlobal: loadGlobalHotkeys(),
          }))
        }}
        onCountChange={handlers.setCount}
        onVarChange={handlers.setVar}
        onSwitchChange={handlers.setSwitch}
        onRowLockChange={handlers.setRowLock}
        onActorChange={handlers.setActor}
        onActorOwnedLockChange={handlers.setActorOwnedLock}
        onActorVitalLockChange={handlers.setActorVitalLock}
        surface="page"
        linked={linked}
        events={eventsSlot}
        saveData={saveDataSlot}
      />
    </div>
  )
}
