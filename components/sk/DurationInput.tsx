'use client'

import { type FocusEvent, forwardRef, type ReactNode, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { NumberInput, type NumberInputProps } from '@/components/sk/NumberInput'
import { NumberSliderInput } from '@/components/sk/NumberSliderInput'
import { durationParts, type DurationUnit } from '@/lib/duration'

const UNIT_KEY = {
  hour: 'common.durationHour',
  min: 'common.durationMin',
  sec: 'common.durationSec',
  ms: 'common.durationMs',
} as const satisfies Record<DurationUnit, string>

export type DurationInputProps = Omit<NumberInputProps, 'value' | 'onValueChange' | 'suffix' | 'allowDecimal'> & {
  /** 毫秒 */
  value: number
  onValueChange: (ms: number) => void
  /** 0 毫秒时的后缀（如「立即释放」）；默认「0 毫秒」 */
  zeroLabel?: ReactNode
  /** 覆盖自动换算的后缀（如「常驻」） */
  label?: ReactNode
}

/** 以毫秒输入，后缀随输入实时换算成「1 分钟 30 秒」；同时给 min / max 时带拖拽滑块 */
export const DurationInput = forwardRef<HTMLInputElement, DurationInputProps>(function DurationInput({ value, zeroLabel, label, onDraftChange, onBlur, ...rest }, ref) {
  const t = useT()
  const [typing, setTyping] = useState<number | null>(null)
  const parts = durationParts(typing ?? value)
  const auto = parts.length ? parts.map(({ unit, n }) => t(UNIT_KEY[unit], { n })).join(' ') : (zeroLabel ?? t('common.durationMs', { n: 0 }))

  const props = {
    ...rest,
    value,
    suffix: label ?? auto,
    onDraftChange: (next: number | null) => {
      setTyping(next)
      onDraftChange?.(next)
    },
    onBlur: (e: FocusEvent<HTMLInputElement>) => {
      setTyping(null)
      onBlur?.(e)
    },
  }
  const { min, max } = rest
  if (typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max)) return <NumberSliderInput {...props} min={min} max={max} />
  return <NumberInput ref={ref} {...props} />
})
