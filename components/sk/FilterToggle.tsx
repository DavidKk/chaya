'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { controlDisabled } from '@/components/sk/control'
import { withTooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

export type FilterToggleTone = 'accent' | 'ok' | 'warn'

export type FilterToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onChange'> & {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  children: ReactNode
  /** `switch`：筛选开关；`button`：表达附加状态的操作按钮。 */
  role?: 'switch' | 'button'
  /** 激活态语义色。 */
  tone?: FilterToggleTone
  /** 悬停提示；禁用时仍可显示。 */
  tooltip?: string
}

const toneClass: Record<FilterToggleTone, string> = {
  accent:
    'border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] text-accent hover:enabled:border-[color-mix(in_oklab,var(--accent)_75%,var(--line))] hover:enabled:text-accent',
  ok: 'border-[color-mix(in_oklab,var(--ok)_55%,var(--line))] text-ok hover:enabled:border-[color-mix(in_oklab,var(--ok)_75%,var(--line))] hover:enabled:text-ok',
  warn: 'border-[color-mix(in_oklab,var(--warn)_55%,var(--line))] text-warn hover:enabled:border-[color-mix(in_oklab,var(--warn)_75%,var(--line))] hover:enabled:text-warn',
}

const indicatorClass: Record<FilterToggleTone, string> = {
  accent: 'after:bg-accent',
  ok: 'after:bg-ok',
  warn: 'after:bg-warn',
}

/** 工具条状态按钮：描边样式，激活时仅改变描边 / 字色并显示底部短指示线。 */
export function FilterToggle({ pressed, onPressedChange, children, role = 'switch', tone = 'accent', tooltip, className, disabled, onClick, ...rest }: FilterToggleProps) {
  const button = (
    <button
      {...rest}
      type="button"
      role={role}
      aria-checked={role === 'switch' ? pressed : undefined}
      aria-pressed={role === 'button' ? pressed : undefined}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onPressedChange(!pressed)
      }}
      className={cn(
        'relative inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-[0.2rem] border px-3 text-[0.75rem] leading-none transition-colors',
        'border-line bg-transparent text-ink-soft',
        !pressed && 'hover:enabled:border-[rgb(230_238_248/0.18)] hover:enabled:text-ink',
        pressed && toneClass[tone],
        !pressed && 'after:hidden',
        'after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-3 after:-translate-x-1/2 after:rounded-full',
        pressed && indicatorClass[tone],
        controlDisabled,
        className
      )}
    >
      {children}
    </button>
  )

  return tooltip ? withTooltip(tooltip, button, disabled) : button
}
