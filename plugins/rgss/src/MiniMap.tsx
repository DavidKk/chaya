import { useEffect, useState } from 'react'

import { MiniMap } from '@/components/game-edit/events/MiniMap'
import type { PlayerSpot } from '@/components/game-edit/events/types'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import type { useToolSettings } from '@/components/game-tools/useToolSettings'
import type { MapDetailData } from '@/lib/game/events'

import { onGameMessage, postToGame } from './host-bridge'

export function RgssMiniMap({ tools }: { tools: ReturnType<typeof useToolSettings> }) {
  const panel = useToolPanelVisibility('miniMap', tools.settings.miniMapEnabled)
  const [player, setPlayer] = useState<PlayerSpot | null>(null)
  const [detail, setDetail] = useState<MapDetailData | null>(null)
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!panel.visible) return
    return onGameMessage((message) => {
      if (message.type === 'edit.state')
        setPlayer(message.onMap && message.mapId ? { mapId: message.mapId, x: message.playerX ?? 0, y: message.playerY ?? 0, direction: message.playerDir ?? 2 } : null)
      if (message.type === 'edit.map' && message.data.ok) setDetail(message.data)
    })
  }, [panel.visible])
  useEffect(() => {
    setTarget(null)
    if (!panel.visible || !player?.mapId) return
    postToGame({ type: 'edit.map.request', mapId: player.mapId })
  }, [panel.visible, player?.mapId])
  if (!panel.visible || !player || !detail || detail.mapId !== player.mapId) return null
  return (
    <MiniMap
      detail={detail}
      player={player}
      target={target}
      near={false}
      disabled={false}
      stateOf={(id) => ({ kind: detail.live?.activePage[id] ? 'shown' : 'hidden', page: detail.live?.activePage[id] ?? 0, exact: true })}
      onClose={panel.dismiss}
      onPickCell={(x, y) => setTarget({ x, y })}
      onSelectEvent={(id) => {
        const event = detail.events.find((item) => item.id === id)
        if (event) setTarget({ x: event.x, y: event.y })
      }}
      opacity={tools}
    />
  )
}
