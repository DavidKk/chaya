'use client'

import { useMemo, useState } from 'react'

import { NumberInput } from '@/components/sk/NumberInput'
import { Select, type SelectOption } from '@/components/sk/Select'
import { cn } from '@/lib/utils'

type RatioPreset = {
  value: string
  label: string
  w: number
  h: number
}

const RATIOS: RatioPreset[] = [
  { value: 'custom', label: '自定义', w: 0, h: 0 },
  { value: '16:9', label: '16:9', w: 16, h: 9 },
  { value: '16:10', label: '16:10', w: 16, h: 10 },
  { value: '4:3', label: '4:3', w: 4, h: 3 },
  { value: '3:2', label: '3:2', w: 3, h: 2 },
  { value: '21:9', label: '21:9', w: 21, h: 9 },
  { value: '1:1', label: '1:1', w: 1, h: 1 },
]

const RATIO_OPTIONS: SelectOption[] = RATIOS.map(({ value, label }) => ({ value, label }))

const SIZE_LINE = 'h-5'
const SIZE_TRAIL = 'w-[2.75rem]'

const valueClass = cn(
  SIZE_LINE,
  'w-[3.25rem] max-w-none min-w-0 flex-none border-none bg-transparent p-0 text-center text-sm font-semibold leading-5 tracking-[0.01em] text-ink tabular-nums focus:border-none focus:shadow-none focus:outline-none'
)

function heightFromWidth(width: number, rw: number, rh: number) {
  return Math.max(1, Math.round((width * rh) / rw))
}

function widthFromHeight(height: number, rw: number, rh: number) {
  return Math.max(1, Math.round((height * rw) / rh))
}

function matchRatio(width: number, height: number) {
  if (!width || !height) return 'custom'
  for (const r of RATIOS) {
    if (!r.w || !r.h) continue
    if (heightFromWidth(width, r.w, r.h) === height) return r.value
  }
  return 'custom'
}

export type SizeInputProps = {
  width: number
  height: number
  onWidthChange: (value: number) => void
  onHeightChange: (value: number) => void
  /** 同时改宽高（选比例时用） */
  onSizeChange?: (size: { width: number; height: number }) => void
  disabled?: boolean
  unit?: string
  className?: string
  'aria-label'?: string
}

export function SizeInput({
  width,
  height,
  onWidthChange,
  onHeightChange,
  onSizeChange,
  disabled = false,
  unit = 'PX',
  className,
  'aria-label': ariaLabel = '宽高',
}: SizeInputProps) {
  const [ratio, setRatio] = useState(() => matchRatio(width, height))

  const preset = useMemo(() => RATIOS.find((r) => r.value === ratio) ?? RATIOS[0], [ratio])
  const locked = !!(preset && preset.w > 0 && preset.h > 0)

  function emitSize(nextW: number, nextH: number) {
    if (onSizeChange) {
      onSizeChange({ width: nextW, height: nextH })
      return
    }
    if (nextW !== width) onWidthChange(nextW)
    if (nextH !== height) onHeightChange(nextH)
  }

  function onRatioChange(value: string) {
    setRatio(value)
    const next = RATIOS.find((r) => r.value === value)
    if (!next || !next.w || !next.h) return
    emitSize(width, heightFromWidth(width, next.w, next.h))
  }

  function onWidth(value: number) {
    if (!locked || !preset) {
      onWidthChange(value)
      return
    }
    emitSize(value, heightFromWidth(value, preset.w, preset.h))
  }

  function onHeight(value: number) {
    if (!locked || !preset) {
      onHeightChange(value)
      return
    }
    emitSize(widthFromHeight(value, preset.w, preset.h), value)
  }

  return (
    <div
      className={cn(
        'inline-flex h-8 w-max max-w-full min-w-0 items-center gap-[0.35rem] overflow-visible rounded-[0.25rem] border border-line bg-paper py-0 pr-[0.4rem] pl-2',
        'focus-within:border-[color-mix(in_oklab,var(--accent)_55%,var(--line))]',
        className
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <label className={cn('m-0 inline-flex cursor-text items-center gap-[0.35rem]', SIZE_LINE)}>
        <span
          className={cn(
            'relative inline-flex shrink-0 select-none items-center justify-center text-[0.68rem] leading-none text-ink-soft after:pointer-events-none after:absolute after:top-[calc(50%+0.38rem)] after:left-1/2 after:h-px after:w-[0.35rem] after:-translate-x-1/2 after:bg-[color-mix(in_oklab,var(--ink-soft)_55%,transparent)] after:content-[""]',
            SIZE_LINE
          )}
        >
          宽
        </span>
        <span className={cn('inline-flex min-w-0 items-center gap-[0.2rem] border-none bg-transparent p-0', SIZE_LINE)}>
          <NumberInput className={valueClass} value={width} disabled={disabled} aria-label="宽" onValueChange={onWidth} />
          <span className={cn('inline-flex shrink-0 select-none items-center justify-center text-[0.62rem] font-medium leading-none text-ink-soft', SIZE_LINE)}>{unit}</span>
        </span>
      </label>
      <span className={cn('m-0 inline-flex shrink-0 select-none items-center justify-center text-xs font-medium leading-none text-ink-soft', SIZE_LINE)} aria-hidden>
        ×
      </span>
      <label className={cn('m-0 inline-flex cursor-text items-center gap-[0.35rem]', SIZE_LINE)}>
        <span
          className={cn(
            'relative inline-flex shrink-0 select-none items-center justify-center text-[0.68rem] leading-none text-ink-soft after:pointer-events-none after:absolute after:top-[calc(50%+0.38rem)] after:left-1/2 after:h-px after:w-[0.35rem] after:-translate-x-1/2 after:bg-[color-mix(in_oklab,var(--ink-soft)_55%,transparent)] after:content-[""]',
            SIZE_LINE
          )}
        >
          高
        </span>
        <span className={cn('inline-flex min-w-0 items-center gap-[0.2rem] border-none bg-transparent p-0', SIZE_LINE)}>
          <NumberInput className={valueClass} value={height} disabled={disabled} aria-label="高" onValueChange={onHeight} />
          <span className={cn('inline-flex shrink-0 select-none items-center justify-center text-[0.62rem] font-medium leading-none text-ink-soft', SIZE_LINE, SIZE_TRAIL)}>
            {unit}
          </span>
        </span>
      </label>
      <span className="h-[0.65rem] w-px shrink-0 self-center bg-[color-mix(in_oklab,var(--ink-soft)_32%,transparent)]" aria-hidden />
      <Select
        className={cn(
          'relative m-0 inline-flex max-w-none min-w-[2.75rem] shrink-0 items-center',
          SIZE_LINE,
          SIZE_TRAIL,
          '[&_button]:h-5 [&_button]:min-h-5 [&_button]:w-full [&_button]:min-w-0 [&_button]:justify-center [&_button]:gap-0 [&_button]:rounded-[0.15rem] [&_button]:border-none [&_button]:bg-transparent [&_button]:px-[0.15rem] [&_button]:py-0 [&_button]:text-[0.62rem] [&_button]:font-medium [&_button]:leading-none [&_button]:tracking-[0.02em] [&_button]:text-ink-soft [&_button]:shadow-none',
          '[&_button:hover:not(:disabled)]:border-none [&_button:hover:not(:disabled)]:bg-[rgb(230_238_248/0.05)] [&_button:hover:not(:disabled)]:text-ink-soft',
          '[&_button:focus-visible]:border-none [&_button:focus-visible]:bg-[rgb(230_238_248/0.06)] [&_button:focus-visible]:text-ink-soft',
          '[&_button[aria-expanded=true]]:border-none [&_button[aria-expanded=true]]:bg-[rgb(230_238_248/0.06)] [&_button[aria-expanded=true]]:text-ink-soft',
          '[&_svg]:hidden'
        )}
        value={ratio}
        options={RATIO_OPTIONS}
        disabled={disabled}
        aria-label="宽高比"
        panelWidth="content"
        onChange={onRatioChange}
      />
    </div>
  )
}
