export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

/** Cross-axis alignment relative to the trigger (default center). */
export type TooltipAlign = 'start' | 'center' | 'end'

export interface TooltipViewport {
  width: number
  height: number
}

export interface TooltipPositionResult {
  left: number
  top: number
  placement: TooltipPlacement
}

export const TOOLTIP_GAP = 6
export const TOOLTIP_PADDING = 8

const OPPOSITE: Record<TooltipPlacement, TooltipPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

/**
 * Compute viewport-safe tooltip coordinates.
 * Prefers the requested side, flips when needed, then clamps inside the viewport.
 */
export function computeTooltipPosition(
  triggerRect: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number },
  tooltipWidth: number,
  tooltipHeight: number,
  preferred: TooltipPlacement = 'bottom',
  viewport: TooltipViewport = { width: 1024, height: 768 },
  align: TooltipAlign = 'center',
  noFlip = false
): TooltipPositionResult {
  if (noFlip) {
    const coords = coordsForPlacement(preferred, triggerRect, tooltipWidth, tooltipHeight, viewport, align)
    const clamped = clampToViewport(coords.left, coords.top, tooltipWidth, tooltipHeight, viewport)
    return { ...clamped, placement: preferred }
  }

  const candidates = rankPlacementCandidates(preferred, triggerRect, tooltipWidth, tooltipHeight, viewport)

  for (const placement of candidates) {
    const coords = coordsForPlacement(placement, triggerRect, tooltipWidth, tooltipHeight, viewport, align)
    if (fitsViewport(coords.left, coords.top, tooltipWidth, tooltipHeight, viewport)) {
      return { ...coords, placement }
    }
  }

  const fallback = coordsForPlacement(preferred, triggerRect, tooltipWidth, tooltipHeight, viewport, align)
  const clamped = clampToViewport(fallback.left, fallback.top, tooltipWidth, tooltipHeight, viewport)
  return { ...clamped, placement: preferred }
}

function rankPlacementCandidates(
  preferred: TooltipPlacement,
  triggerRect: { left: number; top: number; right: number; bottom: number },
  tw: number,
  th: number,
  viewport: TooltipViewport
): TooltipPlacement[] {
  const opposite = OPPOSITE[preferred]
  const allSides: TooltipPlacement[] = ['bottom', 'top', 'right', 'left']
  const rest = allSides.filter((placement) => placement !== preferred && placement !== opposite)
  rest.sort((a, b) => placementSpace(b, triggerRect, tw, th, viewport) - placementSpace(a, triggerRect, tw, th, viewport))
  return [preferred, opposite, ...rest]
}

function placementSpace(
  placement: TooltipPlacement,
  rect: { left: number; top: number; right: number; bottom: number },
  tw: number,
  th: number,
  viewport: TooltipViewport
): number {
  switch (placement) {
    case 'bottom':
      return viewport.height - rect.bottom - TOOLTIP_GAP - th
    case 'top':
      return rect.top - TOOLTIP_GAP - th
    case 'right':
      return viewport.width - rect.right - TOOLTIP_GAP - tw
    case 'left':
      return rect.left - TOOLTIP_GAP - tw
    default:
      return 0
  }
}

function coordsForPlacement(
  placement: TooltipPlacement,
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  tw: number,
  th: number,
  viewport: TooltipViewport,
  align: TooltipAlign
): { left: number; top: number } {
  switch (placement) {
    case 'bottom':
      return {
        left: alignHorizontal(rect, tw, viewport.width, align),
        top: rect.bottom + TOOLTIP_GAP,
      }
    case 'top':
      return {
        left: alignHorizontal(rect, tw, viewport.width, align),
        top: rect.top - TOOLTIP_GAP - th,
      }
    case 'right':
      return {
        left: rect.right + TOOLTIP_GAP,
        top: alignVertical(rect, th, viewport.height, align),
      }
    case 'left':
      return {
        left: rect.left - TOOLTIP_GAP - tw,
        top: alignVertical(rect, th, viewport.height, align),
      }
    default:
      return { left: rect.left, top: rect.bottom + TOOLTIP_GAP }
  }
}

function alignHorizontal(rect: { left: number; right: number; width: number }, tw: number, viewportWidth: number, align: TooltipAlign): number {
  let left: number
  switch (align) {
    case 'start':
      left = rect.left
      break
    case 'end':
      left = rect.right - tw
      break
    default:
      left = rect.left + rect.width / 2 - tw / 2
  }
  return clampAxis(left, tw, viewportWidth)
}

function alignVertical(rect: { top: number; bottom: number; height: number }, th: number, viewportHeight: number, align: TooltipAlign): number {
  let top: number
  switch (align) {
    case 'start':
      top = rect.top
      break
    case 'end':
      top = rect.bottom - th
      break
    default:
      top = rect.top + rect.height / 2 - th / 2
  }
  return clampAxis(top, th, viewportHeight)
}

function clampAxis(origin: number, size: number, viewportSize: number): number {
  let value = origin
  if (value < TOOLTIP_PADDING) {
    value = TOOLTIP_PADDING
  }
  if (value + size > viewportSize - TOOLTIP_PADDING) {
    value = viewportSize - TOOLTIP_PADDING - size
  }
  return value
}

function fitsViewport(left: number, top: number, tw: number, th: number, viewport: TooltipViewport): boolean {
  return left >= TOOLTIP_PADDING && top >= TOOLTIP_PADDING && left + tw <= viewport.width - TOOLTIP_PADDING && top + th <= viewport.height - TOOLTIP_PADDING
}

function clampToViewport(left: number, top: number, tw: number, th: number, viewport: TooltipViewport): { left: number; top: number } {
  return {
    left: Math.max(TOOLTIP_PADDING, Math.min(left, viewport.width - TOOLTIP_PADDING - tw)),
    top: Math.max(TOOLTIP_PADDING, Math.min(top, viewport.height - TOOLTIP_PADDING - th)),
  }
}
