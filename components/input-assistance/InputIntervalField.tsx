'use client'

import { useState } from 'react'

import { hotkeyInput, hotkeyShell } from '@/components/game-edit'
import { Tooltip } from '@/components/sk'
import { intervalLabel, MAX_REPEAT_MS, MIN_REPEAT_MS, parseInterval, type TurboRule } from '@/lib/game/input-assistance'
import { cn } from '@/lib/utils'

type Interval = TurboRule['interval']

type Props = {
  value: Interval
  onChange: (value: Interval) => void
  disabled?: boolean
}

const HINT = `输入固定间隔如 100，或范围如 100-130（每次在范围内随机）；${MIN_REPEAT_MS}–${MAX_REPEAT_MS} ms`

export function InputIntervalField({ value, onChange, disabled = false }: Props) {
  const label = intervalLabel(value)
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft != null && !parseInterval(draft)

  function commit() {
    if (draft == null) return
    const next = parseInterval(draft)
    setDraft(null)
    if (next && (next.minMs !== value.minMs || next.maxMs !== value.maxMs)) onChange(next)
  }

  return (
    <Tooltip content={HINT} triggerClassName="block w-full min-w-0">
      <span className={cn(hotkeyShell, 'w-full', invalid && 'border-fail', disabled && 'opacity-60')}>
        <input
          className={cn(hotkeyInput, 'pr-7')}
          value={draft ?? label}
          disabled={disabled}
          aria-label={`连发间隔（ms）：${label}`}
          aria-invalid={invalid || undefined}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            else if (event.key === 'Escape') {
              setDraft(null)
              requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur())
            }
          }}
        />
        <span className="pointer-events-none absolute top-0 right-2 z-[1] text-[0.68rem] leading-8 text-ink-soft" aria-hidden>
          ms
        </span>
      </span>
    </Tooltip>
  )
}
