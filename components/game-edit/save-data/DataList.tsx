'use client'

import { type ReactNode, type RefObject, useLayoutEffect, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { VirtualList } from '@/components/sk'
import type { DataCell, DataPath, DataRow } from '@/lib/game/save-data'
import { cn } from '@/lib/utils'

import { DATA_COLS, DataRowView, ROW_HEIGHT, ROW_HEIGHT_NARROW, type RowMenuItem } from './DataRowView'

export type ListItem = { key: string; path: DataPath; ownerOid: number; row: DataRow; where?: ReactNode }

export type RowHandlers = {
  onOpen: (path: DataPath) => void
  onApply: (key: string) => void
  onLock: (path: DataPath, ownerOid: number, on: boolean, label?: string) => void
  onReadFull: (path: DataPath) => Promise<DataCell | null>
  menu: (path: DataPath, row: DataRow, ownerOid: number) => RowMenuItem[]
}

const NARROW_PX = 640

/** Narrow layout (two-line rows) below 640px of container width */
export function useNarrow(ref: RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setNarrow(el.clientWidth < NARROW_PX)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return narrow
}

export function DataListHeader({ narrow, className }: { narrow: boolean; className?: string }) {
  const t = useT()
  if (narrow) return null
  return (
    <div className={cn('grid h-8 items-center gap-3 border-b border-line bg-paper-2 px-3 text-[0.7rem] font-medium text-ink-soft', DATA_COLS, className)} role="presentation">
      <span>{t('data.colName')}</span>
      <span className="px-1">{t('data.colCurrent')}</span>
      <span>{t('data.colTarget')}</span>
      <span className="text-right">{t('data.colActions')}</span>
    </div>
  )
}

type Props = RowHandlers & {
  items: ListItem[]
  narrow: boolean
  lockedKeys: Set<string>
  canEdit: boolean
  onRange?: (start: number, end: number) => void
  onEndReached?: () => void
  footer?: ReactNode
  /** Extra first row before the fields (the 常用 entry at the root) */
  lead?: ReactNode
  className?: string
}

/** Virtualized field list; only rows near the viewport are mounted (and watched, via `onRange`) */
export function DataList({ items, narrow, lockedKeys, canEdit, onRange, onEndReached, footer, lead, className, ...handlers }: Props) {
  const t = useT()
  const offset = lead ? 1 : 0
  const count = offset + items.length + (footer ? 1 : 0)
  const clamp = (i: number) => Math.min(Math.max(0, i - offset), items.length)
  return (
    <VirtualList
      count={count}
      rowHeight={narrow ? ROW_HEIGHT_NARROW : ROW_HEIGHT}
      header={<DataListHeader narrow={narrow} />}
      onRangeChange={onRange ? (start, end) => onRange(clamp(start), clamp(end)) : undefined}
      onEndReached={onEndReached}
      aria-label={t('data.listAria')}
      className={className}
      renderRow={(index) => {
        if (lead && index === 0) return lead
        const item = items[index - offset]
        if (!item) return <div className="flex h-full items-center justify-center text-xs text-ink-soft">{footer}</div>
        return (
          <DataRowView
            key={item.key}
            row={item.row}
            rowKey={item.key}
            path={item.path}
            ownerOid={item.ownerOid}
            where={item.where}
            narrow={narrow}
            locked={lockedKeys.has(item.key)}
            canEdit={canEdit}
            {...handlers}
          />
        )
      }}
    />
  )
}
