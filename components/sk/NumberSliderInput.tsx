'use client'

import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { NumberInput, type NumberInputProps } from '@/components/sk/NumberInput'
import { computeTooltipPosition } from '@/components/sk/Tooltip/tooltipPosition'
import { cn } from '@/lib/utils'

export type NumberSliderInputProps = Omit<NumberInputProps, 'min' | 'max'> & {
  min: number
  max: number
  /** 滑块与提交时对齐的步长 */
  step?: number
}

const SLIDER_PORTAL_ATTR = 'data-chaya-slider-root'

/**
 * 网页挂 document.body；局内 GameEdit 在 Shadow 内，须挂回同一 Shadow，
 * 否则 token 样式不生效，range 浮层看起来像「没有」。
 */
function resolveSliderPortal(anchor: Element | null): HTMLElement {
  if (typeof document === 'undefined') throw new Error('resolveSliderPortal requires document')
  if (!anchor) return document.body
  const root = anchor.getRootNode()
  if (root instanceof ShadowRoot) {
    const existing = root.querySelector<HTMLElement>(`[${SLIDER_PORTAL_ATTR}]`)
    if (existing) return existing
    const el = document.createElement('div')
    el.setAttribute(SLIDER_PORTAL_ATTR, '')
    root.appendChild(el)
    return el
  }
  return document.body
}

function snapToStep(value: number, min: number, max: number, step: number) {
  if (!Number.isFinite(value)) return min
  const raw = min + Math.round((value - min) / step) * step
  const places = Math.min(6, Math.max(0, String(step).split('.')[1]?.length ?? 0))
  const next = Number(raw.toFixed(places))
  return Math.min(max, Math.max(min, next))
}

const rangeThumb =
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-panel [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgb(0_0_0/0.28)] [&::-webkit-slider-thumb]:[-webkit-appearance:none] active:[&::-webkit-slider-thumb]:cursor-grabbing active:[&::-webkit-slider-thumb]:shadow-[0_2px_7px_rgb(0_0_0/0.34),0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent [&::-moz-range-thumb]:bg-panel [&::-moz-range-thumb]:shadow-[0_1px_3px_rgb(0_0_0/0.28)] active:[&::-moz-range-thumb]:cursor-grabbing active:[&::-moz-range-thumb]:shadow-[0_2px_7px_rgb(0_0_0/0.34),0_0_0_3px_color-mix(in_oklab,var(--accent)_35%,transparent)] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:bg-transparent'

/**
 * 有界数字：输入框 + 聚焦时上浮 range 滑块（对齐工单 NumberRangeInput 单值用法）。
 * 无限域请用 NumberInput。
 */
export function NumberSliderInput({ value, onValueChange, min, max, step = 1, disabled, className, ...rest }: NumberSliderInputProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1
  const span = max - min

  const commit = useCallback(
    (next: number) => {
      onValueChange(snapToStep(next, min, max, safeStep))
    },
    [max, min, onValueChange, safeStep]
  )

  const updatePosition = useCallback(() => {
    const anchor = rootRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const rect = anchor.getBoundingClientRect()
    // 与输入框同宽，避免浮层比控件更宽
    const width = Math.min(Math.max(rect.width, 1), window.innerWidth - 16)
    const { left, top } = computeTooltipPosition(rect, width, panel.offsetHeight || 32, 'top', {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    setPanelStyle({
      position: 'fixed',
      left,
      top,
      width,
      minWidth: width,
      maxWidth: width,
      zIndex: 60,
      visibility: 'visible',
      boxSizing: 'border-box',
    })
  }, [])

  useEffect(() => {
    if (!open) {
      setPortalRoot(null)
      return
    }
    setPortalRoot(resolveSliderPortal(rootRef.current))
  }, [open])

  useLayoutEffect(() => {
    if (!open || !portalRoot) {
      setPanelStyle({ visibility: 'hidden' })
      return
    }
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, portalRoot, updatePosition, value])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      // Shadow 内点击：部分环境 target 会是 host，再查 composedPath
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      if (path.some((n) => n === rootRef.current || n === panelRef.current)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!dragging) return
    function stop() {
      setDragging(false)
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging])

  const canSlide = span > 0 && !disabled
  const sliderValue = snapToStep(value, min, max, safeStep)
  const percent = span > 0 ? ((sliderValue - min) / span) * 100 : 0

  const panel =
    canSlide && open && portalRoot
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="拖拽调整数值"
            className={cn(
              'box-border h-8 rounded-[0.25rem] border border-line bg-panel px-1 py-1 shadow-[0_8px_24px_rgb(0_0_0/0.35),0_0_0_1px_color-mix(in_oklab,var(--line)_60%,transparent)]',
              dragging &&
                'border-[color-mix(in_oklab,var(--accent)_55%,var(--line))] shadow-[0_8px_24px_rgb(0_0_0/0.35),0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]'
            )}
            style={panelStyle}
          >
            <div className="relative h-full px-1">
              <div
                className="absolute inset-x-[0.35rem] top-1/2 h-[0.375rem] -translate-y-1/2 rounded-full bg-[color-mix(in_oklab,var(--line)_85%,transparent)] shadow-[inset_0_1px_1px_rgb(0_0_0/0.2)]"
                aria-hidden
              >
                <div className="h-full rounded-[inherit] bg-accent" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
              </div>
              <input
                type="range"
                className={cn(
                  'pointer-events-none absolute inset-x-[0.35rem] top-1/2 m-0 h-[0.875rem] w-[calc(100%-0.7rem)] -translate-y-1/2 appearance-none bg-transparent p-0 outline-none cursor-grab active:cursor-grabbing',
                  rangeThumb
                )}
                min={min}
                max={max}
                step={safeStep}
                value={sliderValue}
                aria-label={typeof rest['aria-label'] === 'string' ? `${rest['aria-label']} 滑块` : '数值滑块'}
                onPointerDown={(e) => {
                  e.currentTarget.focus()
                  setDragging(true)
                }}
                onChange={(e) => commit(Number(e.target.value))}
              />
            </div>
          </div>,
          portalRoot
        )
      : null

  return (
    <div
      ref={rootRef}
      className={cn('inline-flex min-w-0 max-w-full [&>*]:w-full [&>*]:min-w-0', className)}
      onFocusCapture={() => {
        if (canSlide) setOpen(true)
      }}
      onPointerDown={() => {
        if (canSlide) setOpen(true)
      }}
    >
      <NumberInput
        {...rest}
        className="w-full min-w-0"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onValueChange={commit}
        onBlur={(e) => {
          rest.onBlur?.(e)
        }}
      />
      {panel}
    </div>
  )
}
