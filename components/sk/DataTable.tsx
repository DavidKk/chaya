'use client'

import type { ReactNode } from 'react'

import { dataTable } from '@/components/layoutClasses'
import { SortableTh } from '@/components/sk/SortableTh'
import type { ThreeStateSortDir } from '@/lib/ui/three-state-sort'
import { cn } from '@/lib/utils'

export type DataTableColumn<SortKey extends string = string> = {
  key: string
  label: string
  width?: string
  /** 传入则该列表头可三态排序 */
  sortKey?: SortKey
}

export type DataTableSortState<SortKey extends string = string> = {
  key: SortKey
  order: ThreeStateSortDir
  explicit: boolean
}

export type DataTableProps<SortKey extends string = string> = {
  columns: readonly DataTableColumn<SortKey>[]
  children: ReactNode
  className?: string
  /** 当前排序；不传则所有列普通表头 */
  sort?: DataTableSortState<SortKey>
  /** 点击可排序列时回调（通常接 cycleThreeStateSort） */
  onSortCycle?: (key: SortKey) => void
  disabled?: boolean
}

/**
 * 数据表壳：`dataTable` 样式 + 可选三态排序表头。
 * 行内容由调用方渲染在 children（放在 `<tbody>` 内）。
 */
export function DataTable<SortKey extends string = string>({ columns, children, className, sort, onSortCycle, disabled }: DataTableProps<SortKey>) {
  const sortable = Boolean(sort && onSortCycle)
  return (
    <table className={cn(dataTable, className)}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={c.width != null ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => {
            const sortKey = c.sortKey
            if (!sortable || !sortKey || !sort || !onSortCycle) {
              return <th key={c.key}>{c.label}</th>
            }
            return (
              <SortableTh key={c.key} label={c.label} active={sort.explicit && sort.key === sortKey} order={sort.order} disabled={disabled} onCycle={() => onSortCycle(sortKey)} />
            )
          })}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}
