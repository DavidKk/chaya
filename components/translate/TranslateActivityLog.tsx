'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formTitle } from '@/components/layoutClasses'
import { FollowScrollLogList } from '@/components/logs/FollowScrollLogList'
import { TruncateText } from '@/components/sk'
import { formatTranslationFailure, readTranslationFailure } from '@/lib/translate/failure-log'
import type { BatchExecutionSource, TranslationBatchLog, TranslationFailureLog } from '@/lib/translate/runtime-api'
import { cn } from '@/lib/utils'

export type TranslateLogLevel = 'info' | 'ok' | 'warn' | 'fail'

export type TranslateLogEntry = {
  id: number
  at: number
  level: TranslateLogLevel
  text: string
  batch?: TranslationBatchLog
  failure?: TranslationFailureLog
}

type Props = {
  entries: TranslateLogEntry[]
  liveStatus?: string
  sessionDone?: number
  className?: string
}

function sourceLabel(source: BatchExecutionSource, t: ReturnType<typeof useT>): string {
  if (source === 'cache') return t('translate.batchLogCache')
  if (source === 'apple') return t('translate.batchLogApple')
  if (source === 'agent') return t('translate.batchLogAgent')
  if (source === 'platform') return t('translate.batchLogPlatform')
  if (source === 'bergamot') return 'Bergamot'
  if (source === 'ollama') return 'Ollama'
  return t('translate.batchLogUnknown')
}

/**
 * 不用 formCard 子项统一 padding（会把滚动条挤进内侧）。
 * 标题区自带边距；日志区左右底顶满卡片边，指示条贴右缘。
 */
export function TranslateActivityLog({ entries, liveStatus, sessionDone = 0, className }: Props) {
  const t = useT()

  return (
    <div className={cn('m-0 flex w-full flex-col overflow-hidden rounded-[0.35rem] border border-line bg-panel', className)}>
      <div className="flex min-w-0 items-baseline justify-between gap-3 px-4 py-2">
        <h3 className={cn(formTitle, 'm-0 shrink-0 text-[0.8125rem]')}>{t('translate.activityLogTitle')}</h3>
        <TruncateText
          text={liveStatus || t('translate.activityLogSessionDone', { count: sessionDone.toLocaleString() })}
          className={cn('text-right text-[0.7rem] tabular-nums', liveStatus ? 'animate-pulse text-[0.75rem] text-accent' : 'text-ink-soft')}
        />
      </div>
      <div className="relative min-h-0 border-t border-[var(--line-soft)]">
        <FollowScrollLogList
          entries={entries.map((entry) => {
            if (!entry.batch) {
              const failure = entry.failure ?? readTranslationFailure(entry.text)
              return failure ? { ...entry, text: formatTranslationFailure(failure, t), detail: entry.text } : entry
            }
            const batch = entry.batch
            const submitted = Array.isArray(batch.submittedSources) ? batch.submittedSources : []
            const final = Array.isArray(batch.finalSources)
              ? batch.finalSources
              : Array.isArray((batch as unknown as { engines?: string[] }).engines)
                ? (batch as unknown as { engines: string[] }).engines.map((e) => (e.startsWith('cache') ? ('cache' as const) : ('unknown' as const)))
                : []
            const cacheHits =
              typeof batch.cacheHits === 'number'
                ? batch.cacheHits
                : typeof (batch as unknown as { cache?: number }).cache === 'number'
                  ? (batch as unknown as { cache: number }).cache
                  : 0
            const key = batch.failed === 0 ? 'translate.batchLogComplete' : batch.success === 0 ? 'translate.batchLogFailed' : 'translate.batchLogPartial'
            // The user-facing label follows the tool that actually produced the accepted result.
            // Submitted engines are diagnostic data only; failed batches fall back to attempts.
            const sources = [...(final.length ? final : submitted), ...(batch.cacheUnavailable && !final.length ? (['cache:unavailable'] as const) : [])]
            const engine =
              [...new Set(sources)].map((source) => (source === 'cache:unavailable' ? t('translate.batchLogCacheUnavailable') : sourceLabel(source, t))).join('+') ||
              t('translate.batchLogCache')
            // A pure-cache label already conveys that every accepted item came from cache.
            const cacheInfo = cacheHits > 0 && cacheHits !== batch.success ? t('translate.batchLogCacheInfo', { cache: cacheHits }) : ''
            return {
              ...entry,
              level: batch.failed === 0 ? 'ok' : batch.success === 0 ? 'fail' : 'warn',
              text: t(key, {
                batch: batch.batch,
                success: batch.success,
                total: batch.total,
                failed: batch.failed,
                chars: batch.chars,
                cache: cacheHits,
                cache_info: cacheInfo,
                engine,
              }),
            }
          })}
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
