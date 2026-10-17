'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type EmptyStateProps = {
  title: string
  message?: string
  hint?: string
  children?: ReactNode
  /**
   * `panel`（默认）：占满剩余面板区并居中（`flex-1` + `min-h-48` + `py-12`），用于列表/门闸整区空态。
   * `compact`：卡片 / 表单分区内部空态，只用常规内边距，不撑开面板。
   */
  density?: 'panel' | 'compact'
  className?: string
}

/** 空态：面板占满居中，或卡片内紧凑（见 `density`）。 */
export function EmptyState({ title, message, hint, children, density = 'panel', className }: EmptyStateProps) {
  const compact = density === 'compact'
  return (
    <div
      className={cn(
        'flex w-full items-center justify-center',
        // compact：作为 formCard 子项时由卡片 `[&>*]:p-4` 提供边距，自身不再叠 py-12 / min-h-48
        compact ? 'p-0' : 'min-h-48 flex-1 px-6 py-12',
        className
      )}
      role="status"
    >
      <div className="max-w-md text-center">
        <p className="m-0 text-xs font-medium text-ink-soft">{title}</p>
        {message ? <p className="mt-1 mb-0 text-xs leading-[1.55] text-ink-soft">{message}</p> : null}
        {hint ? <p className="mt-2 mb-0 text-xs leading-[1.55] text-[color-mix(in_oklab,var(--ink-soft)_75%,transparent)]">{hint}</p> : null}
        {children}
      </div>
    </div>
  )
}
