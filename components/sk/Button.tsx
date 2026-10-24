'use client'

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'

import { controlDisabled } from '@/components/sk/control'
import { Spinner } from '@/components/sk/Spinner'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import type { TooltipPlacement } from '@/components/sk/Tooltip/tooltipPosition'
import { cn } from '@/lib/utils'

/** default：浅底+描边；ghost：透明底+描边；plain：无底无描边；accent/ok/warn/fail：实心渐变色钮；outline-*（或配合 outline prop）：淡底+彩色描边次级色钮 */
export type ButtonVariant = 'default' | 'accent' | 'ok' | 'warn' | 'fail' | 'ghost' | 'plain' | 'outline-accent' | 'outline-ok' | 'outline-warn' | 'outline-fail'

/** md：32px 标准按钮；lg：44px 大按钮（卡片主操作/CTA）；gate：入口大按钮；icon：32px 图标按钮；mini：24px 图标按钮；xs：20px 文字按钮 */
export type ButtonSize = 'md' | 'lg' | 'icon' | 'mini' | 'xs' | 'gate'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 次级彩色描边样式（淡底 + 彩色边框 + 彩色字），区别于主操作渐变色钮；大按钮（gate/lg）强制保持渐变色 */
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

const accentSheenBg =
  'after:bg-[linear-gradient(118deg,transparent_0%,transparent_42%,rgb(255_255_255/0.28)_48%,transparent_56%,transparent_100%),radial-gradient(circle_5rem_at_var(--btn-x,50%)_var(--btn-y,40%),rgb(255_255_255/0.35)_0%,rgb(255_255_255/0.1)_38%,transparent_68%)]'

const gateSheenBg = 'after:bg-[radial-gradient(circle_7rem_at_var(--btn-x,50%)_var(--btn-y,50%),rgb(255_255_255/0.48)_0%,rgb(191_219_254/0.22)_36%,transparent_68%)]'

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
  // 大按钮统一使用实心渐变色；只有非大按钮且显式声明 outline 时才渲染彩色描边样式
  const isOutline = !isLarge && (outline || variant.startsWith('outline-'))

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

  const isGradient = colorTone !== null && !isOutline
  const sheen = isGradient || isGate

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
        isGradient && !isGate && accentSheenBg,
        // 实心渐变主色钮（之前的渐变按钮，大按钮与主操作统一使用）
        isGradient &&
          colorTone === 'accent' &&
          'border-transparent bg-[linear-gradient(145deg,color-mix(in_oklab,var(--accent)_88%,white)_0%,var(--accent)_42%,color-mix(in_oklab,var(--accent)_90%,#0a6a88)_100%)] font-semibold text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_color-mix(in_oklab,var(--accent)_40%,transparent),0_3px_14px_color-mix(in_oklab,var(--accent-glow)_55%,transparent)] hover:enabled:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--accent)_92%,white)_0%,color-mix(in_oklab,var(--accent)_96%,white)_40%,var(--accent)_100%)] hover:enabled:text-accent-ink hover:enabled:shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_0_22px_var(--accent-glow),0_0_0_1px_color-mix(in_oklab,var(--accent)_50%,transparent)]',
        isGradient &&
          colorTone === 'ok' &&
          'border-transparent bg-[linear-gradient(145deg,color-mix(in_oklab,var(--ok)_78%,white)_0%,color-mix(in_oklab,var(--ok)_55%,#059669)_38%,color-mix(in_oklab,var(--ok)_50%,#047857)_100%)] font-semibold text-[#ecfdf5] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_0_0_1px_color-mix(in_oklab,var(--ok)_38%,transparent),0_3px_14px_color-mix(in_oklab,var(--ok-glow)_55%,transparent)] hover:enabled:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--ok)_86%,white)_0%,color-mix(in_oklab,var(--ok)_62%,#10b981)_40%,color-mix(in_oklab,var(--ok)_52%,#059669)_100%)] hover:enabled:text-[#ecfdf5] hover:enabled:shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_0_22px_var(--ok-glow),0_0_0_1px_color-mix(in_oklab,var(--ok)_48%,transparent)]',
        isGradient &&
          colorTone === 'warn' &&
          'border-transparent bg-[linear-gradient(145deg,color-mix(in_oklab,var(--warn)_92%,white)_0%,var(--warn)_45%,color-mix(in_oklab,var(--warn)_82%,#eab308)_100%)] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_0_0_1px_color-mix(in_oklab,var(--warn)_45%,transparent),0_3px_14px_color-mix(in_oklab,var(--warn)_40%,transparent)] hover:enabled:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--warn)_96%,white)_0%,color-mix(in_oklab,var(--warn)_94%,white)_40%,var(--warn)_100%)] hover:enabled:text-white hover:enabled:shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_0_20px_color-mix(in_oklab,var(--warn)_50%,transparent),0_0_0_1px_color-mix(in_oklab,var(--warn)_55%,transparent)]',
        isGradient &&
          colorTone === 'fail' &&
          'border-transparent bg-[linear-gradient(145deg,color-mix(in_oklab,var(--fail)_82%,white)_0%,color-mix(in_oklab,var(--fail)_70%,#dc2626)_40%,color-mix(in_oklab,var(--fail)_55%,#b91c1c)_100%)] font-semibold text-[#fef2f2] shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_0_0_1px_color-mix(in_oklab,var(--fail)_40%,transparent),0_3px_14px_color-mix(in_oklab,var(--fail)_35%,transparent)] hover:enabled:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--fail)_90%,white)_0%,color-mix(in_oklab,var(--fail)_78%,#ef4444)_40%,color-mix(in_oklab,var(--fail)_60%,#dc2626)_100%)] hover:enabled:text-[#fef2f2] hover:enabled:shadow-[inset_0_1px_0_rgb(255_255_255/0.26),0_0_20px_color-mix(in_oklab,var(--fail)_45%,transparent),0_0_0_1px_color-mix(in_oklab,var(--fail)_50%,transparent)]',
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
          cn(
            'relative mt-3 h-[2.85rem] min-w-[11rem] justify-center gap-0 rounded-[0.3rem] px-6 text-[0.95rem] leading-normal shadow-[0_8px_32px_var(--accent-glow)] motion-safe:animate-[kit-rise_0.4s_0.12s_ease_backwards] hover:enabled:shadow-[0_10px_40px_var(--accent-glow)]',
            gateSheenBg
          ),
        loading && isGate && 'shadow-[0_4px_18px_color-mix(in_oklab,var(--accent-glow)_55%,transparent)]',
        loading && isGradient && colorTone === 'accent' && !isGate && 'shadow-[0_4px_18px_color-mix(in_oklab,var(--accent-glow)_55%,transparent)]',
        loading && isGradient && colorTone === 'ok' && 'shadow-[0_4px_18px_color-mix(in_oklab,var(--ok-glow)_55%,transparent)]',
        loading && isGradient && colorTone === 'warn' && 'shadow-[0_4px_18px_color-mix(in_oklab,var(--warn)_45%,transparent)]',
        loading && isGradient && colorTone === 'fail' && 'shadow-[0_4px_18px_color-mix(in_oklab,var(--fail)_40%,transparent)]',
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
