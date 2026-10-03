import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'fail' | 'info'

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
  children: ReactNode
  /** 左侧状态点；默认开启 */
  dot?: boolean
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-[color-mix(in_oklab,var(--ink-soft)_12%,var(--inset))] text-ink-soft',
  accent: 'bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-accent',
  ok: 'bg-[color-mix(in_oklab,var(--ok)_16%,transparent)] text-ok',
  warn: 'bg-[color-mix(in_oklab,var(--warn)_16%,transparent)] text-warn',
  fail: 'bg-[color-mix(in_oklab,var(--fail)_16%,transparent)] text-fail',
  info: 'bg-[color-mix(in_oklab,var(--info)_16%,transparent)] text-info',
}

/** 只读状态徽标（非按钮）：与筛选/操作控件视觉区分。 */
export function Badge({ tone = 'neutral', dot = true, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex h-[1.35rem] cursor-default select-none items-center gap-1 whitespace-nowrap rounded-full border-none px-2 pl-2 text-[0.68rem] font-medium leading-none tracking-[0.02em]',
        TONE[tone],
        className
      )}
      role="status"
      {...rest}
    >
      {dot ? <span className="size-[0.35rem] shrink-0 rounded-full bg-current opacity-90" aria-hidden /> : null}
      {children}
    </span>
  )
}
