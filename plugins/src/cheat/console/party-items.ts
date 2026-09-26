/**
 * Party inventory / equip counts (console API: target count includes equipped).
 */
import { createLogger } from '../../helpers'
import { itemLabel } from './item-label'

const log = createLogger('ChayaEdit')

type DbRow = { id?: number; name?: string; description?: string } | null
type Db = Array<DbRow> | undefined

export function needParty(): boolean {
  if (typeof $gameParty === 'undefined' || !$gameParty) {
    log.warn('请先读档进游戏')
    return false
  }
  return true
}

export function findInDb(db: Db, keyword: unknown, limit?: number) {
  const q = String(keyword || '').toLowerCase()
  const out: Array<{ id: number; name: string; zh?: string }> = []
  if (!db || !q) return out
  const max = limit || 30
  for (let i = 1; i < db.length; i++) {
    const row = db[i]
    if (!row) continue
    const info = itemLabel(row)
    const hay = `${info.name} ${info.zh} ${i} ${row.description || ''}`.toLowerCase()
    if (hay.includes(q)) {
      out.push({ id: i, name: info.name, ...(info.zh && info.zh !== info.name ? { zh: info.zh } : {}) })
      if (out.length >= max) break
    }
  }
  return out
}

export function equippedCount(item: unknown): number {
  if (!item || typeof $gameParty === 'undefined' || !$gameParty) return 0
  let n = 0
  for (const actor of $gameParty.members()) {
    for (const eq of actor.equips()) {
      if (eq === item) n++
    }
  }
  return n
}

export function partyCount(item: unknown): number {
  if (!item || typeof $gameParty === 'undefined' || !$gameParty) return 0
  return $gameParty.numItems(item) + equippedCount(item)
}

/** Target count = bag+equipped; reducing below equipped uses includeEquip to unequip */
export function setItemLike(db: Db, id: number, count: number) {
  if (!needParty()) return null
  const n = Math.max(0, Number(count) || 0)
  const item = db?.[id]
  if (!item) {
    log.warn('无效 ID', id)
    return null
  }
  const inv = $gameParty.numItems(item)
  const eq = equippedCount(item)
  const targetInv = Math.max(0, n - eq)
  const delta = targetInv - inv
  if (delta !== 0) $gameParty.gainItem(item, delta, delta < 0)
  return { id, name: itemLabel(item).name, count: partyCount(item), inv: $gameParty.numItems(item), eq }
}
