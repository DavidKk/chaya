export type Spot = { x: number; y: number }

/** Closest tile to (x, y) by straight-line distance that passes `standable`; the target itself wins when it qualifies */
export function nearestSpot(x: number, y: number, width: number, height: number, standable: (x: number, y: number) => boolean): Spot | null {
  const cells: (Spot & { d: number })[] = []
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) cells.push({ x: cx, y: cy, d: (cx - x) ** 2 + (cy - y) ** 2 })
  }
  cells.sort((a, b) => a.d - b.d)
  for (const c of cells) if (standable(c.x, c.y)) return { x: c.x, y: c.y }
  return null
}

/** Row-major '0' / '1' string, '1' = the player cannot stand on that tile */
export function blockedMask(width: number, height: number, blocked: (x: number, y: number) => boolean): string {
  let out = ''
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out += blocked(x, y) ? '1' : '0'
  return out
}

const STAR = 0x10

/** RPG Maker `Game_Map.checkPassage` over the four tile layers, top layer first */
function passableAt(data: readonly number[], flags: readonly number[], width: number, height: number, x: number, y: number, bit: number): boolean {
  for (let z = 3; z >= 0; z--) {
    const flag = flags[data[(z * height + y) * width + x] ?? 0] ?? 0
    if (flag & STAR) continue
    if ((flag & bit) === 0) return true
    if ((flag & bit) === bit) return false
  }
  return false
}

/**
 * Tiles blocked in every direction, from raw map JSON (`width` / `height` / `data`) and the tileset's `flags`.
 * Null when the map has no tile data or the flags are missing (nothing to mark).
 */
export function terrainBlockedMask(rawMap: unknown, tilesetFlags: unknown): string | null {
  const map = rawMap && typeof rawMap === 'object' ? (rawMap as { width?: unknown; height?: unknown; data?: unknown }) : null
  const width = Math.floor(Number(map?.width) || 0)
  const height = Math.floor(Number(map?.height) || 0)
  const data = map?.data
  if (!width || !height || !Array.isArray(data) || data.length < width * height * 4) return null
  if (!Array.isArray(tilesetFlags) || !tilesetFlags.length) return null
  const tiles = data as number[]
  const flags = tilesetFlags as number[]
  return blockedMask(width, height, (x, y) => ![1, 2, 4, 8].some((bit) => passableAt(tiles, flags, width, height, x, y, bit)))
}
