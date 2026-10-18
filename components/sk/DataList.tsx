'use client'
import type { CSSProperties, ReactNode } from 'react'

import { dataList } from '@/components/layoutClasses'
import { SortableTh } from '@/components/sk/SortableTh'
import type { ThreeStateSortDir } from '@/lib/ui/three-state-sort'
import { cn } from '@/lib/utils'

export type DataListColumn<SortKey extends string = string> = { key: string; label: string; width?: string; align?: 'left' | 'right'; sortKey?: SortKey }
export type DataListSortState<SortKey extends string = string> = { key: SortKey; order: ThreeStateSortDir; explicit: boolean }
export type DataListProps<SortKey extends string = string> = {
  columns: readonly DataListColumn<SortKey>[]
  children: ReactNode
  className?: string
  sort?: DataListSortState<SortKey>
  onSortCycle?: (key: SortKey) => void
  disabled?: boolean
  'aria-label'?: string
}

/** Shared dense list. Column widths are inherited by every row, including the sticky heading. */
export function DataList<SortKey extends string = string>({ columns, children, className, sort, onSortCycle, disabled, 'aria-label': label }: DataListProps<SortKey>) {
  const style = { '--data-list-columns': columns.map((c) => c.width || 'minmax(0,1fr)').join(' ') } as CSSProperties
  return (
    <div role="list" aria-label={label || columns.map((c) => c.label).join(' / ')} className={cn(dataList, className)} style={style}>
      <div data-list-head="">
        <div data-list-row="" role="presentation">
          {columns.map((c) =>
            c.sortKey && sort && onSortCycle ? (
              <SortableTh
                key={c.key}
                className={c.align === 'right' ? 'text-right' : undefined}
                label={c.label}
                active={sort.explicit && sort.key === c.sortKey}
                order={sort.order}
                onCycle={() => onSortCycle(c.sortKey!)}
                disabled={disabled}
              />
            ) : (
              <div key={c.key} data-list-heading="" className={c.align === 'right' ? 'text-right' : undefined}>
                {c.label}
              </div>
            )
          )}
        </div>
      </div>
      <div data-list-body="">{children}</div>
    </div>
  )
}
