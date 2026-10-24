'use client'

import { formDesc, formTitle } from '@/components/layoutClasses'
import { FollowScrollLogList } from '@/components/logs/FollowScrollLogList'
import { useAnimatedNumber } from '@/components/translate/useAnimatedNumber'
import { cn } from '@/lib/utils'

export type TranslateLogLevel = 'info' | 'ok' | 'warn' | 'fail'

export type TranslateLogEntry = {
  id: number
  at: number
  level: TranslateLogLevel
  text: string
}

type Props = {
  entries: TranslateLogEntry[]
  liveStatus?: string
  sessionDone?: number
  className?: string
}

function AnimatedSessionDone({ value }: { value: number }) {
  const n = useAnimatedNumber(value, 1500)
  return <>{n.toLocaleString()}</>
}

/**
 * 不用 formCard 子项统一 padding（会把滚动条挤进内侧）。
 * 标题区自带边距；日志区左右底顶满卡片边，指示条贴右缘。
 */
export function TranslateActivityLog({ entries, liveStatus, sessionDone = 0, className }: Props) {
  return (
    <div className={cn('m-0 flex w-full flex-col overflow-hidden rounded-[0.35rem] border border-line bg-panel', className)}>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={cn(formTitle, 'm-0 text-[0.8125rem]')}>Activity log</h3>
          <span className="tabular-nums text-[0.7rem] text-ink-soft">
            Translated this session: <AnimatedSessionDone value={sessionDone} />
          </span>
        </div>
        {liveStatus ? (
          <p className={cn(formDesc, 'mt-2 animate-pulse text-[0.75rem] text-accent')}>{liveStatus}</p>
        ) : (
          <p className={cn(formDesc, 'mt-2')}>Start translation to see progress and sample entries.</p>
        )}
      </div>
      <div className="relative min-h-0 border-t border-[var(--line-soft)]">
        <FollowScrollLogList entries={entries} ariaLabel="Translation activity log" emptyText="No activity yet" jumpLabel="Jump to latest" heightClassName="h-[28rem]" />
      </div>
    </div>
  )
}

export function clipLogText(text: string, max = 48): string {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}
