'use client'

import { type CSSProperties, type RefObject, useLayoutEffect, useState } from 'react'

const VIEWPORT_PADDING = 8
const DEFAULT_PANEL_MAX_HEIGHT = 224

export type FloatingPanelWidthMode = 'anchor' | 'content'

interface UseFloatingPanelOptions {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLElement | null>
  maxHeight?: number
  widthMode?: FloatingPanelWidthMode
}

/** 对齐 ticket-janitor：面板 portal 到 body 后，按锚点定位；默认下方，空间不足则翻到上方。 */
export function useFloatingPanel({ open, anchorRef, panelRef, maxHeight = DEFAULT_PANEL_MAX_HEIGHT, widthMode = 'anchor' }: UseFloatingPanelOptions) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' })
      return
    }

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      const panelHeight = Math.min(panelRef.current?.offsetHeight ?? maxHeight, maxHeight)
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING
      const spaceAbove = rect.top - VIEWPORT_PADDING
      const openAbove = spaceBelow < panelHeight && spaceAbove > spaceBelow

      let left = rect.left
      const maxRight = window.innerWidth - VIEWPORT_PADDING

      if (widthMode === 'content') {
        const measured = panelRef.current?.offsetWidth ?? rect.width
        if (left + measured > maxRight) {
          left = Math.max(VIEWPORT_PADDING, rect.right - measured)
        }
        if (left < VIEWPORT_PADDING) {
          left = VIEWPORT_PADDING
        }

        setStyle({
          position: 'fixed',
          left,
          maxWidth: maxRight - left,
          top: openAbove ? rect.top - 4 : rect.bottom + 4,
          transform: openAbove ? 'translateY(-100%)' : undefined,
          zIndex: 60,
          visibility: 'visible',
        })
        return
      }

      let panelWidth = rect.width
      if (left + panelWidth > maxRight) {
        left = rect.right - panelWidth
      }
      if (left < VIEWPORT_PADDING) {
        left = VIEWPORT_PADDING
        panelWidth = Math.min(panelWidth, window.innerWidth - VIEWPORT_PADDING * 2)
      }

      setStyle({
        position: 'fixed',
        left,
        width: panelWidth,
        minWidth: panelWidth,
        top: openAbove ? rect.top - 4 : rect.bottom + 4,
        transform: openAbove ? 'translateY(-100%)' : undefined,
        zIndex: 60,
        visibility: 'visible',
      })
    }

    updatePosition()
    const frameOne = window.requestAnimationFrame(() => {
      updatePosition()
      window.requestAnimationFrame(updatePosition)
    })

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updatePosition) : null
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (anchor) resizeObserver?.observe(anchor)
    if (panel) resizeObserver?.observe(panel)

    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.cancelAnimationFrame(frameOne)
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [anchorRef, maxHeight, open, panelRef, widthMode])

  return style
}
