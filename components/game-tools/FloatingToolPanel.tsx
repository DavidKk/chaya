'use client'

import { Pin } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { IoCloseOutline, IoExpandOutline, IoRemoveOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea } from '@/components/sk'
import { cn } from '@/lib/utils'

import {
  clamp,
  clampPosition,
  type Frame,
  GUTTER,
  type Placement,
  placementFromFrame,
  positionFromPlacement,
  readPlacement,
  type Size,
  type Viewport,
  viewport,
  writePlacement,
} from './floating-placement'
import { keepGameFocus, stopGameKeys } from './game-keys'
import { type MiniPanelId, TOOL_PANEL_FRAME, TOOL_PANEL_SIZE } from './tool-panels'

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type GestureKind = 'move' | ResizeEdge
const HEADER_HEIGHT = 32
const PANEL_LAYOUT_EVENT = 'chaya:floating-panel-layout'
type Side = 'left' | 'right'
const mountedPanels = new Map<string, { side: Side; edge: 'top' | 'bottom'; height: number; offset: number }>()
type Props = {
  title: string
  children: ReactNode
  headerTools?: ReactNode
  onClose: () => void
  /** 位置、尺寸与存储 key 取自 `TOOL_PANEL_FRAME`；同侧上下两个面板放不下时各占一半高度 */
  panel: MiniPanelId
  className?: string
  scrollContent?: boolean
}

function sizeRange(minimum: number, maximum: number, available: number) {
  const high = Math.max(1, Math.min(maximum, available))
  return { low: Math.min(minimum, high), high }
}

function headerHeight() {
  return window.matchMedia('(hover: none)').matches ? 44 : HEADER_HEIGHT
}

function defaultPlacement(edge: 'top' | 'bottom', size: Size, side: Side): Placement {
  return { version: 2, width: size.width, height: size.height, x: side === 'left' ? { mode: 'ratio', value: 0 } : { mode: 'right', value: 16 }, y: { mode: edge, value: 16 } }
}

function shouldStack(area: Viewport, side: Side) {
  const panels = [...mountedPanels.values()].filter((panel) => panel.side === side)
  const top = panels.find((panel) => panel.edge === 'top')
  const bottom = panels.find((panel) => panel.edge === 'bottom')
  return !!top && !!bottom && area.height < top.offset + top.height + bottom.height + bottom.offset + GUTTER
}

function panelRegistration(side: Side, edge: 'top' | 'bottom', placement: Placement, minimized: boolean) {
  return { side, edge, height: minimized ? headerHeight() : placement.height, offset: placement.y.mode === edge ? Math.max(GUTTER, placement.y.value) : 16 }
}

function layoutFrame(placement: Placement, area: Viewport, side: Side, edge: 'top' | 'bottom', minimized: boolean, minSize: Size, maxSize: Size): Frame {
  const stacked = shouldStack(area, side)
  const widthRange = sizeRange(minSize.width, maxSize.width, area.width - GUTTER * 2)
  const heightLimit = stacked ? Math.floor((area.height - GUTTER * 3) / 2) : area.height - GUTTER * 2
  const heightRange = sizeRange(minSize.height, maxSize.height, heightLimit)
  const width = clamp(placement.width, widthRange.low, widthRange.high)
  const height = clamp(placement.height, heightRange.low, heightRange.high)
  const visibleHeight = minimized ? Math.min(height, headerHeight()) : height
  const size = { width, height: visibleHeight }
  const position = positionFromPlacement(placement, size, area)
  const y = stacked ? (edge === 'top' ? area.top + GUTTER : area.top + area.height - visibleHeight - GUTTER) : position.y
  return { ...clampPosition({ x: position.x, y }, size, area), width, height }
}

function resizeFrame(frame: Frame, edge: ResizeEdge, dx: number, dy: number, minSize: Size, maxSize: Size, area: Viewport): Frame {
  const next = { ...frame }
  if (edge.includes('e')) {
    const range = sizeRange(minSize.width, maxSize.width, area.left + area.width - frame.x - GUTTER)
    next.width = clamp(frame.width + dx, range.low, range.high)
  } else if (edge.includes('w')) {
    const right = frame.x + frame.width
    const range = sizeRange(minSize.width, maxSize.width, right - area.left - GUTTER)
    next.width = clamp(frame.width - dx, range.low, range.high)
    next.x = right - next.width
  }
  if (edge.includes('s')) {
    const range = sizeRange(minSize.height, maxSize.height, area.top + area.height - frame.y - GUTTER)
    next.height = clamp(frame.height + dy, range.low, range.high)
  } else if (edge.includes('n')) {
    const bottom = frame.y + frame.height
    const range = sizeRange(minSize.height, maxSize.height, bottom - area.top - GUTTER)
    next.height = clamp(frame.height - dy, range.low, range.high)
    next.y = bottom - next.height
  }
  return next
}

const RESIZE_HANDLES: Array<{ edge: ResizeEdge; className: string }> = [
  { edge: 'n', className: 'top-0 left-3 right-3 h-2 cursor-ns-resize' },
  { edge: 's', className: 'bottom-0 left-3 right-3 h-2 cursor-ns-resize' },
  { edge: 'e', className: 'top-3 right-0 bottom-3 w-2 cursor-ew-resize' },
  { edge: 'w', className: 'top-3 left-0 bottom-3 w-2 cursor-ew-resize' },
  { edge: 'ne', className: 'top-0 right-0 h-3 w-3 cursor-nesw-resize' },
  { edge: 'nw', className: 'top-0 left-0 h-3 w-3 cursor-nwse-resize' },
  { edge: 'se', className: 'right-0 bottom-0 h-3 w-3 cursor-nwse-resize' },
  { edge: 'sw', className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
]

export function FloatingToolPanel({ title, children, headerTools, onClose, panel, className, scrollContent = true }: Props) {
  const { storageKey, edge: initialEdge, side: initialSide, defaultSize } = TOOL_PANEL_FRAME[panel]
  const { min: minSize, max: maxSize } = TOOL_PANEL_SIZE
  const t = useT()
  const [frame, setFrame] = useState<Frame | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [pinned, setPinned] = useState(false)
  const frameRef = useRef<Frame | null>(null)
  const placementRef = useRef<Placement | null>(null)
  const loadedKeyRef = useRef('')
  const panelRef = useRef<HTMLElement>(null)
  const gesture = useRef<{ kind: GestureKind; pointerId: number; x: number; y: number; frame: Frame } | null>(null)
  const defaultWidth = defaultSize.width
  const defaultHeight = defaultSize.height
  const minWidth = minSize.width
  const minHeight = minSize.height
  const maxWidth = maxSize.width
  const maxHeight = maxSize.height

  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) {
      placementRef.current = readPlacement(storageKey, defaultPlacement(initialEdge, { width: defaultWidth, height: defaultHeight }, initialSide), initialEdge)
      loadedKeyRef.current = storageKey
    }
    const placement = placementRef.current ?? defaultPlacement(initialEdge, { width: defaultWidth, height: defaultHeight }, initialSide)
    placementRef.current = placement
    const relayout = () => {
      if (gesture.current || !placementRef.current) return
      const next = layoutFrame(
        placementRef.current,
        viewport(),
        initialSide,
        initialEdge,
        minimized,
        { width: minWidth, height: minHeight },
        { width: maxWidth, height: maxHeight }
      )
      frameRef.current = next
      setFrame(next)
    }
    mountedPanels.set(storageKey, panelRegistration(initialSide, initialEdge, placement, minimized))
    window.dispatchEvent(new Event(PANEL_LAYOUT_EVENT))
    window.addEventListener(PANEL_LAYOUT_EVENT, relayout)
    window.addEventListener('resize', relayout)
    window.visualViewport?.addEventListener('resize', relayout)
    window.visualViewport?.addEventListener('scroll', relayout)
    relayout()
    return () => {
      mountedPanels.delete(storageKey)
      window.dispatchEvent(new Event(PANEL_LAYOUT_EVENT))
      window.removeEventListener(PANEL_LAYOUT_EVENT, relayout)
      window.removeEventListener('resize', relayout)
      window.visualViewport?.removeEventListener('resize', relayout)
      window.visualViewport?.removeEventListener('scroll', relayout)
    }
  }, [storageKey, initialEdge, initialSide, defaultWidth, defaultHeight, minWidth, minHeight, maxWidth, maxHeight, minimized])

  const saveFrame = (next: Frame, preserveSize = false) => {
    const visibleHeight = minimized ? Math.min(next.height, headerHeight()) : next.height
    const placement = placementFromFrame(next, viewport(), initialEdge, visibleHeight)
    if (preserveSize && placementRef.current) {
      placement.width = placementRef.current.width
      placement.height = placementRef.current.height
    }
    placementRef.current = placement
    mountedPanels.set(storageKey, panelRegistration(initialSide, initialEdge, placement, minimized))
    writePlacement(storageKey, placement)
    window.dispatchEvent(new Event(PANEL_LAYOUT_EVENT))
  }

  useEffect(() => {
    try {
      setPinned(localStorage.getItem(`${storageKey}.pinned`) === 'true')
    } catch {
      setPinned(false)
    }
  }, [storageKey])

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    try {
      localStorage.setItem(`${storageKey}.pinned`, String(next))
    } catch {
      // The pin still works for this session when storage is unavailable.
    }
  }

  const pinLabel = t(pinned ? 'common.panelUnpin' : 'common.panelPin')

  const begin = (event: PointerEvent<HTMLElement>, kind: GestureKind) => {
    if (event.button !== 0) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    event.stopPropagation()
    const current = frameRef.current || { x: rect.left, y: rect.top, width: rect.width, height: minimized ? defaultSize.height : rect.height }
    gesture.current = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, frame: current }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (drag.kind !== 'move') {
      const next = resizeFrame(drag.frame, drag.kind, dx, dy, minSize, maxSize, viewport())
      frameRef.current = next
      setFrame(next)
      return
    }
    const { width, height } = drag.frame
    const area = viewport()
    const x = clamp(drag.frame.x + dx, area.left + GUTTER, Math.max(area.left + GUTTER, area.left + area.width - width - GUTTER))
    const collapsedHeight = headerHeight()
    const visibleHeight = minimized ? collapsedHeight : height
    const y = clamp(drag.frame.y + dy, area.top + GUTTER, Math.max(area.top + GUTTER, area.top + area.height - visibleHeight - GUTTER))
    const next = { x, y, width, height }
    frameRef.current = next
    setFrame(next)
  }

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLElement>, edge: ResizeEdge) => {
    const step = event.shiftKey ? 25 : 10
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    if ((!dx && !dy) || (dx && !edge.includes('e') && !edge.includes('w')) || (dy && !edge.includes('n') && !edge.includes('s'))) return
    event.preventDefault()
    event.stopPropagation()
    const rect = panelRef.current?.getBoundingClientRect()
    const current = frameRef.current || (rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null)
    if (!current) return
    const next = resizeFrame(current, edge, dx, dy, minSize, maxSize, viewport())
    frameRef.current = next
    setFrame(next)
    saveFrame(next)
  }

  const end = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current
    if (drag?.pointerId !== event.pointerId) return
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (frameRef.current) saveFrame(frameRef.current, drag.kind === 'move')
  }

  return (
    <section
      ref={panelRef}
      className={cn(
        'pointer-events-auto fixed z-[60] flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-md bg-panel/95 text-ink shadow-lg',
        'transition-opacity duration-150',
        !pinned && 'opacity-40 hover:opacity-100 [&:has(:focus-visible)]:opacity-100 [@media(hover:none)]:focus-within:opacity-100',
        className
      )}
      data-pinned={pinned}
      style={{
        ...(frame ? { left: frame.x, top: frame.y } : { ...(initialSide === 'left' ? { left: 8 } : { right: 16 }), ...(initialEdge === 'top' ? { top: 16 } : { bottom: 16 }) }),
        width: frame?.width ?? `min(${defaultSize.width}px, calc(100vw - 16px))`,
        height: minimized ? 'auto' : (frame?.height ?? `min(${defaultSize.height}px, calc(100dvh - 16px))`),
      }}
      aria-label={title}
    >
      <div
        className="flex h-8 shrink-0 touch-none cursor-grab items-center gap-0.5 bg-panel-2 pr-1.5 pl-2.5 select-none active:cursor-grabbing [@media(hover:none)]:h-11"
        onPointerDown={(event) => begin(event, 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <strong className="min-w-0 flex-1 truncate text-xs">{title}</strong>
        {headerTools ? (
          <div className="flex shrink-0 items-center gap-1" onPointerDown={(event) => event.stopPropagation()}>
            {headerTools}
          </div>
        ) : null}
        <Button
          size="mini"
          variant="plain"
          className={cn('[@media(hover:none)]:h-11 [@media(hover:none)]:w-11', pinned && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent')}
          aria-label={pinLabel}
          aria-pressed={pinned}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={keepGameFocus}
          onKeyDown={stopGameKeys}
          onClick={togglePin}
        >
          <Pin size={13} fill={pinned ? 'currentColor' : 'none'} aria-hidden />
        </Button>
        <Button
          size="mini"
          variant="plain"
          className="[@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
          aria-label={t(minimized ? 'common.panelExpand' : 'common.panelMinimize')}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={keepGameFocus}
          onKeyDown={stopGameKeys}
          onClick={() => setMinimized((value) => !value)}
        >
          {minimized ? <IoExpandOutline size={14} aria-hidden /> : <IoRemoveOutline size={14} aria-hidden />}
        </Button>
        <Button
          size="mini"
          variant="plain"
          className="[@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
          aria-label={t('common.close')}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={keepGameFocus}
          onKeyDown={stopGameKeys}
          onClick={onClose}
        >
          <IoCloseOutline size={15} aria-hidden />
        </Button>
      </div>
      {!minimized ? (
        <>
          {scrollContent ? (
            <ScrollArea className="min-h-0 flex-1" indicator="both" reserveGutter={false}>
              {children}
            </ScrollArea>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          )}
          {RESIZE_HANDLES.map(({ edge, className: handleClass }) => (
            <div
              key={edge}
              className={cn('absolute z-10 touch-none focus-visible:outline-2 focus-visible:outline-accent', handleClass)}
              role="separator"
              tabIndex={0}
              aria-label={`${title}: resize ${edge}`}
              onPointerDown={(event) => begin(event, edge)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={(event) => resizeWithKeyboard(event, edge)}
              onMouseDown={keepGameFocus}
            >
              {edge === 'se' ? <span className="absolute right-1 bottom-1 h-2 w-2 border-r-2 border-b-2 border-ink-soft" aria-hidden /> : null}
            </div>
          ))}
        </>
      ) : null}
    </section>
  )
}
