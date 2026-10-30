'use client'

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'

import { controlDisabled } from '@/components/sk/control'
import { Spinner } from '@/components/sk/Spinner'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import type { TooltipPlacement } from '@/components/sk/Tooltip/tooltipPosition'
import { cn } from '@/lib/utils'

/** default：浅底+描边；ghost：透明底+描边；plain：无底无描边；彩色变体：大按钮深色渐变配白字，小按钮淡底+彩色描边 */
export type ButtonVariant = 'default' | 'accent' | 'ok' | 'warn' | 'fail' | 'ghost' | 'plain' | 'outline-accent' | 'outline-ok' | 'outline-warn' | 'outline-fail'

/** md：32px 标准按钮；lg：44px 大按钮（卡片主操作/CTA）；gate：入口大按钮；icon：32px 图标按钮；mini：24px 图标按钮；xs：20px 文字按钮 */
export type ButtonSize = 'md' | 'lg' | 'icon' | 'mini' | 'xs' | 'gate'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 彩色描边样式；小按钮默认使用，大按钮（gate/lg）保持深色渐变 */
  outline?: boolean
  loading?: boolean
  /** 悬停提示；`size="icon" | "mini"` 时若未传则回退到 `aria-label` */
  tooltip?: string
  tooltipPlacement?: TooltipPlacement
  /** 触发器自己的弹层打开时收起提示 */
  tooltipSuppressed?: boolean
  children?: ReactNode
}

const accentSheen =
  'after:pointer-events-none after:absolute after:inset-0 after:z-[1] after:rounded-[inherit] after:opacity-0 after:mix-blend-soft-light after:transition-opacity after:duration-[220ms] after:ease-out after:content-[""] hover:enabled:after:opacity-100 focus-visible:enabled:after:opacity-100'

const accentSheenBg = 'after:bg-[radial-gradient(circle_5rem_at_var(--btn-x,50%)_var(--btn-y,40%),color-mix(in_oklab,var(--ink)_12%,transparent)_0%,transparent_68%)]'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    outline = false,
    loading = false,
    disabled,
    className,
    type = 'button',
    tooltip,
    tooltipPlacement,
    tooltipSuppressed,
    children,
    'aria-label': ariaLabel,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading
  const iconOnly = size === 'icon' || size === 'mini'
  const tip = tooltip ?? (iconOnly && typeof ariaLabel === 'string' ? ariaLabel : undefined)
  const isLarge = size === 'gate' || size === 'lg'
  const isGate = size === 'gate'
  const colorTone: 'accent' | 'ok' | 'warn' | 'fail' | null =
    variant === 'accent' || variant === 'outline-accent'
      ? 'accent'
      : variant === 'ok' || variant === 'outline-ok'
        ? 'ok'
        : variant === 'warn' || variant === 'outline-warn'
          ? 'warn'
          : variant === 'fail' || variant === 'outline-fail'
            ? 'fail'
            : null

  const isOutline = !isLarge && (outline || colorTone !== null)
  const isGradient = isLarge && colorTone !== null
  const sheen = isGradient

  const button = (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      data-variant={variant === 'default' ? undefined : variant}
      data-size={size === 'md' ? undefined : size}
      data-sheen={sheen ? 'true' : undefined}
      className={cn(
        'relative isolate box-border inline-flex h-8 cursor-pointer appearance-none items-center justify-center gap-2 overflow-hidden rounded-[0.2rem] border border-line bg-[var(--panel-2)] px-3 font-inherit text-[0.8125rem] font-medium leading-none text-ink transition-[background-color,border-color,opacity,box-shadow] duration-100 ease-out',
        'outline-none focus:outline-none focus-visible:outline-none',
        'hover:enabled:bg-[color-mix(in_oklab,var(--panel-2)_80%,white)]',
        variant !== 'plain' && !isGradient && 'hover:enabled:border-[rgb(230_238_248/0.18)]',
        !loading && cn(controlDisabled, 'disabled:shadow-none'),
        loading && 'pointer-events-none cursor-wait opacity-[0.72] !animate-none after:!opacity-0',
        sheen && accentSheen,
        isGradient && accentSheenBg,
        isGradient && colorTone === 'accent' && '[--button-tone:var(--button-accent)]',
        isGradient && colorTone === 'ok' && '[--button-tone:var(--button-ok)]',
        isGradient && colorTone === 'warn' && '[--button-tone:var(--button-warn)]',
        isGradient && colorTone === 'fail' && '[--button-tone:var(--button-fail)]',
        isGradient &&
          'border-[color-mix(in_oklab,var(--button-tone)_75%,var(--ink))] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--button-tone)_96%,var(--ink)),var(--button-tone)_45%,color-mix(in_oklab,var(--button-tone)_90%,var(--panel)))] font-semibold text-white shadow-[inset_0_1px_0_var(--line),0_2px_5px_var(--paper)] hover:enabled:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--button-tone)_92%,var(--ink)),color-mix(in_oklab,var(--button-tone)_96%,var(--ink))_45%,var(--button-tone))] hover:enabled:text-white',
        // 彩色描边次级色钮（淡底 + 彩色描边 + 彩色字，与渐变色钮互为两种独立样式）
        isOutline &&
          colorTone === 'accent' &&
          'border-[color-mix(in_oklab,var(--accent)_42%,transparent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] font-medium text-accent shadow-none hover:enabled:border-[color-mix(in_oklab,var(--accent)_62%,transparent)] hover:enabled:bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] hover:enabled:text-accent',
        isOutline &&
          colorTone === 'ok' &&
          'border-[color-mix(in_oklab,var(--ok)_42%,transparent)] bg-[color-mix(in_oklab,var(--ok)_10%,transparent)] font-medium text-ok shadow-none hover:enabled:border-[color-mix(in_oklab,var(--ok)_62%,transparent)] hover:enabled:bg-[color-mix(in_oklab,var(--ok)_16%,transparent)] hover:enabled:text-ok',
        isOutline &&
          colorTone === 'warn' &&
          'border-[color-mix(in_oklab,var(--warn)_42%,transparent)] bg-[color-mix(in_oklab,var(--warn)_10%,transparent)] font-medium text-warn shadow-none hover:enabled:border-[color-mix(in_oklab,var(--warn)_62%,transparent)] hover:enabled:bg-[color-mix(in_oklab,var(--warn)_16%,transparent)] hover:enabled:text-warn',
        isOutline &&
          colorTone === 'fail' &&
          'border-[color-mix(in_oklab,var(--fail)_42%,transparent)] bg-[color-mix(in_oklab,var(--fail)_10%,transparent)] font-medium text-fail shadow-none hover:enabled:border-[color-mix(in_oklab,var(--fail)_62%,transparent)] hover:enabled:bg-[color-mix(in_oklab,var(--fail)_16%,transparent)] hover:enabled:text-fail',
        // ghost：描边透明底；default：浅底+边；plain：列表内轻量图标
        variant === 'ghost' && 'bg-transparent text-ink-soft hover:enabled:bg-[rgb(230_238_248/0.06)] hover:enabled:text-ink',
        variant === 'plain' &&
          'border-transparent bg-transparent text-ink-soft shadow-none hover:enabled:border-transparent hover:enabled:bg-[rgb(230_238_248/0.06)] hover:enabled:text-ink',
        size === 'icon' && 'w-8 shrink-0 px-0',
        size === 'mini' && 'h-6 w-6 shrink-0 px-0',
        size === 'xs' && 'h-5 gap-1 px-1.5 text-[11px] font-normal shadow-none',
        size === 'lg' && 'h-11 min-h-11 shrink-0 px-4 text-sm font-semibold rounded-[0.25rem] gap-2',
        isGate &&
          'relative mt-3 h-[2.85rem] min-w-[11rem] justify-center gap-0 rounded-[0.3rem] px-6 text-[0.95rem] leading-normal motion-safe:animate-[kit-rise_0.4s_0.12s_ease_backwards]',
        className
      )}
      {...rest}
    >
      {loading ? (
        <span className="relative inline-flex items-center justify-center">
          <span className="invisible inline-flex items-center gap-2" aria-hidden>
            {children}
          </span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner size={iconOnly || size === 'xs' ? 'sm' : 'md'} />
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  )

  if (!tip) return button

  const stretch = typeof className === 'string' && /\bw-full\b/.test(className)
  return (
    <Tooltip content={tip} placement={tooltipPlacement} suppressed={tooltipSuppressed} triggerClassName={isDisabled && stretch ? 'inline-flex w-full min-w-0' : undefined}>
      {isDisabled ? <span className={cn('inline-flex', stretch && 'w-full min-w-0')}>{button}</span> : button}
    </Tooltip>
  )
})
