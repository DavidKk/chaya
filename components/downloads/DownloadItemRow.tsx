'use client'

import { useLocale } from '@/components/i18n/LocaleProvider'
import { etaSeconds, formatDuration } from '@/lib/downloads/rate'
import { type DownloadItem, itemPercent } from '@/lib/downloads/store'
import { formatBytes } from '@/lib/format-bytes'
import type { MessageKey } from '@/lib/i18n'

/** 进行中任务的一行：只展示信息，不提供操作 */
export function DownloadItemRow({ item }: { item: DownloadItem }) {
  const { t } = useLocale()

  const title = item.version ? t('downloads.nwShell', { version: item.version }) : t('downloads.nwShellUnknown')
  const channel = item.channel === 'server' ? t('downloads.channelServer') : t('downloads.channelBrowser')
  const percent = itemPercent(item)

  const details: string[] = []
  if (item.phase === 'write' && item.totalCount != null) {
    details.push(t('downloads.files', { done: item.doneCount ?? 0, total: item.totalCount }))
  } else if (item.receivedBytes != null) {
    const received = formatBytes(item.receivedBytes) ?? '0 B'
    details.push(item.totalBytes ? t('downloads.size', { received, total: formatBytes(item.totalBytes) ?? '' }) : received)
    if (item.rate) details.push(t('downloads.speed', { speed: formatBytes(Math.round(item.rate)) ?? '' }))
    const eta = etaSeconds(item.receivedBytes, item.totalBytes, item.rate)
    if (eta != null) details.push(t('downloads.eta', { eta: formatDuration(eta) }))
    if (item.resumedFrom) details.push(t('downloads.resumedFrom', { size: formatBytes(item.resumedFrom) ?? '' }))
  }
  const hint = item.phase === 'awaitFile' && item.archiveName ? t('downloads.awaitFileHint', { name: item.archiveName }) : null

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[0.8125rem] font-medium text-ink">{title}</span>
        <span className="shrink-0 text-[0.75rem] text-ink-soft">{t(`downloads.phase.${item.phase}` as MessageKey)}</span>
      </div>
      <div className="truncate text-[0.75rem] text-ink-soft">{item.gameName ? `${channel} · ${item.gameName}` : channel}</div>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-busy={percent == null || undefined}
        className="h-1.5 overflow-hidden rounded-full bg-inset"
      >
        {percent == null ? (
          <div className="h-full w-full animate-pulse rounded-full bg-accent/55" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
        )}
      </div>
      {details.length ? <div className="text-[0.75rem] tabular-nums text-ink-soft">{details.join(' · ')}</div> : null}
      {hint ? <div className="text-[0.75rem] text-ink-soft">{hint}</div> : null}
    </li>
  )
}
