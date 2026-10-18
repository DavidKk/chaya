'use client'

import type { RefObject } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { dataTable, logBadgeClass, panelBody, panelFoot } from '@/components/layoutClasses'
import { EmptyState, ScrollArea, TableSkeleton, TruncateText } from '@/components/sk'
import type { LogEntry } from '@/lib/log/types'
import { cn } from '@/lib/utils'

export type LogViewEntry = Omit<LogEntry, 'id'> & { id: string | number }

export function matchesLogQuery(entry: LogViewEntry, query: string) {
  if (!query) return true
  const hay = `${entry.source}\n${entry.message}\n${entry.meta == null ? '' : typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta)}`
  return hay.toLowerCase().includes(query)
}

const logsTable = cn(dataTable, 'min-w-[40rem] font-mono text-xs [--data-list-columns:5.5rem_4.5rem_9rem_minmax(0,1fr)]')

/** Web 与局内日志共用的四列表格加载态。 */
export function LogEntriesSkeleton({ label }: { label?: string }) {
  const t = useT()
  return (
    <div className={panelBody}>
      <TableSkeleton
        label={label ?? t('logs.loadList')}
        tableClassName="min-w-[40rem] font-mono text-xs"
        columns={[{ key: 'time', width: '5.5rem' }, { key: 'level', width: '4.5rem' }, { key: 'source', width: '9rem' }, { key: 'message' }]}
      />
    </div>
  )
}

export function LogEntriesView({
  entries,
  total,
  hasFilter,
  scrollRef,
  ariaLabel,
  status,
  onScroll,
}: {
  entries: readonly LogViewEntry[]
  total: number
  hasFilter: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  ariaLabel: string
  status?: string
  onScroll?: (element: HTMLDivElement) => void
}) {
  const t = useT()
  return (
    <>
      <div className={panelBody}>
        {!entries.length ? (
          <EmptyState
            title={!hasFilter ? t('logs.emptyTitle') : t('logs.noMatchTitle')}
            message={!hasFilter ? t('logs.emptyMsg') : t('logs.noMatchMsg')}
            hint={!hasFilter ? t('logs.emptyHint') : t('logs.noMatchHint')}
          />
        ) : (
          <ScrollArea
            className="min-h-0 flex-1"
            scrollRef={scrollRef}
            indicator="both"
            scrollProps={{
              'aria-label': ariaLabel,
              tabIndex: 0,
              onScroll: onScroll ? (event) => onScroll(event.currentTarget) : undefined,
            }}
          >
            <div role="list" aria-label={ariaLabel} className={logsTable}>
              <div data-list-head="">
                <div role="presentation" data-list-row="">
                  <div data-list-heading="">时间</div>
                  <div data-list-heading="">等级</div>
                  <div data-list-heading="">来源</div>
                  <div data-list-heading="">消息</div>
                </div>
              </div>
              <div data-list-body="">
                {entries.map((entry) => (
                  <div role="listitem" data-list-row="" key={entry.id} data-navigation-id={entry.id}>
                    <div data-list-cell="" className="whitespace-nowrap text-ink-soft tabular-nums" title={new Date(entry.ts).toISOString()}>
                      {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                    </div>
                    <div data-list-cell="">
                      <span className={logBadgeClass(entry.level)}>{entry.level}</span>
                    </div>
                    <div data-list-cell="" className="text-ink-soft">
                      <TruncateText text={entry.source || '—'} className="block" />
                    </div>
                    <div data-list-cell="">
                      <p className="m-0 whitespace-pre-wrap break-words text-ink">{entry.message}</p>
                      {entry.meta != null ? (
                        <p className="m-0 mt-1 break-all text-[0.7rem] leading-[1.35] text-ink-soft">{typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta)}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </div>
      <div className={panelFoot}>
        <span>
          {status || ''}
          {status && hasFilter ? ' · ' : ''}
          {hasFilter ? t('logs.filtered') : ''}
        </span>
        <span>
          {entries.length}
          {hasFilter ? ` / ${total}` : ''}
        </span>
      </div>
    </>
  )
}
