/** Action construction and effect estimates shared by automatic battle tactics. */
export type AutoActor = {
  canMove?: () => boolean
  canAttack?: () => boolean
  canGuard?: () => boolean
  canUse?: (itemOrSkill: any) => boolean
  isConfusion?: () => boolean
  makeConfusionActions?: () => void
  makeAutoBattleActions?: () => void
  makeActions?: () => void
  numActions?: () => number
  setAction?: (index: number, action: unknown) => void
  setActionState?: (state: string) => void
  usableSkills?: () => any[]
  skillMpCost?: (skill: any) => number
  skillTpCost?: (skill: any) => number
  mp?: number
  tp?: number
  hp?: number
  mhp?: number
  mmp?: number
  skills?: () => any[]
  attackSkillId?: () => number
  guardSkillId?: () => number
  index?: () => number
}

const g = () => globalThis as unknown as { Game_Action?: new (actor: unknown) => any; $gameParty?: { items?: () => any[]; numItems?: (item: any) => number } }

export function createAction(actor: unknown): any {
  const ActionClass = g().Game_Action || (globalThis as any).Game_Action
  if (typeof ActionClass === 'function') {
    return new ActionClass(actor)
  }
  return {
    _targetIndex: -1,
    _actionType: 'none',
    setAttack() {
      this._actionType = 'attack'
      this._item = { isSkill: () => false, isItem: () => false }
    },
    setGuard() {
      this._actionType = 'guard'
      this._item = { isSkill: () => false, isItem: () => false }
    },
    setSkill(id: number) {
      this._actionType = 'skill'
      this._skillId = id
      this._item = { isSkill: () => true, isItem: () => false, _itemId: id }
    },
    setItem(id: number) {
      this._actionType = 'item'
      this._itemId = id
      this._item = { isSkill: () => false, isItem: () => true, _itemId: id }
    },
    setTarget(i: number) {
      this._targetIndex = i
    },
    item() {
      return this._item
    },
  }
}

export function setActionItem(action: any, itemId: number) {
  if (typeof action.setItem === 'function') {
    action.setItem(itemId)
    action._actionType = 'item'
    action._itemId = itemId
  } else {
    action._actionType = 'item'
    action._itemId = itemId
    action._item = { isSkill: () => false, isItem: () => true, _itemId: itemId }
  }
}

export function setActionTarget(action: any, targetIndex: number) {
  if (typeof action.setTarget === 'function') {
    action.setTarget(targetIndex)
  } else {
    action._targetIndex = targetIndex
  }
}

export function safeEvaluateDamage(action: any, target: any, recovery = false): number {
  if (!target) return 0
  let restoreVariance: (() => void) | null = null
  try {
    const item = typeof action.item === 'function' ? action.item() : null
    const damage = item?.damage
    if (damage && typeof damage === 'object' && 'variance' in damage) {
      const variance = damage.variance
      damage.variance = 0
      restoreVariance = () => {
        damage.variance = variance
      }
    }
    if (typeof action.makeDamageValue === 'function') {
      let val: unknown
      try {
        // MZ/MV accept a missing critical flag; plugins may expose only one argument.
        val = action.makeDamageValue(target)
      } catch {
        val = action.makeDamageValue(target, false)
      }
      return typeof val === 'number' && Number.isFinite(val) ? Math.max(recovery ? -val : val, 0) : 0
    }
  } catch {
    // Shield against plugin damage formulas requiring live battle context
  } finally {
    restoreVariance?.()
  }
  return 0
}

export function estimateHpRecovery(itemOrSkill: any, user: unknown, target: any): number {
  if (!itemOrSkill || !target) return 0
  let total = 0
  if (itemOrSkill.damage?.type === 3) {
    const act = createAction(user)
    if (typeof act.setSkill === 'function' && (itemOrSkill.stypeId !== undefined || itemOrSkill.isSkill?.())) {
      act.setSkill(itemOrSkill.id)
    } else if (typeof act.setItem === 'function') {
      act.setItem(itemOrSkill.id)
    }
    const dmg = safeEvaluateDamage(act, target, true)
    if (dmg > 0) total += dmg
  }
  if (Array.isArray(itemOrSkill.effects)) {
    for (const eff of itemOrSkill.effects) {
      if (eff && eff.code === 11) {
        const pct = typeof eff.value1 === 'number' ? eff.value1 : 0
        const flat = typeof eff.value2 === 'number' ? eff.value2 : 0
        const itemRate = itemOrSkill.stypeId === undefined ? ((user as any)?.pha ?? 1) : 1
        total += Math.floor(((target.mhp ?? 1) * pct + flat) * (target.rec ?? 1) * itemRate)
      }
    }
  }
  return total
}

export function estimateMpRecovery(itemOrSkill: any, user: unknown, target: any): number {
  if (!itemOrSkill || !target) return 0
  let total = 0
  if (itemOrSkill.damage?.type === 4) {
    const act = createAction(user)
    if (typeof act.setSkill === 'function' && (itemOrSkill.stypeId !== undefined || itemOrSkill.isSkill?.())) {
      act.setSkill(itemOrSkill.id)
    } else if (typeof act.setItem === 'function') {
      act.setItem(itemOrSkill.id)
    }
    const dmg = safeEvaluateDamage(act, target, true)
    if (dmg > 0) total += dmg
  }
  if (Array.isArray(itemOrSkill.effects)) {
    for (const eff of itemOrSkill.effects) {
      if (eff && eff.code === 12) {
        const pct = typeof eff.value1 === 'number' ? eff.value1 : 0
        const flat = typeof eff.value2 === 'number' ? eff.value2 : 0
        const itemRate = itemOrSkill.stypeId === undefined ? ((user as any)?.pha ?? 1) : 1
        total += Math.floor(((target.mmp ?? 1) * pct + flat) * (target.rec ?? 1) * itemRate)
      }
    }
  }
  return total
}

export function getUsableItems(actor: AutoActor, virtualItems?: Map<number, number>): any[] {
  const party = g().$gameParty
  if (!party || typeof party.items !== 'function') return []
  const allItems = party.items()
  if (!Array.isArray(allItems)) return []
  return allItems.filter((item) => {
    if (!item || typeof item !== 'object') return false
    const totalCount = typeof party.numItems === 'function' ? party.numItems(item) : 1
    const usedCount = virtualItems?.get(item.id) ?? 0
    if (totalCount - usedCount <= 0) return false
    if (typeof actor.canUse === 'function') {
      return actor.canUse(item)
    }
    return true
  })
}

export function matchBestHealingItem(usableItems: any[], user: unknown, target: any): any {
  if (!usableItems || !usableItems.length || !target) return null
  const deficit = Math.max((target.mhp ?? 1) - (target.hp ?? 0), 1)
  const targetMhp = Math.max(target.mhp ?? 1, 1)
  const isSelf = target === user || (typeof target.index === 'function' && typeof (user as any)?.index === 'function' && target.index() === (user as any).index())

  let bestItem: any = null
  let bestScore = -1

  for (const item of usableItems) {
    const scope = item.scope
    if (![7, 8, 11].includes(scope)) continue
    if (scope === 11 && !isSelf) continue
    const recovery = estimateHpRecovery(item, user, target)
    if (recovery <= 0) continue

    // 淘汰过滤：若恢复量占 MHP < 8%，且缺口 > 300，且恢复量不到缺口的 20%，视为前期过时道具予以废弃
    if (recovery < targetMhp * 0.08 && deficit > 300 && recovery < deficit * 0.2) {
      continue
    }

    // 评分：贴近缺口得分最高，溢出部分适当衰减
    let score = 0
    if (recovery <= deficit) {
      score = recovery / deficit // 例: 200/200 = 1.0, 50/200 = 0.25
    } else {
      const overflow = recovery - deficit
      score = Math.max(0.1, 1.0 - (overflow / recovery) * 0.5)
    }

    if (score > bestScore) {
      bestScore = score
      bestItem = item
    }
  }
  return bestItem
}

/** Battle testApply accepts every living target, so inspect individual effects. */
export function hasUsefulEffect(item: any, target: any, codes: number[]): boolean {
  const effects = item?.effects
  if (!Array.isArray(effects) || !target) return false
  return effects.some((effect: any) => {
    if (!effect || !codes.includes(effect.code)) return false
    try {
      if (effect.code === 21) {
        if (effect.dataId === 0 || effect.value1 === 0) return false
        if (target.isStateAffected?.(effect.dataId) || target.isStateResist?.(effect.dataId)) return false
        if (target.stateRate?.(effect.dataId) === 0) return false
      }
      if (effect.code === 31 && target.isMaxBuffAffected?.(effect.dataId)) return false
      if (effect.code === 32 && (target.isMaxDebuffAffected?.(effect.dataId) || target.debuffRate?.(effect.dataId) === 0)) return false
      if (effect.code === 22 && !target.isStateAffected?.(effect.dataId)) return false
      if (effect.code === 33 && !target.isBuffAffected?.(effect.dataId)) return false
      if (effect.code === 34 && !target.isDebuffAffected?.(effect.dataId)) return false
      return true
    } catch {
      return false
    }
  })
}
