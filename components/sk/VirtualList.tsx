'use client'

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export type VirtualListProps = {
  count: number
  /** Fixed row height in px */
  rowHeight: number
  renderRow: (index: number) => ReactNode
  /** Rows rendered beyond the viewport on each side */
  overscan?: number
  /** Visible range incl. overscan, `end` exclusive */
  onRangeChange?: (start: number, end: number) => void
  /** Called when the last rows come into view */
  onEndReached?: () => void
  header?: ReactNode
  className?: string
  'aria-label'?: string
}

/** Fixed-height virtual list on a native scroll container; only rows near the viewport are mounted */
export function VirtualList({ count, rowHeight, renderRow, overscan = 8, onRangeChange, onEndReached, header, className, 'aria-label': ariaLabel }: VirtualListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0, headerHeight: 0 })

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const headerHeight = headerRef.current?.offsetHeight ?? 0
    setViewport((prev) =>
      prev.top === el.scrollTop && prev.height === el.clientHeight && prev.headerHeight === headerHeight ? prev : { top: el.scrollTop, height: el.clientHeight, headerHeight }
    )
  }, [])

  useLayoutEffect(() => {
    measure()
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (headerRef.current) ro.observe(headerRef.current)
    return () => ro.disconnect()
  }, [measure])

  const bodyTop = Math.max(0, viewport.top - viewport.headerHeight)
  const first = Math.floor(bodyTop / rowHeight)
  const visibleCount = Math.ceil((viewport.height || rowHeight * 20) / rowHeight) + 1
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, first + visibleCount + overscan)

  const rangeRef = useRef(onRangeChange)
  rangeRef.current = onRangeChange
  useEffect(() => {
    rangeRef.current?.(start, end)
  }, [start, end])

  const endRef = useRef(onEndReached)
  endRef.current = onEndReached
  useEffect(() => {
    if (count > 0 && end >= count - overscan) endRef.current?.()
  }, [end, count, overscan])

  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    rows.push(
      <div key={i} role="listitem" className="absolute inset-x-0" style={{ top: i * rowHeight, height: rowHeight }}>
        {renderRow(i)}
      </div>
    )
  }

  return (
    <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-auto overscroll-contain', className)} onScroll={measure} role="list" aria-label={ariaLabel}>
      {header ? (
        <div ref={headerRef} className="sticky top-0 z-[2]">
          {header}
        </div>
      ) : null}
      <div className="relative" style={{ height: count * rowHeight }}>
        {rows}
      </div>
    </div>
  )
}
