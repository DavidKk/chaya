'use client'

import { type ButtonHTMLAttributes, type ReactNode, useId } from 'react'

import { SWITCH_TRAVEL, switchThumbClass, switchTrackClass } from '@/components/sk/switch-geometry'
import { Tooltip, withTooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

export type SwitchToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role' | 'onClick'> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** 悬停提示；无文案的裸开关建议必传 */
  tooltip?: string
}

export function SwitchToggle({ checked, onCheckedChange, className, disabled, id, tooltip, ...rest }: SwitchToggleProps) {
  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-[0.25rem] transition-[background-color,border-color] duration-150 ease-out',
        'box-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]',
        'disabled:cursor-not-allowed',
        switchTrackClass,
        checked ? 'border-[color-mix(in_oklab,var(--accent)_80%,transparent)] bg-accent' : 'border-line bg-[var(--inset)]',
        className
      )}
      {...rest}
    >
      <span
        aria-hidden
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-[0.15rem] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-transform duration-150 ease-out will-change-transform',
          switchThumbClass
        )}
        style={{ transform: checked ? `translateX(${SWITCH_TRAVEL}px)` : 'translateX(0)' }}
      />
    </button>
  )

  if (!tooltip) return button
  return withTooltip(tooltip, button, !!disabled)
}

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role' | 'onClick'> & {
  checked: boolean
  label: ReactNode
  description?: ReactNode
  /** 覆盖开关滑块 hover 提示；默认按 label 生成「开启/关闭 …」。 */
  toggleTooltip?: string
  onCheckedChange: (checked: boolean) => void
}

export function Switch({ checked, label, description, toggleTooltip, onCheckedChange, className, disabled, id, ...rest }: SwitchProps) {
  const autoId = useId()
  const toggleId = id ?? autoId
  const labelId = `${toggleId}-label`
  const descId = description ? `${toggleId}-desc` : undefined
  const ariaLabel = typeof label === 'string' ? label : undefined
  const resolvedToggleTooltip = toggleTooltip ?? (typeof label === 'string' ? (checked ? `关闭 ${label}` : `开启 ${label}`) : checked ? '关闭' : '开启')

  function toggle() {
    if (disabled) return
    onCheckedChange(!checked)
  }

  return (
    <div className={cn('flex items-center justify-between gap-4 text-ink', disabled && 'opacity-45', className)}>
      {/* 文案区整块可点：左右拉开时不必摸到右侧滑块；内边距由 formCard 等外层统一 */}
      <div className={cn('grid min-w-0 flex-1 cursor-pointer gap-[0.3rem] rounded-[0.15rem]', disabled && 'pointer-events-none cursor-not-allowed')} onClick={toggle}>
        <span id={labelId} className="text-[0.875rem] font-medium leading-[1.35] text-ink">
          {label}
        </span>
        {description ? (
          <span id={descId} className="text-[0.75rem] leading-[1.4] text-ink-soft">
            {description}
          </span>
        ) : null}
      </div>
      <Tooltip content={resolvedToggleTooltip}>
        <span className="inline-flex shrink-0">
          <SwitchToggle
            id={toggleId}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : labelId}
            aria-describedby={descId}
            {...rest}
          />
        </span>
      </Tooltip>
    </div>
  )
}
