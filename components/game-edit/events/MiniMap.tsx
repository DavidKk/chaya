'use client'

import { type MouseEvent, useId, useMemo, useState } from 'react'

import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { useT } from '@/components/i18n/LocaleProvider'
import type { MapDetailData, MapEventType } from '@/lib/game/events'
import { cn } from '@/lib/utils'

import { type EventState, TYPE_KEY } from './event-meta'
import type { PlayerSpot } from './types'

const TYPE_FILL: Record<MapEventType, string> = {
  npc: 'fill-accent',
  transfer: 'fill-warn',
  chest: 'fill-ok',
  trigger: 'fill-[color-mix(in_oklab,var(--fail)_70%,var(--warn))]',
  other: 'fill-ink-soft',
}

const LEGEND: MapEventType[] = ['npc', 'transfer', 'chest', 'trigger', 'other']

/** RPG Maker direction → rotation of the upward arrow drawn in the player ring */
const FACING_DEG: Record<number, number> = { 8: 0, 6: 90, 2: 180, 4: 270 }
const FACING_ARROW = 'M0 -0.3L0.24 0.18L0 0.07L-0.24 0.18Z'

/** One SVG path covering every blocked tile, merged into horizontal runs per row */
function blockedPath(mask: string, w: number, h: number): string {
  let d = ''
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (mask[y * w + x] !== '1') {
        x++
        continue
      }
      const start = x
      while (x < w && mask[y * w + x] === '1') x++
      d += `M${start} ${y}h${x - start}v1h${start - x}z`
    }
  }
  return d
}

/**
 * Event positions on a grid the size of the map; clicking a blank tile picks a teleport target,
 * clicking an event opens it.
 */
export function MiniMap({
  detail,
  player,
  target,
  stateOf,
  near,
  disabled,
  onClose,
  onPickCell,
  onSelectEvent,
}: {
  detail: MapDetailData
  player: PlayerSpot | null
  target: { x: number; y: number } | null
  stateOf: (id: number) => EventState
  /** "Nearby" mode: impassable tiles can still be picked */
  near: boolean
  disabled?: boolean
  onClose: () => void
  onPickCell: (x: number, y: number) => void
  onSelectEvent: (id: number) => void
}) {
  const t = useT()
  const gridId = useId()
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const w = Math.max(1, detail.width)
  const h = Math.max(1, detail.height)
  const showGrid = Math.max(w, h) <= 80
  const onPlayerMap = player?.mapId === detail.mapId
  const mask = detail.blocked && detail.blocked.length === w * h ? detail.blocked : null
  const blockedD = useMemo(() => (mask ? blockedPath(mask, w, h) : ''), [mask, w, h])
  const isBlocked = (cell: { x: number; y: number } | null) => !!cell && mask?.[cell.y * w + cell.x] === '1'
  /** With "nearby" on, an impassable target still teleports (landing on the nearest standable tile) */
  const canPick = (cell: { x: number; y: number } | null) => !!cell && (near || !isBlocked(cell))
  const hoverBlocked = isBlocked(hover)
  const hoverRefused = hoverBlocked && !near

  const cellAt = (e: MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    const x = Math.floor(pt.x)
    const y = Math.floor(pt.y)
    return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null
  }

  return (
    <FloatingToolPanel title={t('events.map.minimap')} onClose={onClose} panel="miniMap">
      <div className="flex h-full min-h-0 flex-col p-2">
        <div className="flex h-12 shrink-0 items-start justify-end pb-1">
          <span className={cn('line-clamp-3 text-right font-mono text-[0.7rem] leading-4', hoverBlocked ? 'text-warn' : 'text-ink-soft')}>
            {!hover
              ? t('events.map.minimapHint')
              : !hoverBlocked
                ? `${hover.x},${hover.y}`
                : t(near ? 'events.map.minimapBlockedNear' : 'events.map.minimapBlockedAt', { x: hover.x, y: hover.y })}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className={cn('block min-h-0 w-full flex-1', disabled || hoverRefused ? 'cursor-not-allowed' : 'cursor-crosshair')}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={t('events.map.minimap')}
          onMouseMove={(e) => setHover(cellAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            if (disabled) return
            const cell = cellAt(e)
            if (cell && canPick(cell)) onPickCell(cell.x, cell.y)
          }}
        >
          <defs>
            {showGrid ? (
              <pattern id={gridId} width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" className="stroke-line" strokeWidth="0.04" />
              </pattern>
            ) : null}
            <pattern id={`${gridId}-x`} width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="0.5" height="0.5" className="fill-[color-mix(in_oklab,var(--ink-soft)_22%,var(--inset))]" />
              <path d="M 0 0 L 0 0.5" className="stroke-[color-mix(in_oklab,var(--ink-soft)_45%,transparent)]" strokeWidth="0.12" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={w} height={h} className="fill-inset" />
          {blockedD ? <path d={blockedD} fill={`url(#${gridId}-x)`} /> : null}
          {showGrid ? <rect x="0" y="0" width={w} height={h} fill={`url(#${gridId})`} /> : null}
          {hover ? (
            <rect
              x={hover.x}
              y={hover.y}
              width="1"
              height="1"
              className={hoverRefused ? 'fill-[color-mix(in_oklab,var(--warn)_30%,transparent)]' : 'fill-[color-mix(in_oklab,var(--accent)_25%,transparent)]'}
            />
          ) : null}
          {target ? (
            <rect x={target.x + 0.05} y={target.y + 0.05} width="0.9" height="0.9" fill="none" className="stroke-accent" strokeWidth="0.08" strokeDasharray="0.2 0.12" />
          ) : null}
          {detail.events.map((ev) => {
            const state = stateOf(ev.id)
            return (
              <circle
                key={ev.id}
                cx={ev.x + 0.5}
                cy={ev.y + 0.5}
                r="0.38"
                className={cn(TYPE_FILL[ev.type], 'cursor-pointer', state.kind === 'hidden' && 'opacity-35')}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectEvent(ev.id)
                }}
              >
                <title>{`${ev.name || `#${ev.id}`} (${ev.x},${ev.y}) · ${t(TYPE_KEY[ev.type])}`}</title>
              </circle>
            )
          })}
          {onPlayerMap && player ? (
            <g pointerEvents="none" transform={`translate(${player.x + 0.5} ${player.y + 0.5})`}>
              <circle r="0.48" fill="none" className="stroke-ink" strokeWidth="0.1" />
              {FACING_DEG[player.direction] != null ? (
                <path d={FACING_ARROW} transform={`rotate(${FACING_DEG[player.direction]})`} className="fill-ink" />
              ) : (
                <circle r="0.2" className="fill-ink" />
              )}
            </g>
          ) : null}
        </svg>
        <ul className="m-0 flex shrink-0 list-none flex-wrap gap-x-3 gap-y-1 pt-1.5 pl-0 text-[0.7rem] text-ink-soft">
          {onPlayerMap ? (
            <li className="inline-flex items-center gap-1">
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <circle cx="5" cy="5" r="4" fill="none" className="stroke-ink" strokeWidth="1.2" />
                <path d={FACING_ARROW} transform="translate(5 5) scale(10)" className="fill-ink" />
              </svg>
              {t('events.map.minimapPlayer')}
            </li>
          ) : null}
          {mask ? (
            <li className="inline-flex items-center gap-1">
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <rect width="10" height="10" className="fill-[color-mix(in_oklab,var(--ink-soft)_22%,var(--inset))]" />
                <path d="M0 10L10 0M-2 4L4 -2M6 12L12 6" className="stroke-[color-mix(in_oklab,var(--ink-soft)_45%,transparent)]" strokeWidth="1.6" />
              </svg>
              {t('events.map.minimapBlocked')}
            </li>
          ) : null}
          {LEGEND.map((type) => (
            <li key={type} className="inline-flex items-center gap-1">
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <circle cx="5" cy="5" r="4" className={TYPE_FILL[type]} />
              </svg>
              {t(TYPE_KEY[type])}
            </li>
          ))}
        </ul>
      </div>
    </FloatingToolPanel>
  )
}
