'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'

import { computeTooltipPosition, type TooltipPlacement } from '@/components/sk/Tooltip/tooltipPosition'

interface TooltipProps {
  /** Short hint text; keep concise so it stays in viewport */
  content: string
  placement?: TooltipPlacement
  children: React.ReactElement
  /** 触发器额外 class（如块级条需 `block w-full`） */
  triggerClassName?: string
  /** 触屏默认让链接、按钮等操作控件直接响应；纯说明触发器点击切换提示。 */
  touchBehavior?: 'auto' | 'toggle' | 'passthrough'
}

const TOOLTIP_HOVER_MEDIA_QUERY = '(hover: hover) and (pointer: fine) and (min-width: 768px)'
const TOOLTIP_PORTAL_ATTR = 'data-chaya-tooltip-root'

/**
 * 网页挂 document.body；局内 GameEdit 在 Shadow 内，须挂回同一 Shadow，
 * 否则 Tailwind token 不生效，提示看起来像「没 tooltip」。
 */
function resolveTooltipPortal(trigger: Element | null): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('resolveTooltipPortal requires document')
  }
  if (!trigger) return document.body
  const root = trigger.getRootNode()
  if (root instanceof ShadowRoot) {
    const existing = root.querySelector<HTMLElement>(`[${TOOLTIP_PORTAL_ATTR}]`)
    if (existing) return existing
    const el = document.createElement('div')
    el.setAttribute(TOOLTIP_PORTAL_ATTR, '')
    root.appendChild(el)
    return el
  }
  return document.body
}

/** 全页共享一条 matchMedia 订阅，避免每个 Tooltip 各自监听。 */
let tooltipMedia: MediaQueryList | null = null
let tooltipMediaListening = false
const tooltipMediaListeners = new Set<() => void>()

function ensureTooltipMediaListening() {
  if (typeof window === 'undefined' || tooltipMediaListening) {
    return
  }
  tooltipMedia = window.matchMedia(TOOLTIP_HOVER_MEDIA_QUERY)
  const notify = () => {
    for (const listener of tooltipMediaListeners) {
      listener()
    }
  }
  tooltipMedia.addEventListener('change', notify)
  tooltipMediaListening = true
}

function subscribeTooltipHoverMode(onStoreChange: () => void): () => void {
  ensureTooltipMediaListening()
  tooltipMediaListeners.add(onStoreChange)
  return () => {
    tooltipMediaListeners.delete(onStoreChange)
  }
}

function getTooltipHoverModeSnapshot(): boolean {
  return tooltipMedia?.matches ?? false
}

function getTooltipHoverModeServerSnapshot(): boolean {
  return false
}

/** 桌面精细指针用 hover；窄屏 / 触控用点击切换。 */
function useTooltipHoverMode(): boolean {
  return React.useSyncExternalStore(subscribeTooltipHoverMode, getTooltipHoverModeSnapshot, getTooltipHoverModeServerSnapshot)
}

function composeHandlers<E>(theirHandler: ((event: E) => void) | undefined, ourHandler: (event: E) => void) {
  return (event: E) => {
    theirHandler?.(event)
    ourHandler(event)
  }
}

const TOUCH_ACTION_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role="button"]:not([aria-disabled="true"]), [role="link"]:not([aria-disabled="true"]), [role="switch"]:not([aria-disabled="true"])'

function isTouchActionTarget(event: React.MouseEvent<HTMLElement>): boolean {
  const target = event.target
  const trigger = event.currentTarget
  if (!(target instanceof Element) || !(trigger instanceof Element)) {
    return false
  }

  const action = target.closest(TOUCH_ACTION_SELECTOR)
  return action !== null && trigger.contains(action)
}

export function Tooltip({ content, placement = 'bottom', children, triggerClassName = '', touchBehavior = 'auto' }: TooltipProps) {
  const hoverMode = useTooltipHoverMode()
  const tooltipId = React.useId()
  const [open, setOpen] = React.useState(false)
  const [style, setStyle] = React.useState<React.CSSProperties>({
    position: 'fixed',
    left: 0,
    top: 0,
    visibility: 'hidden',
  })
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const [portalRoot, setPortalRoot] = React.useState<HTMLElement | null>(null)

  const close = React.useCallback(() => setOpen(false), [])

  React.useLayoutEffect(() => {
    if (!open) return
    setPortalRoot(resolveTooltipPortal(triggerRef.current))
  }, [open])

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) {
      return
    }

    const trigger = triggerRef.current
    const tooltip = tooltipRef.current
    const rect = trigger.getBoundingClientRect()
    const tooltipWidth = tooltip.offsetWidth
    const tooltipHeight = tooltip.offsetHeight
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const { left, top } = computeTooltipPosition(rect, tooltipWidth, tooltipHeight, placement, viewport)

    setStyle((prev) => {
      if (prev.left === left && prev.top === top && prev.visibility === 'visible') {
        return prev
      }
      return { position: 'fixed', left, top, visibility: 'visible' }
    })
  }, [placement])

  React.useLayoutEffect(() => {
    if (!open) {
      return
    }

    updatePosition()

    const handleViewportChange = () => updatePosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [content, open, updatePosition])

  React.useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [close, open])

  React.useEffect(() => {
    if (hoverMode || !open) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) {
        return
      }
      close()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [close, hoverMode, open])

  React.useEffect(() => {
    if (hoverMode) {
      setOpen(false)
    }
  }, [hoverMode])

  const setTriggerNode = React.useCallback((node: HTMLElement | null) => {
    triggerRef.current = node
  }, [])

  if (!React.isValidElement(children)) {
    return children as React.ReactNode
  }

  const child = children as React.ReactElement<Record<string, unknown>>
  const childProps = child.props
  const handleTouchClick = (event: React.MouseEvent<HTMLElement>) => {
    const childOnClick = childProps.onClick as ((event: React.MouseEvent<HTMLElement>) => void) | undefined
    childOnClick?.(event)

    const passthrough = touchBehavior === 'passthrough' || (touchBehavior === 'auto' && isTouchActionTarget(event))
    if (passthrough) {
      close()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setOpen((current) => !current)
  }

  const trigger = React.cloneElement(child, {
    ref: setTriggerNode,
    'aria-describedby': open ? tooltipId : undefined,
    onMouseEnter: hoverMode ? composeHandlers(childProps.onMouseEnter as ((event: unknown) => void) | undefined, () => setOpen(true)) : childProps.onMouseEnter,
    onMouseLeave: hoverMode ? composeHandlers(childProps.onMouseLeave as ((event: unknown) => void) | undefined, close) : childProps.onMouseLeave,
    onFocus: hoverMode
      ? composeHandlers(childProps.onFocus as ((event: FocusEvent) => void) | undefined, (event: FocusEvent) => {
          const target = event.target
          if (target instanceof Element && target.matches(':focus-visible')) {
            setOpen(true)
          }
        })
      : childProps.onFocus,
    onBlur: hoverMode ? composeHandlers(childProps.onBlur as ((event: unknown) => void) | undefined, close) : childProps.onBlur,
    onClick: hoverMode ? childProps.onClick : handleTouchClick,
  })

  const tooltipEl = open ? (
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      className="pointer-events-none z-50 max-w-[min(calc(100vw-16px),18rem)] rounded-[0.25rem] border border-line bg-[var(--panel-2)] px-[0.55rem] py-[0.4rem] text-xs font-medium leading-[1.35] break-words whitespace-pre-line text-ink shadow-[0_8px_24px_rgb(0_0_0/0.35)]"
      style={style}
    >
      {content}
    </div>
  ) : null

  return (
    <>
      {triggerClassName ? <span className={triggerClassName}>{trigger}</span> : trigger}
      {portalRoot && tooltipEl ? createPortal(tooltipEl, portalRoot) : null}
    </>
  )
}

/** disabled / loading 按钮需包 span，否则 hover 无法触发 Tooltip。 */
export function withTooltip(content: string, node: React.ReactElement, inactive = false) {
  return <Tooltip content={content}>{inactive ? <span className="inline-flex">{node}</span> : node}</Tooltip>
}
