/** 浮动小面板的位置规则：迷你面板与迷你面板管理共用 */

export type Frame = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
type Axis = { mode: 'right' | 'top' | 'bottom' | 'ratio'; value: number }
export type Placement = { version: 2; width: number; height: number; x: Axis; y: Axis }
export type Viewport = { left: number; top: number; width: number; height: number }

export const GUTTER = 8
const SNAP_DISTANCE = 48

export function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value))
}

export function viewport(): Viewport {
  const visual = window.visualViewport
  return visual
    ? { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

/** 靠右、靠下时记与该边的距离，否则记比例；`edge` 为面板默认所在的上下边 */
export function placementFromFrame(frame: Frame, area: Viewport, edge: 'top' | 'bottom', visibleHeight = frame.height): Placement {
  const right = area.left + area.width - frame.x - frame.width
  const top = frame.y - area.top
  const bottom = area.top + area.height - frame.y - visibleHeight
  const xTravel = Math.max(1, area.width - frame.width - GUTTER * 2)
  const yTravel = Math.max(1, area.height - visibleHeight - GUTTER * 2)
  return {
    version: 2,
    width: frame.width,
    height: frame.height,
    x: right <= SNAP_DISTANCE ? { mode: 'right', value: Math.max(GUTTER, right) } : { mode: 'ratio', value: clamp((frame.x - area.left - GUTTER) / xTravel, 0, 1) },
    y:
      bottom <= SNAP_DISTANCE
        ? { mode: 'bottom', value: Math.max(GUTTER, bottom) }
        : top <= SNAP_DISTANCE || (right <= SNAP_DISTANCE && edge === 'top' && top < area.height / 2)
          ? { mode: 'top', value: Math.max(GUTTER, top) }
          : { mode: 'ratio', value: clamp((frame.y - area.top - GUTTER) / yTravel, 0, 1) },
  }
}

/** 读回保存的位置；没有或无效时返回 `fallback`。`requireSize` 为 false 时不校验宽高（尺寸由内容决定的面板） */
export function readPlacement(key: string, fallback: Placement, edge: 'top' | 'bottom', requireSize = true): Placement {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as Placement | Frame | null
    if (!saved) return fallback
    if (requireSize && (![saved.width, saved.height].every(Number.isFinite) || saved.width <= 0 || saved.height <= 0)) return fallback
    if (
      'version' in saved &&
      saved.version === 2 &&
      saved.x &&
      saved.y &&
      Number.isFinite(saved.x.value) &&
      Number.isFinite(saved.y.value) &&
      ['right', 'ratio'].includes(saved.x.mode) &&
      ['top', 'bottom', 'ratio'].includes(saved.y.mode)
    )
      return saved
    if (requireSize && typeof saved.x === 'number' && typeof saved.y === 'number') return placementFromFrame(saved as Frame, viewport(), edge)
  } catch {
    // Saved geometry is optional.
  }
  return fallback
}

export function writePlacement(key: string, placement: Placement): void {
  try {
    localStorage.setItem(key, JSON.stringify(placement))
  } catch {
    // The current session still uses the new placement.
  }
}

/** 按锚点算出左上角，并夹回画面内；`size.height` 取当前可见高度 */
export function positionFromPlacement(placement: Placement, size: Size, area: Viewport): { x: number; y: number } {
  const x =
    placement.x.mode === 'right'
      ? area.left + area.width - placement.x.value - size.width
      : area.left + GUTTER + placement.x.value * Math.max(0, area.width - size.width - GUTTER * 2)
  const y =
    placement.y.mode === 'top'
      ? area.top + placement.y.value
      : placement.y.mode === 'bottom'
        ? area.top + area.height - placement.y.value - size.height
        : area.top + GUTTER + placement.y.value * Math.max(0, area.height - size.height - GUTTER * 2)
  return clampPosition({ x, y }, size, area)
}

export function clampPosition(position: { x: number; y: number }, size: Size, area: Viewport): { x: number; y: number } {
  return {
    x: clamp(position.x, area.left + GUTTER, Math.max(area.left + GUTTER, area.left + area.width - size.width - GUTTER)),
    y: clamp(position.y, area.top + GUTTER, Math.max(area.top + GUTTER, area.top + area.height - size.height - GUTTER)),
  }
}
