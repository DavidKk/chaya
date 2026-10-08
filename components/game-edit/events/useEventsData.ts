'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { readApiErrorMessage } from '@/lib/api-error'
import type { CloudGame } from '@/lib/browser/cloud-prepare-game'
import {
  BrowserGameDataError,
  findBrowserLibraryGame,
  queryBrowserGamePermission,
  readBrowserCommonEvents,
  readBrowserMapDetail,
  requestBrowserGamePermission,
} from '@/lib/browser/game-data-reader'
import type { CommonEventsData, MapDetailData } from '@/lib/game/events'

const LINK_TIMEOUT_MS = 60_000

type Source = 'browser' | 'live' | 'disk'
export type EventsUnavailableKind = 'need-link' | 'permission-prompt' | 'permission-denied' | 'unreadable'
type ApiFailure = { ok: false; error?: string | { message?: string } }

async function fetchJson<T extends { ok: true }>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  const body = (await res.json()) as T | ApiFailure
  if (!res.ok || !body.ok) throw new Error(readApiErrorMessage(body, '加载失败'))
  return body
}

async function canUseDisk(signal?: AbortSignal): Promise<boolean> {
  try {
    const status = (await (await fetch('/api/status', { signal })).json()) as { canUseDisk?: boolean }
    return status.canUseDisk !== false
  } catch {
    return false
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Linked game first, then the authorized browser directory or the local service disk. */
export function useEventsData({ enabled, mapId }: { enabled: boolean; mapId: number | null }) {
  const { roomId, browserMode, connected, send, subscribeMessages } = useGameLinkContext()
  const source: Source = connected ? 'live' : browserMode ? 'browser' : 'disk'
  const sourceKey = source === 'live' ? `live:${roomId || ''}` : source === 'browser' ? `browser:${roomId || ''}` : source
  const [data, setData] = useState<CommonEventsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [unavailableKind, setUnavailableKind] = useState<EventsUnavailableKind | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [mapDetail, setMapDetail] = useState<MapDetailData | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState('')
  const loadedFor = useRef<string | null>(null)
  const sourceKeyRef = useRef(sourceKey)
  sourceKeyRef.current = sourceKey
  const mapRef = useRef(mapId)
  mapRef.current = mapId
  const generation = useRef(0)
  const eventsAbort = useRef<AbortController | null>(null)
  const mapAbort = useRef<AbortController | null>(null)
  const browserGame = useRef<CloudGame | null>(null)
  const eventsTimer = useRef<number | null>(null)
  const mapTimer = useRef<number | null>(null)

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current != null) window.clearTimeout(ref.current)
    ref.current = null
  }

  const current = useCallback((key: string, requestGeneration: number) => sourceKeyRef.current === key && generation.current === requestGeneration, [])

  useEffect(
    () =>
      subscribeMessages((msg) => {
        if (source !== 'live' || sourceKeyRef.current !== sourceKey) return
        if (msg.type === 'edit.events') {
          clearTimer(eventsTimer)
          if (msg.data.ok) {
            setData(msg.data)
            setError('')
          } else setError(msg.data.error)
          setLoading(false)
          return
        }
        if (msg.type === 'edit.map' && msg.mapId === mapRef.current) {
          clearTimer(mapTimer)
          if (msg.data.ok) {
            setMapDetail(msg.data)
            setMapError('')
          } else setMapError(msg.data.error)
          setMapLoading(false)
        }
      }),
    [source, sourceKey, subscribeMessages]
  )

  useEffect(() => {
    generation.current += 1
    eventsAbort.current?.abort()
    mapAbort.current?.abort()
    eventsAbort.current = null
    mapAbort.current = null
    browserGame.current = null
    clearTimer(eventsTimer)
    clearTimer(mapTimer)
    loadedFor.current = null
    setData(null)
    setLoading(false)
    setError('')
    setUnavailableKind(null)
    setAuthorizing(false)
    setMapDetail(null)
    setMapLoading(false)
    setMapError('')
  }, [sourceKey])

  useEffect(
    () => () => {
      generation.current += 1
      eventsAbort.current?.abort()
      mapAbort.current?.abort()
      clearTimer(eventsTimer)
      clearTimer(mapTimer)
    },
    []
  )

  const loadEvents = useCallback(
    async (force = false) => {
      const requestSource = sourceKey
      const requestGeneration = generation.current
      loadedFor.current = requestSource
      eventsAbort.current?.abort()
      const controller = new AbortController()
      eventsAbort.current = controller
      setLoading(true)
      setError('')
      setUnavailableKind(null)
      clearTimer(eventsTimer)
      if (source === 'live') {
        eventsAbort.current = null
        eventsTimer.current = window.setTimeout(() => {
          if (!current(requestSource, requestGeneration)) return
          setLoading(false)
          setError('游戏无响应')
        }, LINK_TIMEOUT_MS)
        send({ type: 'edit.events.request', ...(force ? { force: true } : {}) })
        return
      }
      try {
        if (source === 'browser') {
          if (!roomId) {
            if (current(requestSource, requestGeneration)) setUnavailableKind('need-link')
            return
          }
          const game = await findBrowserLibraryGame(roomId)
          if (!game) {
            if (current(requestSource, requestGeneration)) setUnavailableKind('need-link')
            return
          }
          browserGame.current = game
          const permission = await queryBrowserGamePermission(game)
          if (permission !== 'granted') {
            if (current(requestSource, requestGeneration)) setUnavailableKind(permission === 'denied' ? 'permission-denied' : 'permission-prompt')
            return
          }
          const next = await readBrowserCommonEvents(roomId, game, controller.signal)
          if (current(requestSource, requestGeneration)) setData(next)
          return
        }
        if (!(await canUseDisk(controller.signal))) {
          if (current(requestSource, requestGeneration)) setUnavailableKind('need-link')
          return
        }
        const next = await fetchJson<CommonEventsData>('/api/game-edit/events', controller.signal)
        if (current(requestSource, requestGeneration)) setData(next)
      } catch (loadError) {
        if (!current(requestSource, requestGeneration) || isAbort(loadError)) return
        setData(null)
        if (loadError instanceof BrowserGameDataError && (loadError.code === 'missing' || loadError.code === 'unreadable')) setUnavailableKind('unreadable')
        setError(loadError instanceof Error ? loadError.message : '加载失败')
      } finally {
        if (eventsAbort.current === controller) eventsAbort.current = null
        if (current(requestSource, requestGeneration)) setLoading(false)
      }
    },
    [current, roomId, send, source, sourceKey]
  )

  const loadMap = useCallback(
    async (id: number) => {
      const requestSource = sourceKey
      const requestGeneration = generation.current
      mapAbort.current?.abort()
      const controller = new AbortController()
      mapAbort.current = controller
      setMapLoading(true)
      setMapError('')
      clearTimer(mapTimer)
      if (source === 'live') {
        mapAbort.current = null
        mapTimer.current = window.setTimeout(() => {
          if (!current(requestSource, requestGeneration)) return
          setMapLoading(false)
          setMapError('游戏无响应')
        }, LINK_TIMEOUT_MS)
        send({ type: 'edit.map.request', mapId: id })
        return
      }
      try {
        const detail =
          source === 'browser'
            ? roomId && browserGame.current
              ? await readBrowserMapDetail(roomId, browserGame.current, id, controller.signal)
              : null
            : await fetchJson<MapDetailData>(`/api/game-edit/map?id=${id}`, controller.signal)
        if (detail && current(requestSource, requestGeneration) && mapRef.current === id) setMapDetail(detail)
      } catch (loadError) {
        if (!current(requestSource, requestGeneration) || mapRef.current !== id || isAbort(loadError)) return
        setMapError(loadError instanceof Error ? loadError.message : '加载失败')
      } finally {
        if (mapAbort.current === controller) mapAbort.current = null
        if (current(requestSource, requestGeneration) && mapRef.current === id) setMapLoading(false)
      }
    },
    [current, roomId, send, source, sourceKey]
  )

  useEffect(() => {
    if (!enabled || loadedFor.current === sourceKey) return
    void loadEvents()
  }, [enabled, sourceKey, loadEvents])

  useEffect(() => {
    if (!enabled || mapId == null || unavailableKind) return
    if (mapDetail?.mapId === mapId && mapDetail.source === source) return
    void loadMap(mapId)
  }, [enabled, mapId, source, unavailableKind, mapDetail, loadMap])

  const authorize = useCallback(async () => {
    const requestSource = sourceKey
    const requestGeneration = generation.current
    if (source !== 'browser' || !roomId) return
    setAuthorizing(true)
    setError('')
    try {
      const game = browserGame.current ?? (await findBrowserLibraryGame(roomId))
      if (!game || !current(requestSource, requestGeneration)) return
      browserGame.current = game
      const permission = await requestBrowserGamePermission(game)
      if (!current(requestSource, requestGeneration)) return
      if (permission !== 'granted') {
        setUnavailableKind(permission === 'denied' ? 'permission-denied' : 'permission-prompt')
        return
      }
      loadedFor.current = null
      await loadEvents(true)
    } catch (authorizeError) {
      if (!current(requestSource, requestGeneration) || isAbort(authorizeError)) return
      setError(authorizeError instanceof Error ? authorizeError.message : '授权失败')
    } finally {
      if (current(requestSource, requestGeneration)) setAuthorizing(false)
    }
  }, [current, loadEvents, roomId, source, sourceKey])

  const refresh = useCallback(() => {
    void loadEvents(true)
    if (mapRef.current != null) void loadMap(mapRef.current)
  }, [loadEvents, loadMap])

  const reloadMap = useCallback(() => {
    if (mapRef.current != null) void loadMap(mapRef.current)
  }, [loadMap])

  return {
    data,
    loading,
    error,
    unavailable: unavailableKind != null,
    unavailableKind,
    authorizing,
    authorize,
    refresh,
    mapDetail: mapDetail?.mapId === mapId ? mapDetail : null,
    mapLoading,
    mapError,
    reloadMap,
  }
}
