import { useEffect, useState } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { MiniMap } from '@/components/game-edit/events/MiniMap'
import type { PlayerSpot } from '@/components/game-edit/events/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import type { MapDetailData } from '@/lib/game/events'

import { isOnMapScene } from '../session/live-events'
import { buildLiveMapDetail, currentMapLiveState, playerSpot, teleportPlayer } from '../session/live-map'

type Props = {
  enabled: boolean
  onClose: () => void
  onSelectEvent: (mapId: number, eventId: number) => void
}

export function FloatingMiniMap({ enabled, onClose, onSelectEvent }: Props) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const [player, setPlayer] = useState<PlayerSpot | null>(null)
  const [detail, setDetail] = useState<MapDetailData | null>(null)
  const [picked, setPicked] = useState<{ mapId: number; x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      const spot = isOnMapScene() ? playerSpot() : null
      setPlayer((previous) => (previous?.mapId === spot?.mapId && previous?.x === spot?.x && previous?.y === spot?.y && previous?.direction === spot?.direction ? previous : spot))
      if (spot?.mapId) {
        const live = currentMapLiveState(spot.mapId)
        setDetail((previous) => (previous?.mapId === spot.mapId && JSON.stringify(previous.live) !== JSON.stringify(live) ? { ...previous, live } : previous))
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [enabled])

  useEffect(() => {
    if (!enabled || !player?.mapId) return
    let cancelled = false
    const mapId = player.mapId
    void buildLiveMapDetail(mapId)
      .then((next) => {
        if (!cancelled) setDetail(next)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, player?.mapId])

  if (!enabled || !player || !detail || detail.mapId !== player.mapId) return null

  const target = picked?.mapId === detail.mapId ? picked : { x: player.x, y: player.y }
  const pickCell = async (x: number, y: number) => {
    if (picked?.mapId !== detail.mapId || picked.x !== x || picked.y !== y) {
      setPicked({ mapId: detail.mapId, x, y })
      return
    }
    if (busy) return
    const name = detail.name || `#${detail.mapId}`
    const approved = await confirm({ title: t('events.map.minimapTeleportTitle', { name, x, y }) })
    if (!approved) return
    setBusy(true)
    try {
      setPlayer(await teleportPlayer({ mapId: detail.mapId, x, y, near: true }))
      setPicked(null)
      notify.success(t('events.map.teleportOk', { name }))
    } catch (error) {
      notify.error(t('events.map.teleportFail', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MiniMap
      detail={detail}
      player={player}
      target={target}
      stateOf={(id) => {
        const page = detail.live?.activePage[id] ?? 0
        return { kind: page > 0 ? 'shown' : 'hidden', page, exact: true }
      }}
      near
      disabled={busy}
      onClose={onClose}
      onPickCell={(x, y) => void pickCell(x, y)}
      onSelectEvent={(id) => onSelectEvent(detail.mapId, id)}
    />
  )
}
