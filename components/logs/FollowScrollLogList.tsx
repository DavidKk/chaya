'use client'

import { ScrollToLatestCue } from '@/components/logs/ScrollToLatestCue'
import { useFollowBottomScroll } from '@/components/logs/useFollowBottomScroll'
import { ScrollArea } from '@/components/sk'
import { cn } from '@/lib/utils'

export type FollowScrollLogLevel = 'info' | 'ok' | 'warn' | 'fail' | 'debug' | 'error'

export type FollowScrollLogEntry = {
  id: string | number
  at: number
  level: FollowScrollLogLevel
  text: string
}

const levelClass: Record<string, string> = {
  info: 'text-ink-soft',
  ok: 'text-ok',
  warn: 'text-warn',
  fail: 'text-fail',
  error: 'text-fail',
  debug: 'text-ink-soft/80',
}

function fmtTime(at: number) {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}

type Props = {
  entries: readonly FollowScrollLogEntry[]
  emptyText?: string
  className?: string
  heightClassName?: string
  ariaLabel: string
  jumpLabel?: string
}

/**
 * Compact activity log: scrollbar flush on the right edge; jump cue flush on the bottom edge.
 */
export function FollowScrollLogList({
  entries,
  emptyText = '暂无记录',
  className,
  heightClassName = 'h-[11rem]',
  ariaLabel,
  jumpLabel = '滚到最新',
}: Props) {
  const latest = entries.at(-1)
  const contentKey = `${entries.length}:${latest?.id ?? ''}:${latest?.text ?? ''}`
  const { scrollRef, onScroll, showJump, scrollToBottom } = useFollowBottomScroll(contentKey)

  return (
    <div className={cn('relative', className)}>
      <ScrollArea
        scrollRef={scrollRef}
        className={heightClassName}
        indicator="vertical"
        reserveGutter={false}
        scrollClassName="px-4 py-2"
        scrollProps={{
          'aria-label': ariaLabel,
          tabIndex: 0,
          onScroll: (event) => onScroll(event.currentTarget),
        }}
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0 font-mono text-[0.72rem] leading-relaxed">
          {entries.length === 0 ? (
            <li className="text-ink-soft">{emptyText}</li>
          ) : (
            entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2">
                <span className="shrink-0 pt-px tabular-nums text-ink-soft/80">{fmtTime(entry.at)}</span>
                <span className={cn('min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]', levelClass[entry.level] || levelClass.info)}>
                  {entry.text}
                </span>
              </li>
            ))
          )}
        </ul>
      </ScrollArea>
      {/* translate-y-1/2：光带中线贴容器底边（上半渐变/箭头仍在区内，下半被卡片 overflow 裁掉） */}
      {showJump ? (
        <ScrollToLatestCue ariaLabel={jumpLabel} onActivate={scrollToBottom} className="bottom-0 translate-y-1/2" />
      ) : null}
    </div>
  )
}
