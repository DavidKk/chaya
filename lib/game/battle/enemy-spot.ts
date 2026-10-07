/** Enemy footprint on the battle screen; `x` is the bottom centre and `y` the bottom (sprite anchor 0.5, 1) */
export type EnemyRect = { x: number; y: number; width: number; height: number }

export type EnemySpotInput = {
  /** Alive, appeared enemies to avoid */
  existing: readonly EnemyRect[]
  size: { width: number; height: number }
  /** `Graphics.boxWidth` / `boxHeight` */
  bounds: { width: number; height: number }
  /** Row used when `existing` is empty (bottom y of every member, fallen ones included) */
  fallbackY?: number
}

/** Size assumed while an enemy image is still loading */
export const ENEMY_SIZE_GUESS = { width: 120, height: 120 }

const STEP = 24
const GAP = 8

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function overlaps(a: EnemyRect, b: EnemyRect): boolean {
  return a.x - a.width / 2 < b.x + b.width / 2 + GAP && b.x - b.width / 2 < a.x + a.width / 2 + GAP && a.y - a.height < b.y + GAP && b.y - b.height < a.y + GAP
}

/**
 * A spot for a new enemy that overlaps nobody: the existing row first (from the centre outwards), then one
 * enemy height above / below. When nothing fits, the candidate farthest from every enemy (may overlap).
 */
export function pickEnemySpot({ existing, size, bounds, fallbackY }: EnemySpotInput): { x: number; y: number } {
  const width = Math.max(1, size.width)
  const height = Math.max(1, size.height)
  const baseY = existing.length ? median(existing.map((e) => e.y)) : (fallbackY ?? Math.round(bounds.height * 0.6))
  const step = Math.max(height, existing.length ? median(existing.map((e) => e.height)) : 0) + GAP
  const rows = [baseY, baseY - step, baseY + step].filter((y) => y - height >= 0 && y <= bounds.height)
  if (!rows.length) rows.push(Math.min(bounds.height, Math.max(height, baseY)))

  const minX = Math.min(width / 2, bounds.width / 2)
  const maxX = Math.max(bounds.width - width / 2, bounds.width / 2)
  const centre = bounds.width / 2
  const xs: number[] = [centre]
  for (let d = STEP; centre - d >= minX || centre + d <= maxX; d += STEP) {
    if (centre - d >= minX) xs.push(centre - d)
    if (centre + d <= maxX) xs.push(centre + d)
  }

  let best = { x: Math.round(centre), y: Math.round(rows[0]!) }
  let bestDistance = -1
  for (const y of rows) {
    for (const x of xs) {
      const rect = { x, y, width, height }
      if (!existing.some((e) => overlaps(rect, e))) return { x: Math.round(x), y: Math.round(y) }
      const distance = Math.min(...existing.map((e) => Math.hypot(e.x - x, e.y - e.height / 2 - (y - height / 2))))
      if (distance > bestDistance) {
        bestDistance = distance
        best = { x: Math.round(x), y: Math.round(y) }
      }
    }
  }
  return best
}

/** Spots for several new enemies, each avoiding the ones placed before it */
export function pickEnemySpots(input: Omit<EnemySpotInput, 'size'> & { sizes: ReadonlyArray<{ width: number; height: number }> }): Array<{ x: number; y: number }> {
  const placed: EnemyRect[] = [...input.existing]
  return input.sizes.map((size) => {
    const spot = pickEnemySpot({ ...input, existing: placed, size })
    placed.push({ ...spot, ...size })
    return spot
  })
}
