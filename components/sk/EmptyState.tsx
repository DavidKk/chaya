'use client'

import type { ReactNode } from 'react'

type EmptyStateProps = {
  title: string
  message?: string
  hint?: string
  children?: ReactNode
}

/** 面板空态：对齐工单 PanelEmptyState（剩余区水平垂直居中） */
export function EmptyState({ title, message, hint, children }: EmptyStateProps) {
  return (
    <div className="flex min-h-48 w-full flex-1 items-center justify-center px-6 py-12" role="status">
      <div className="max-w-md text-center">
        <p className="m-0 text-xs font-medium text-ink-soft">{title}</p>
        {message ? <p className="mt-1 mb-0 text-xs leading-[1.55] text-ink-soft">{message}</p> : null}
        {hint ? <p className="mt-2 mb-0 text-xs leading-[1.55] text-[color-mix(in_oklab,var(--ink-soft)_75%,transparent)]">{hint}</p> : null}
        {children}
      </div>
    </div>
  )
}
