import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** 面板内操作：24px 无边框图标按钮，提示文字取 `aria-label`；图标用 `miniPanelIconClass` */
export const miniPanelIconButton = { size: 'mini', variant: 'plain' } as const
export const miniPanelIconClass = 'size-3.5'

/** 正文顶部一行：左侧摘要，右侧操作 */
export function MiniPanelBar({ summary, children }: { summary: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[0.7rem] text-ink-soft tabular-nums">{summary}</span>
      {children}
    </div>
  )
}

/** 占满正文剩余空间、水平垂直居中的说明：读取中、空列表等 */
export function MiniPanelNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn('m-0 flex min-h-0 flex-1 items-center justify-center px-3 py-6 text-center text-[0.7rem] leading-4 text-ink-soft', className)}>
      {children}
    </p>
  )
}

/** 正文顶部的错误条；成功只靠通知或游戏内提示，不在面板里插入 */
export function MiniPanelAlert({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="m-0 shrink-0 border-b border-line px-2 py-1 text-[0.7rem] leading-4 text-fail">
      {children}
    </p>
  )
}
