import type { MouseEvent, PointerEvent } from 'react'

const INTERACTIVE =
  'button, a, input, select, textarea, [role="button"], [role="switch"], [role="tab"], [role="combobox"], [role="menu"], [role^="menuitem"], [role="listbox"], [role="option"], [role="dialog"]'
/** Part of the panel that must stay on screen while dragging (header height / grab width) */
const KEEP_Y = 52
const KEEP_X = 160

/** Overlay panel lives in a Shadow root; its host is the fixed box we move */
function overlayHost(el: Element): HTMLElement | null {
  const root = el.getRootNode()
  return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null
}

function offsetOf(host: HTMLElement): [number, number] {
  return [Number(host.dataset.dragX) || 0, Number(host.dataset.dragY) || 0]
}

function place(host: HTMLElement, x: number, y: number) {
  host.dataset.dragX = String(x)
  host.dataset.dragY = String(y)
  // Opposite margins shift the inset-positioned host without resizing it; a transform/translate would
  // turn it into the containing block for position:fixed tooltips and menus inside the shadow root.
  host.style.margin = x || y ? `${y}px ${-x}px ${-y}px ${x}px` : ''
}

/** React portals (menus, popovers) bubble through the header but are not inside it in the DOM */
function isHeaderBlank(e: { target: EventTarget; currentTarget: HTMLElement }) {
  const target = e.target as Element
  return e.currentTarget.contains(target) && !target.closest(INTERACTIVE)
}

/** Drag the in-game overlay by the blank part of its header; double-click resets */
export function panelDragHandlers() {
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !isHeaderBlank(e)) return
    const host = overlayHost(e.currentTarget)
    if (!host) return
    e.preventDefault()
    const [ox, oy] = offsetOf(host)
    const rect = host.getBoundingClientRect()
    const baseLeft = rect.left - ox
    const baseTop = rect.top - oy
    const startX = e.clientX
    const startY = e.clientY
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      const left = Math.min(window.innerWidth - KEEP_X, Math.max(KEEP_X - rect.width, baseLeft + ox + ev.clientX - startX))
      const top = Math.min(window.innerHeight - KEEP_Y, Math.max(0, baseTop + oy + ev.clientY - startY))
      place(host, Math.round(left - baseLeft), Math.round(top - baseTop))
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const onDoubleClick = (e: MouseEvent<HTMLElement>) => {
    if (!isHeaderBlank(e)) return
    const host = overlayHost(e.currentTarget)
    if (host) place(host, 0, 0)
  }
  return { onPointerDown, onDoubleClick }
}
