'use client'

import { type KeyboardEvent, useState } from 'react'
import { IoNavigateOutline } from 'react-icons/io5'
import { TbLetterX, TbLetterY } from 'react-icons/tb'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { formControlChrome } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

type AxisProps = { axis: 'X' | 'Y'; value: number; max: number | null; disabled?: boolean; onChange: (v: number) => void }

const clampTo = (v: number, max: number | null) => Math.max(0, Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.floor(v)))

/** One borderless axis field; edits a local draft and commits a clamped integer on blur / Enter */
function Axis({ axis, value, max, disabled, onChange }: AxisProps) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const n = Number(draft)
    if (draft.trim() && Number.isFinite(n)) onChange(clampTo(n, max))
    setDraft(null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') setDraft(null)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const base = draft != null && draft.trim() && Number.isFinite(Number(draft)) ? Number(draft) : value
      onChange(clampTo(base + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), max))
      setDraft(null)
    }
  }
  const range = max != null ? t('events.map.coordRange', { axis, max }) : t('events.map.coordAxis', { axis })
  return (
    <Tooltip content={range}>
      <label className="inline-flex items-center gap-1">
        {axis === 'X' ? <TbLetterX size={14} className="shrink-0 text-ink-soft" aria-hidden /> : <TbLetterY size={14} className="shrink-0 text-ink-soft" aria-hidden />}
        <input
          type="text"
          inputMode="numeric"
          aria-label={range}
          disabled={disabled}
          value={draft ?? String(value)}
          className="w-[3.5ch] min-w-0 border-none bg-transparent p-0 text-center font-mono text-[0.8125rem] text-ink outline-none disabled:cursor-not-allowed"
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.target.select()}
        />
      </label>
    </Tooltip>
  )
}

type Props = {
  x: number
  y: number
  width: number | null
  height: number | null
  busy: boolean
  /** Why teleporting is unavailable (no link / not on a map); disables the button and becomes its tooltip */
  blocked: string
  onChange: (x: number, y: number) => void
  onTeleport: () => void
}

/** Map tile coordinates `X 10  Y 10` with the teleport button attached; each axis is bounded by the map size when known */
export function MapTeleportField({ x, y, width, height, busy, blocked, onChange, onTeleport }: Props) {
  const t = useT()
  const maxX = width ? width - 1 : null
  const maxY = height ? height - 1 : null
  const outOfRange = maxX != null && maxY != null && (x > maxX || y > maxY)
  return (
    <div className="inline-flex shrink-0 items-stretch">
      <span
        className={cn(formControlChrome, 'inline-flex items-center gap-3 rounded-r-none border-r-0 px-2 focus-within:border-[color-mix(in_oklab,var(--accent)_60%,var(--line))]')}
      >
        <Axis axis="X" value={x} max={maxX} onChange={(v) => onChange(v, y)} />
        <Axis axis="Y" value={y} max={maxY} onChange={(v) => onChange(x, v)} />
      </span>
      <Button
        size="icon"
        aria-label={t('events.map.teleport')}
        className="rounded-l-none"
        loading={busy}
        disabled={!!blocked || outOfRange}
        tooltip={blocked || (outOfRange ? t('events.map.teleportOutOfRange', { maxX: maxX ?? 0, maxY: maxY ?? 0 }) : undefined)}
        onClick={onTeleport}
      >
        <IoNavigateOutline size={15} aria-hidden />
      </Button>
    </div>
  )
}
