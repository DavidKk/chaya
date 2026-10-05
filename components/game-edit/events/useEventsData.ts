'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useGameLinkContext } from '@/components/GameLinkProvider'
import { readApiErrorMessage } from '@/lib/api-error'
import type { CommonEventsData, MapDetailData } from '@/lib/game/events'

const LINK_TIMEOUT_MS = 60_000

type Source = 'live' | 'disk'

type ApiFailure = { ok: false; error?: string | { message?: string } }

async function fetchJson<T extends { ok: true }>(url: string): Promise<T> {
  const res = await fetch(url)
  const body = (await res.json()) as T | ApiFailure
  if (!res.ok || !body.ok) throw new Error(readApiErrorMessage(body, '加载失败'))
  return body
}

async function canUseDisk(): Promise<boolean> {
  try {
    const status = (await (await fetch('/api/status')).json()) as { canUseDisk?: boolean }
    return status.canUseDisk !== false
  } catch {
    return false
  }
}

/**
 * Web console data for 公共事件 / 地图: the linked game first (live state), otherwise the bound game's files.
 * Loads only while `enabled`; the map detail follows `mapId`.
 */
export function useEventsData({ enabled, mapId }: { enabled: boolean; mapId: number | null }) {
  const { roomId, connected, send, subscribeMessages } = useGameLinkContext()
  const source: Source = connected ? 'live' : 'disk'
  const sourceKey = source === 'live' ? `live:${roomId || ''}` : source
  const [data, setData] = useState<CommonEventsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [mapDetail, setMapDetail] = useState<MapDetailData | null>(null)
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState('')
  const loadedFor = useRef<string | null>(null)
  const sourceKeyRef = useRef(sourceKey)
  sourceKeyRef.current = sourceKey
  const mapRef = useRef(mapId)
  mapRef.current = mapId
  const eventsTimer = useRef<number | null>(null)
  const mapTimer = useRef<number | null>(null)

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current != null) window.clearTimeout(ref.current)
    ref.current = null
  }

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
    clearTimer(eventsTimer)
    clearTimer(mapTimer)
    loadedFor.current = null
    setData(null)
    setError('')
    setUnavailable(false)
    setMapDetail(null)
    setMapError('')
  }, [sourceKey])

  useEffect(
    () => () => {
      clearTimer(eventsTimer)
      clearTimer(mapTimer)
    },
    []
  )

  const loadEvents = useCallback(
    async (force = false) => {
      const requestSource = sourceKey
      loadedFor.current = requestSource
      setLoading(true)
      setError('')
      setUnavailable(false)
      clearTimer(eventsTimer)
      if (source === 'live') {
        eventsTimer.current = window.setTimeout(() => {
          if (sourceKeyRef.current !== requestSource) return
          setLoading(false)
          setError('游戏无响应')
        }, LINK_TIMEOUT_MS)
        send({ type: 'edit.events.request', ...(force ? { force: true } : {}) })
        return
      }
      try {
        if (!(await canUseDisk())) {
          if (sourceKeyRef.current !== requestSource) return
          setData(null)
          setUnavailable(true)
          return
        }
        const next = await fetchJson<CommonEventsData>('/api/game-edit/events')
        if (sourceKeyRef.current === requestSource) setData(next)
      } catch (err) {
        if (sourceKeyRef.current !== requestSource) return
        setData(null)
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (sourceKeyRef.current === requestSource) setLoading(false)
      }
    },
    [send, source, sourceKey]
  )

  const loadMap = useCallback(
    async (id: number) => {
      const requestSource = sourceKey
      setMapLoading(true)
      setMapError('')
      clearTimer(mapTimer)
      if (source === 'live') {
        mapTimer.current = window.setTimeout(() => {
          if (sourceKeyRef.current !== requestSource) return
          setMapLoading(false)
          setMapError('游戏无响应')
        }, LINK_TIMEOUT_MS)
        send({ type: 'edit.map.request', mapId: id })
        return
      }
      try {
        const detail = await fetchJson<MapDetailData>(`/api/game-edit/map?id=${id}`)
        if (sourceKeyRef.current === requestSource && mapRef.current === id) setMapDetail(detail)
      } catch (err) {
        if (sourceKeyRef.current === requestSource && mapRef.current === id) setMapError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (sourceKeyRef.current === requestSource && mapRef.current === id) setMapLoading(false)
      }
    },
    [send, source, sourceKey]
  )

  useEffect(() => {
    if (!enabled || loadedFor.current === sourceKey) return
    void loadEvents()
  }, [enabled, sourceKey, loadEvents])

  useEffect(() => {
    if (!enabled || mapId == null) return
    if (mapDetail?.mapId === mapId && mapDetail.source === source) return
    void loadMap(mapId)
  }, [enabled, mapId, source, mapDetail, loadMap])

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
    unavailable,
    mapDetail: mapDetail?.mapId === mapId ? mapDetail : null,
    mapLoading,
    mapError,
    refresh,
    reloadMap,
  }
}
