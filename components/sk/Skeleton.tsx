import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react'

import { dataTable, editCell, editHeadCell } from '@/components/layoutClasses'
import { cn } from '@/lib/utils'

type SkeletonProps = ComponentPropsWithoutRef<'div'>

const skeletonBase = 'block rounded-[0.25rem] bg-[color-mix(in_oklab,var(--panel-2)_55%,var(--mist))] animate-pulse motion-reduce:animate-none motion-reduce:opacity-70'

/** 单块占位；尊重 prefers-reduced-motion（CSS）。 */
export function Skeleton({ className, ...rest }: SkeletonProps) {
  return <div aria-hidden className={cn(skeletonBase, className)} {...rest} />
}

type SkeletonRegionProps = {
  label: string
  children: ReactNode
  className?: string
}

/** 骨架区域：aria-busy + 读屏文案。 */
export function SkeletonRegion({ label, children, className }: SkeletonRegionProps) {
  return (
    <div aria-busy="true" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export type TableSkeletonColumn = {
  key: string
  /** 列宽提示，如 `5.5rem` */
  width?: string
}

type TableSkeletonProps = {
  columns: TableSkeletonColumn[]
  rows?: number
  label?: string
  className?: string
  tableClassName?: string
}

/** 表形骨架：与 dataTable / 日志表同一套表头与单元格样式。 */
export function TableSkeleton({ columns, rows = 8, label = '加载中', className, tableClassName }: TableSkeletonProps) {
  return (
    <SkeletonRegion label={label} className={cn('min-h-0 flex-1 overflow-hidden', className)}>
      <table className={cn(dataTable, tableClassName)} aria-hidden>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? ({ width: col.width } as CSSProperties) : undefined}>
                <Skeleton className="h-[0.55rem] max-w-full w-[3.25rem]" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {columns.map((col, colIndex) => (
                <td key={col.key}>
                  <Skeleton className="h-[0.7rem] max-w-full" style={{ width: `${52 + ((row + colIndex) % 5) * 9}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </SkeletonRegion>
  )
}

type EditTableSkeletonProps = {
  rows?: number
  label?: string
  className?: string
  /** 与 GameEdit 表一致：`grid-cols-[2.75rem_minmax(0,1fr)_max-content]` */
  colsClassName?: string
}

const editSkeletonCols = 'grid-cols-[2.75rem_minmax(0,1fr)_max-content]'

/** GameEdit 目录表骨架：CSS grid 行，对齐真实编辑表拓扑。 */
export function EditTableSkeleton({ rows = 10, label = '加载中', className, colsClassName = editSkeletonCols }: EditTableSkeletonProps) {
  return (
    <SkeletonRegion label={label} className={cn('min-h-0 flex-1 overflow-hidden', className)}>
      <div className="min-w-[36rem] text-[0.8125rem]" role="presentation" aria-hidden>
        <div className={cn('sticky top-0 z-[3] grid items-center border-b border-line bg-paper-2', colsClassName)}>
          <div className={editHeadCell}>
            <Skeleton className="h-[0.55rem] w-5" />
          </div>
          <div className={editHeadCell}>
            <Skeleton className="h-[0.55rem] w-8" />
          </div>
          <div className={cn(editHeadCell, 'flex justify-center')}>
            <Skeleton className="h-[0.55rem] w-8" />
          </div>
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className={cn('grid items-center border-t border-line', colsClassName, row === 0 && 'border-t-0')}>
            <div className={editCell}>
              <Skeleton className="h-[0.75rem] w-5" />
            </div>
            <div className={cn(editCell, 'min-w-0')}>
              <div className="flex h-[2.35rem] min-w-0 flex-col justify-center gap-0.5">
                <Skeleton className="h-[0.8125rem]" style={{ width: `${48 + (row % 4) * 12}%` }} />
                {row % 3 !== 0 ? <Skeleton className="h-[0.7rem]" style={{ width: `${36 + (row % 3) * 14}%` }} /> : null}
              </div>
            </div>
            <div className={cn(editCell, 'flex justify-center')}>
              <Skeleton className="h-8 w-[7.25rem] rounded-[0.25rem]" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}
