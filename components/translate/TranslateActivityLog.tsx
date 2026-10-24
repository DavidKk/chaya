'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formDesc, formTitle } from '@/components/layoutClasses'
import { FollowScrollLogList } from '@/components/logs/FollowScrollLogList'
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

/**
 * 不用 formCard 子项统一 padding（会把滚动条挤进内侧）。
 * 标题区自带边距；日志区左右底顶满卡片边，指示条贴右缘。
 */
export function TranslateActivityLog({ entries, liveStatus, sessionDone = 0, className }: Props) {
  const t = useT()

  return (
    <div className={cn('m-0 flex w-full flex-col overflow-hidden rounded-[0.35rem] border border-line bg-panel', className)}>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={cn(formTitle, 'm-0 text-[0.8125rem]')}>{t('translate.activityLogTitle')}</h3>
          <span className="tabular-nums text-[0.7rem] text-ink-soft">{t('translate.activityLogSessionDone', { count: sessionDone.toLocaleString() })}</span>
        </div>
        {liveStatus ? (
          <p className={cn(formDesc, 'mt-2 animate-pulse text-[0.75rem] text-accent')}>{liveStatus}</p>
        ) : (
          <p className={cn(formDesc, 'mt-2')}>{t('translate.activityLogHint')}</p>
        )}
      </div>
      <div className="relative min-h-0 border-t border-[var(--line-soft)]">
        <FollowScrollLogList
          entries={entries}
          ariaLabel={t('translate.loadActivity')}
          emptyText={t('translate.activityLogEmpty')}
          jumpLabel={t('translate.activityLogJumpLatest')}
          heightClassName="h-[28rem]"
        />
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
