'use client'

import { type CSSProperties, forwardRef, type HTMLAttributes, type ReactNode, type Ref, type UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

const INDICATOR_TRACK_PX = 2
const MIN_THUMB_PX = 12
const SCROLL_IDLE_MS = 800

export type ScrollIndicatorAxis = 'vertical' | 'horizontal' | 'both'

export type ScrollAreaProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  scrollClassName?: string
  scrollRef?: Ref<HTMLDivElement>
  scrollProps?: Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'ref' | 'style'>
  /**
   * 隐藏系统条，展示 2px 位置指示器。
   * - `true` / `vertical`：仅纵向（默认）
   * - `horizontal`：仅横向
   * - `both`：纵 + 横
   */
  indicator?: boolean | ScrollIndicatorAxis
  /** 为指示器预留 gutter */
  reserveGutter?: boolean
}

type ThumbState = { offset: number; size: number }
type IndicatorMode = ScrollIndicatorAxis

function resolveIndicatorMode(indicator: boolean | ScrollIndicatorAxis | undefined): IndicatorMode {
  if (indicator === 'horizontal') return 'horizontal'
  if (indicator === 'both') return 'both'
  return 'vertical'
}

function thumbsEqual(a: ThumbState | null, b: ThumbState | null) {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.offset === b.offset && a.size === b.size
}

function computeVerticalThumb(el: HTMLElement): ThumbState | null {
  const { scrollHeight, clientHeight, scrollTop } = el
  if (scrollHeight <= clientHeight + 1) return null
  const thumbSize = Math.max(MIN_THUMB_PX, Math.round((clientHeight / scrollHeight) * clientHeight))
  const maxScroll = scrollHeight - clientHeight
  const thumbOffset = maxScroll <= 0 ? 0 : Math.round((scrollTop / maxScroll) * Math.max(0, clientHeight - thumbSize))
  return { offset: thumbOffset, size: thumbSize }
}

function computeHorizontalThumb(el: HTMLElement): ThumbState | null {
  const { scrollWidth, clientWidth, scrollLeft } = el
  if (scrollWidth <= clientWidth + 1) return null
  const thumbSize = Math.max(MIN_THUMB_PX, Math.round((clientWidth / scrollWidth) * clientWidth))
  const maxScroll = scrollWidth - clientWidth
  const thumbOffset = maxScroll <= 0 ? 0 : Math.round((scrollLeft / maxScroll) * Math.max(0, clientWidth - thumbSize))
  return { offset: thumbOffset, size: thumbSize }
}

function gutterClass(mode: IndicatorMode, reserve: boolean) {
  if (!reserve) return ''
  if (mode === 'both') return 'pr-1 pb-1'
  if (mode === 'horizontal') return 'pb-1'
  return 'pr-1'
}

/** 全站滚动容器：隐藏系统滚动条，使用 2px 非交互位置指示器。 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { children, className, style, scrollClassName, scrollRef, scrollProps, indicator = true, reserveGutter = true },
  forwardedRef
) {
  const { onScroll: userOnScroll, ...restScrollProps } = scrollProps ?? {}
  const innerRef = useRef<HTMLDivElement | null>(null)
  const lastVerticalThumbRef = useRef<ThumbState | null | undefined>(undefined)
  const lastHorizontalThumbRef = useRef<ThumbState | null | undefined>(undefined)
  const rafSyncRef = useRef(0)
  const scrollIdleTimerRef = useRef(0)

  const setScrollElement = useCallback(
    (el: HTMLDivElement | null) => {
      innerRef.current = el
      if (typeof scrollRef === 'function') scrollRef(el)
      else if (scrollRef && 'current' in scrollRef) scrollRef.current = el
    },
    [scrollRef]
  )

  const indicatorMode = resolveIndicatorMode(indicator)
  const showVertical = indicatorMode === 'vertical' || indicatorMode === 'both'
  const showHorizontal = indicatorMode === 'horizontal' || indicatorMode === 'both'

  const [verticalThumb, setVerticalThumb] = useState<ThumbState | null>(null)
  const [horizontalThumb, setHorizontalThumb] = useState<ThumbState | null>(null)
  const [hovered, setHovered] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const showIndicator = hovered || scrolling

  const commitVerticalThumb = useCallback((next: ThumbState | null) => {
    if (lastVerticalThumbRef.current !== undefined && thumbsEqual(lastVerticalThumbRef.current, next)) return
    lastVerticalThumbRef.current = next
    setVerticalThumb(next)
  }, [])

  const commitHorizontalThumb = useCallback((next: ThumbState | null) => {
    if (lastHorizontalThumbRef.current !== undefined && thumbsEqual(lastHorizontalThumbRef.current, next)) return
    lastHorizontalThumbRef.current = next
    setHorizontalThumb(next)
  }, [])

  const markScrolling = useCallback(() => {
    setScrolling(true)
    if (scrollIdleTimerRef.current !== 0) window.clearTimeout(scrollIdleTimerRef.current)
    scrollIdleTimerRef.current = window.setTimeout(() => {
      scrollIdleTimerRef.current = 0
      setScrolling(false)
    }, SCROLL_IDLE_MS)
  }, [])

  const syncThumbs = useCallback(() => {
    const el = innerRef.current
    if (!el) {
      commitVerticalThumb(null)
      commitHorizontalThumb(null)
      return
    }
    commitVerticalThumb(showVertical ? computeVerticalThumb(el) : null)
    commitHorizontalThumb(showHorizontal ? computeHorizontalThumb(el) : null)
  }, [commitHorizontalThumb, commitVerticalThumb, showHorizontal, showVertical])

  const scheduleSyncThumbs = useCallback(() => {
    if (rafSyncRef.current !== 0) return
    rafSyncRef.current = requestAnimationFrame(() => {
      rafSyncRef.current = 0
      syncThumbs()
    })
  }, [syncThumbs])

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      markScrolling()
      scheduleSyncThumbs()
      userOnScroll?.(event)
    },
    [markScrolling, scheduleSyncThumbs, userOnScroll]
  )

  useLayoutEffect(() => {
    syncThumbs()
  }, [syncThumbs, children])

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current !== 0) window.clearTimeout(scrollIdleTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const el = innerRef.current
    if (!el) return

    const ro = new ResizeObserver(() => scheduleSyncThumbs())
    ro.observe(el)
    const mo = new MutationObserver(() => scheduleSyncThumbs())
    mo.observe(el, { childList: true, subtree: true })

    return () => {
      ro.disconnect()
      mo.disconnect()
      if (rafSyncRef.current !== 0) {
        cancelAnimationFrame(rafSyncRef.current)
        rafSyncRef.current = 0
      }
    }
  }, [scheduleSyncThumbs])

  const viewportAxisClass =
    indicatorMode === 'vertical' ? 'overflow-x-hidden overflow-y-auto' : indicatorMode === 'horizontal' ? 'overflow-x-auto overflow-y-hidden' : 'overflow-auto'

  const trackOpacity = showIndicator ? 'opacity-100' : 'opacity-30'

  return (
    <div
      ref={forwardedRef}
      className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        ref={setScrollElement}
        {...restScrollProps}
        onScroll={handleScroll}
        className={cn(
          'min-h-0 min-w-0 flex-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0',
          viewportAxisClass,
          gutterClass(indicatorMode, reserveGutter),
          scrollClassName
        )}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </div>
      {showVertical && verticalThumb ? (
        <div
          className={cn(
            'pointer-events-none absolute top-0 right-0 bottom-0 w-0.5 transition-opacity duration-200 ease-out motion-reduce:transition-none',
            trackOpacity,
            indicatorMode === 'both' && 'bottom-2'
          )}
          aria-hidden
        >
          <div
            className="absolute top-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--ink-soft)_70%,transparent)]"
            style={{ width: INDICATOR_TRACK_PX, height: verticalThumb.size, top: verticalThumb.offset }}
          />
        </div>
      ) : null}
      {showHorizontal && horizontalThumb ? (
        <div
          className={cn(
            'pointer-events-none absolute right-0 bottom-0 left-0 h-0.5 transition-opacity duration-200 ease-out motion-reduce:transition-none',
            trackOpacity,
            indicatorMode === 'both' && 'right-2'
          )}
          aria-hidden
        >
          <div
            className="absolute top-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--ink-soft)_70%,transparent)]"
            style={{ height: INDICATOR_TRACK_PX, width: horizontalThumb.size, left: horizontalThumb.offset }}
          />
        </div>
      ) : null}
    </div>
  )
})

ScrollArea.displayName = 'ScrollArea'
