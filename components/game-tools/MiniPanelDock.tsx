'use client'

import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LuColumns3, LuGripHorizontal, LuGripVertical, LuRows3 } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { MINI_PANEL_IDS, type MiniPanelId, PANEL_DOCK_ITEMS, type ToolSettings } from '@/lib/game-agent/tool-settings'
import { cn } from '@/lib/utils'

import { clampPosition, type Placement, placementFromFrame, positionFromPlacement, readPlacement, viewport, writePlacement } from './floating-placement'
import { keepGameFocus, stopGameKeys } from './game-keys'
import { PANEL_DOCK_ITEM_META } from './mini-panel-items'
import { anyMiniPanelEnabled, closeAllMiniPanels, toggleToolPanel, useToolPanelVisibility } from './tool-panels'
import type { ToolSettingsPatch } from './useToolSettings'

const STORAGE_KEY = 'chaya.panelDock.frame.v1'
const DEFAULT_PLACEMENT: Placement = { version: 2, width: 0, height: 0, x: { mode: 'ratio', value: 0.5 }, y: { mode: 'top', value: 8 } }
const KEY_STEP = 10

type Position = { x: number; y: number }
type Props = {
  settings: ToolSettings
  update: (patch: ToolSettingsPatch) => Promise<void>
}

const buttonClass = '[@media(hover:none)]:h-11 [@media(hover:none)]:w-11'
const pressedClass = 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent'

/** 迷你面板管理：一排图标开关迷你面板；不可调整大小，位置按游戏共用记住 */
export function MiniPanelDock({ settings, update }: Props) {
  const t = useT()
  const vertical = settings.panelDockOrientation === 'vertical'
  const placement = useRef<Placement | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; from: Position } | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const dragged = useRef<Position | null>(null)
  const visible: Record<MiniPanelId, boolean> = {
    miniMap: useToolPanelVisibility('miniMap', settings.miniMapEnabled).visible,
    companion: useToolPanelVisibility('companion', settings.companionEnabled).visible,
    autoSaves: useToolPanelVisibility('autoSaves', settings.autoSavePanelEnabled).visible,
    quickSaves: useToolPanelVisibility('quickSaves', settings.quickSavePanelEnabled).visible,
  }
  const shown = PANEL_DOCK_ITEMS.filter((item) => !settings.panelDockHiddenItems.includes(item))
  const panels = shown.filter((item): item is MiniPanelId => (MINI_PANEL_IDS as readonly string[]).includes(item))

  const size = () => ({ width: ref.current?.offsetWidth ?? 0, height: ref.current?.offsetHeight ?? 0 })

  const relayout = useCallback(() => {
    if (drag.current || !ref.current) return
    placement.current ??= readPlacement(STORAGE_KEY, DEFAULT_PLACEMENT, 'top', false)
    setPosition(positionFromPlacement(placement.current, size(), viewport()))
  }, [])

  useLayoutEffect(relayout, [relayout, vertical, shown.length])

  useEffect(() => {
    const node = ref.current
    const observer = typeof ResizeObserver === 'undefined' || !node ? null : new ResizeObserver(relayout)
    if (node) observer?.observe(node)
    window.addEventListener('resize', relayout)
    window.visualViewport?.addEventListener('resize', relayout)
    window.visualViewport?.addEventListener('scroll', relayout)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', relayout)
      window.visualViewport?.removeEventListener('resize', relayout)
      window.visualViewport?.removeEventListener('scroll', relayout)
    }
  }, [relayout])

  const save = (next: Position) => {
    const area = viewport()
    const current = size()
    placement.current = placementFromFrame({ ...next, ...current }, area, 'top')
    writePlacement(STORAGE_KEY, placement.current)
  }

  const moveTo = (next: Position) => {
    const clamped = clampPosition(next, size(), viewport())
    setPosition(clamped)
    return clamped
  }

  const begin = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !position) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: position }
    dragged.current = position
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    dragged.current = moveTo({ x: current.from.x + event.clientX - current.x, y: current.from.y + event.clientY - current.y })
  }

  /** pointercancel 的坐标不可靠，落点用最后一次移动的位置；Shadow DOM 里 document.activeElement 是宿主，只能直接 blur 把方向键还给游戏 */
  const end = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.currentTarget.blur()
    if (dragged.current) save(dragged.current)
  }

  const nudge = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? KEY_STEP * 3 : KEY_STEP
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    if ((!dx && !dy) || !position) return
    event.preventDefault()
    event.stopPropagation()
    save(moveTo({ x: position.x + dx, y: position.y + dy }))
  }

  const tip = vertical ? 'right' : 'bottom'
  const Grip = vertical ? LuGripHorizontal : LuGripVertical
  const separator = <span aria-hidden className={cn('shrink-0 bg-line', vertical ? 'my-0.5 h-px w-4' : 'mx-0.5 h-4 w-px')} />

  return (
    <div
      ref={ref}
      role="group"
      aria-label={t('panels.bar.aria')}
      data-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn(
        'pointer-events-auto fixed z-[60] flex items-center gap-0.5 rounded-md bg-panel/95 p-1 text-ink shadow-lg',
        'opacity-40 transition-opacity duration-150 hover:opacity-100 [&:has(:focus-visible)]:opacity-100 [@media(hover:none)]:focus-within:opacity-100',
        vertical ? 'flex-col' : 'flex-row'
      )}
      style={position ? { left: position.x, top: position.y } : { left: 0, top: 0, visibility: 'hidden' }}
      onKeyDown={stopGameKeys}
      onMouseDown={keepGameFocus}
    >
      <div
        role="separator"
        aria-orientation={vertical ? 'horizontal' : 'vertical'}
        tabIndex={0}
        aria-label={t('panels.bar.drag')}
        title={t('panels.bar.drag')}
        className={cn('flex shrink-0 touch-none cursor-grab items-center justify-center rounded-sm text-ink-soft active:cursor-grabbing', vertical ? 'h-3 w-6' : 'h-6 w-3')}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={nudge}
      >
        <Grip size={12} aria-hidden />
      </div>
      {panels.map((id) => {
        const { icon: Icon, labelKey } = PANEL_DOCK_ITEM_META[id]
        const name = t(labelKey)
        return (
          <Button
            key={id}
            size="mini"
            variant="plain"
            className={cn(buttonClass, visible[id] && pressedClass)}
            aria-label={name}
            aria-pressed={visible[id]}
            tooltip={t(visible[id] ? 'panels.bar.hide' : 'panels.bar.show', { name })}
            tooltipPlacement={tip}
            onClick={() => void toggleToolPanel(id, settings, update)}
          >
            <Icon size={14} aria-hidden />
          </Button>
        )
      })}
      {shown.includes('closeAll') ? (
        <>
          {panels.length ? separator : null}
          <Button
            size="mini"
            variant="plain"
            className={buttonClass}
            aria-label={t('panels.bar.closeAll')}
            tooltipPlacement={tip}
            disabled={!anyMiniPanelEnabled(settings)}
            onClick={() => void closeAllMiniPanels(update)}
          >
            <PANEL_DOCK_ITEM_META.closeAll.icon size={14} aria-hidden />
          </Button>
        </>
      ) : null}
      {shown.length ? separator : null}
      <Button
        size="mini"
        variant="plain"
        className={buttonClass}
        aria-label={t(vertical ? 'panels.bar.toHorizontal' : 'panels.bar.toVertical')}
        tooltipPlacement={tip}
        onClick={() => void update(({ panelDockOrientation }) => ({ panelDockOrientation: panelDockOrientation === 'vertical' ? 'horizontal' : 'vertical' }))}
      >
        {vertical ? <LuColumns3 size={14} aria-hidden /> : <LuRows3 size={14} aria-hidden />}
      </Button>
    </div>
  )
}
