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

const logsTable = cn(
  dataTable,
  'min-w-[40rem] font-mono text-xs',
  '[&_th:nth-child(1)]:w-[5.5rem] [&_td:nth-child(1)]:w-[5.5rem]',
  '[&_th:nth-child(2)]:w-[4.5rem] [&_th:nth-child(2)]:text-center [&_td:nth-child(2)]:w-[4.5rem] [&_td:nth-child(2)]:text-center',
  '[&_th:nth-child(3)]:w-36 [&_td:nth-child(3)]:w-36',
  '[&_td]:max-w-none [&_td]:align-middle'
)

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
            <table className={logsTable}>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>等级</th>
                  <th>来源</th>
                  <th>消息</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-ink-soft tabular-nums" title={new Date(entry.ts).toISOString()}>
                      {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                    </td>
                    <td>
                      <span className={logBadgeClass(entry.level)}>{entry.level}</span>
                    </td>
                    <td className="text-ink-soft">
                      <TruncateText text={entry.source || '—'} className="block" />
                    </td>
                    <td>
                      <p className="m-0 whitespace-pre-wrap break-words text-ink">{entry.message}</p>
                      {entry.meta != null ? (
                        <p className="m-0 mt-1 break-all text-[0.7rem] leading-[1.35] text-ink-soft">{typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta)}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
