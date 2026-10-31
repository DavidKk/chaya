/**
 * Auto battle: force Game_Actor.isAutoBattle so startInput fills actions and
 * starts the turn itself; hook makeAutoBattleActions with Chaya's smart
 * contextual tactics (disarm defense, crisis heal/revive, AoE, focus fire,
 * dynamic healing gap matching, low-tier item obsolescence, MP monitoring, throwable items).
 */
import { closeBattleInputWindows } from '../session/battle-windows'
import { gameMessage, gameTroop } from './game-globals'

type AutoActor = {
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
  index?: () => number
}

type CommandWindow = { active?: boolean; deactivate?: () => void; close?: () => void; hide?: () => void }

type BattleGlobals = {
  BattleManager?: { _phase?: string; startTurn?: () => void }
  Scene_Battle?: new () => object
  SceneManager?: { _scene?: object }
  Game_Actor?: {
    prototype: {
      isAutoBattle: () => boolean
      makeAutoBattleActions?: () => void
      __chayaAutoBattle?: boolean
      __chayaSmartBattle?: boolean
    }
  }
  Game_Action?: new (subject: unknown, forcing?: boolean) => any
  $gameParty?: {
    battleMembers?: () => AutoActor[]
    aliveMembers?: () => any[]
    deadMembers?: () => any[]
    items?: () => any[]
    numItems?: (item: any) => number
  }
  $gameTroop?: {
    aliveMembers?: () => any[]
    isEventRunning?: () => boolean
  }
}

const g = () => globalThis as unknown as BattleGlobals

function createAction(actor: unknown): any {
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

function setActionItem(action: any, itemId: number) {
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

function setActionTarget(action: any, targetIndex: number) {
  if (typeof action.setTarget === 'function') {
    action.setTarget(targetIndex)
  } else {
    action._targetIndex = targetIndex
  }
}

function safeEvaluateDamage(action: any, target: any): number {
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
      return typeof val === 'number' && !isNaN(val) ? Math.max(val, 0) : 0
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
    const dmg = safeEvaluateDamage(act, target)
    if (dmg > 0) total += dmg
  }
  if (Array.isArray(itemOrSkill.effects)) {
    for (const eff of itemOrSkill.effects) {
      if (eff && eff.code === 11) {
        const pct = typeof eff.value1 === 'number' ? eff.value1 : 0
        const flat = typeof eff.value2 === 'number' ? eff.value2 : 0
        total += Math.round((target.mhp ?? 1) * pct + flat)
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
    const dmg = safeEvaluateDamage(act, target)
    if (dmg > 0) total += dmg
  }
  if (Array.isArray(itemOrSkill.effects)) {
    for (const eff of itemOrSkill.effects) {
      if (eff && eff.code === 12) {
        const pct = typeof eff.value1 === 'number' ? eff.value1 : 0
        const flat = typeof eff.value2 === 'number' ? eff.value2 : 0
        total += Math.round((target.mmp ?? 1) * pct + flat)
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

export function selectBestAction(actor: AutoActor, availableMp: number, availableTp: number, virtualItems?: Map<number, number>): any {
  const action = createAction(actor)
  const canAttack = typeof actor.canAttack === 'function' ? actor.canAttack() : true
  const canGuard = typeof actor.canGuard === 'function' ? actor.canGuard() : true

  const allUsableSkills: any[] = typeof actor.usableSkills === 'function' ? actor.usableSkills() : []
  const usableSkills = allUsableSkills.filter((s) => {
    if (!s || typeof s !== 'object') return false
    const mpCost = typeof actor.skillMpCost === 'function' ? actor.skillMpCost(s) : (s.mpCost ?? 0)
    const tpCost = typeof actor.skillTpCost === 'function' ? actor.skillTpCost(s) : (s.tpCost ?? 0)
    return mpCost <= availableMp && tpCost <= availableTp
  })

  const usableItems = getUsableItems(actor, virtualItems)

  const party = g().$gameParty
  const troop = g().$gameTroop || gameTroop()
  const aliveAllies: any[] = typeof party?.aliveMembers === 'function' ? party.aliveMembers() : []
  const deadAllies: any[] = typeof party?.deadMembers === 'function' ? party.deadMembers() : []
  const aliveEnemies: any[] = typeof troop?.aliveMembers === 'function' ? troop.aliveMembers() : []

  // 1. 救急：复活阵亡队友 (优先复活技能；若无技能则使用复活道具如不死鸟之尾)
  if (deadAllies.length > 0) {
    const reviveSkill = usableSkills.find((s) => s.scope === 9 || s.scope === 10)
    if (reviveSkill) {
      action.setSkill(reviveSkill.id)
      const targetIdx = typeof deadAllies[0].index === 'function' ? deadAllies[0].index() : 0
      setActionTarget(action, targetIdx)
      return action
    }
    const reviveItem = usableItems.find((i) => i.scope === 9 || i.scope === 10)
    if (reviveItem) {
      setActionItem(action, reviveItem.id)
      const targetIdx = typeof deadAllies[0].index === 'function' ? deadAllies[0].index() : 0
      setActionTarget(action, targetIdx)
      return action
    }
  }

  // 2. 救急：低血量回复 (< 40% HP)
  let lowestAlly: any = null
  let lowestRate = 1
  if (aliveAllies.length > 0) {
    lowestAlly = aliveAllies.slice().sort((a, b) => {
      const rA = (a.hp ?? 1) / Math.max(a.mhp ?? 1, 1)
      const rB = (b.hp ?? 1) / Math.max(b.mhp ?? 1, 1)
      return rA - rB
    })[0]
    lowestRate = lowestAlly ? (lowestAlly.hp ?? 1) / Math.max(lowestAlly.mhp ?? 1, 1) : 1
    if (lowestRate < 0.4) {
      const isSelf = lowestAlly === actor || (typeof lowestAlly.index === 'function' && typeof actor.index === 'function' && lowestAlly.index() === actor.index())
      // 默认优先使用技能 (可再生资源)
      const healSkill = usableSkills.find((s) => {
        if (!s) return false
        if (s.scope === 11 && !isSelf) return false
        const rec = estimateHpRecovery(s, actor, lowestAlly)
        return rec > 0 || s.damage?.type === 3
      })
      if (healSkill) {
        action.setSkill(healSkill.id)
        const targetIdx = typeof lowestAlly.index === 'function' ? lowestAlly.index() : 0
        setActionTarget(action, targetIdx)
        return action
      }
      // 无技能/空蓝时使用道具：智能缺口匹配 + 过期低效道具淘汰
      const healItem = matchBestHealingItem(usableItems, actor, lowestAlly)
      if (healItem) {
        setActionItem(action, healItem.id)
        const targetIdx = typeof lowestAlly.index === 'function' ? lowestAlly.index() : 0
        setActionTarget(action, targetIdx)
        return action
      }
    }
  }

  // 2.5 资源续航：MP 监听与道具回蓝
  // 当全队无濒死危险时，若角色当前 MP 偏低 (< 25% 且有技能需消耗 MP)，检查回蓝道具
  const maxMp = actor.mmp ?? 100
  const curMp = actor.mp ?? maxMp
  const learnedSkills: any[] = typeof (actor as any).skills === 'function' ? (actor as any).skills() : allUsableSkills
  const hasMpSkill = learnedSkills.some((s) => {
    if (!s) return false
    const cost = typeof actor.skillMpCost === 'function' ? actor.skillMpCost(s) : s.mpCost
    return cost === undefined || cost > 0
  })
  if (maxMp > 0 && curMp / maxMp < 0.25 && hasMpSkill && lowestRate >= 0.4) {
    const mpItem = usableItems.find((item) => {
      if (![7, 11].includes(item.scope)) return false
      return estimateMpRecovery(item, actor, actor) > 0
    })
    if (mpItem) {
      setActionItem(action, mpItem.id)
      const targetIdx = typeof actor.index === 'function' ? actor.index() : 0
      setActionTarget(action, targetIdx)
      return action
    }
  }

  // 3. 敌群态势：群怪 AOE (存活敌人 >= 2 且拥有可用全体攻击)
  if (aliveEnemies.length >= 2) {
    const aoeSkill = usableSkills.find((s) => s.scope === 2 && s.damage && [1, 5].includes(s.damage.type))
    if (aoeSkill) {
      action.setSkill(aoeSkill.id)
      setActionTarget(action, 0)
      return action
    }
  }

  // 4. 单体集火与优势技能选择 (按当前血量升序排列，优先集火残血)
  const sortedEnemies = aliveEnemies.slice().sort((a, b) => (a.hp ?? 0) - (b.hp ?? 0))
  const focusEnemy = sortedEnemies[0]

  let attackDmg = 0
  if (canAttack && focusEnemy) {
    const testAttack = createAction(actor)
    testAttack.setAttack()
    attackDmg = safeEvaluateDamage(testAttack, focusEnemy)
  }

  let bestSkill: any = null
  let bestScore = 0
  let bestTarget = focusEnemy

  for (const skill of usableSkills) {
    if (!skill?.damage || ![1, 5].includes(skill.damage.type)) continue
    const testSkill = createAction(actor)
    testSkill.setSkill(skill.id)
    for (const enemy of aliveEnemies) {
      const dmg = safeEvaluateDamage(testSkill, enemy)
      // 若伤害能够直接斩杀敌人，赋予高额斩杀权重
      const killBonus = dmg >= (enemy.hp ?? 0) && (enemy.hp ?? 0) > 0 ? 10000 : 0
      const score = dmg + killBonus
      if (score > bestScore) {
        bestScore = score
        bestSkill = skill
        bestTarget = enemy
      }
    }
  }

  // 技能优选条件：
  // a. 被缴械无法普攻 (!canAttack)，只要有技能必须放技能
  // b. 技能可斩杀敌人 (bestScore >= 10000)
  // c. 技能伤害明显优于普攻 (bestScore > attackDmg * 1.15)
  if (bestSkill && (!canAttack || bestScore >= 10000 || bestScore > attackDmg * 1.15)) {
    action.setSkill(bestSkill.id)
    if (bestTarget) {
      const targetIdx = typeof bestTarget.index === 'function' ? bestTarget.index() : 0
      setActionTarget(action, targetIdx)
    }
    return action
  }

  // 5. 普攻输出（未被缴械）
  if (canAttack && focusEnemy) {
    action.setAttack()
    const targetIdx = typeof focusEnemy.index === 'function' ? focusEnemy.index() : 0
    setActionTarget(action, targetIdx)
    return action
  }

  // 6. 投掷类攻击道具：被缴械或无法普攻时，优先使用投掷攻击道具打击敌人
  if (!canAttack && focusEnemy) {
    const throwItem = usableItems.find((i) => [1, 2].includes(i.scope) && i.damage && [1, 5].includes(i.damage.type))
    if (throwItem) {
      setActionItem(action, throwItem.id)
      const targetIdx = typeof focusEnemy.index === 'function' ? focusEnemy.index() : 0
      setActionTarget(action, targetIdx)
      return action
    }
  }

  // 7. 缴械且无伤害手段时，若有其他可用技能（如 Buff/Debuff），施放该技能
  if (!canAttack && usableSkills.length > 0) {
    action.setSkill(usableSkills[0].id)
    return action
  }

  // 8. 缴械且无可用技能/道具时，防御（Guard）兜底，彻底杜绝死磕平 A 与卡死！
  if (canGuard && typeof action.setGuard === 'function') {
    action.setGuard()
    return action
  }

  // 终极保护：若连 Guard 都不可用，按普攻/防御 fallback
  if (canAttack && typeof action.setAttack === 'function') {
    action.setAttack()
  } else if (typeof action.setGuard === 'function') {
    action.setGuard()
  }
  return action
}

export function makeSmartAutoBattleActions(actor: AutoActor) {
  if (!actor) return
  if (typeof actor.isConfusion === 'function' && actor.isConfusion()) {
    actor.makeConfusionActions?.()
    return
  }

  const numActions = typeof actor.numActions === 'function' ? actor.numActions() : 1
  let virtualMp = typeof actor.mp === 'number' ? actor.mp : 9999
  let virtualTp = typeof actor.tp === 'number' ? actor.tp : 9999
  const virtualItems = new Map<number, number>()

  for (let i = 0; i < numActions; i++) {
    const action = selectBestAction(actor, virtualMp, virtualTp, virtualItems)
    if (action) {
      const isSkill = action._actionType === 'skill' || (typeof action.isSkill === 'function' && action.isSkill())
      const isItem = action._actionType === 'item' || (typeof action.isItem === 'function' && action.isItem())
      if (isSkill) {
        const skill = typeof action.item === 'function' ? action.item() : null
        if (skill) {
          const mpCost = typeof actor.skillMpCost === 'function' ? actor.skillMpCost(skill) : (skill.mpCost ?? 0)
          const tpCost = typeof actor.skillTpCost === 'function' ? actor.skillTpCost(skill) : (skill.tpCost ?? 0)
          virtualMp -= mpCost
          virtualTp -= tpCost
        }
      } else if (isItem) {
        const itemObj = typeof action.item === 'function' ? action.item() : null
        const itemId = action._itemId ?? itemObj?.id
        if (typeof itemId === 'number') {
          virtualItems.set(itemId, (virtualItems.get(itemId) ?? 0) + 1)
        }
      }
      if (typeof actor.setAction === 'function') {
        actor.setAction(i, action)
      }
    }
  }
  actor.setActionState?.('waiting')
}

/** Patch once; forced flag is read live so dispose only clears the run switch. */
export function ensureAutoBattleActorHook(forced: () => boolean) {
  const proto = g().Game_Actor?.prototype
  if (!proto) return

  if (typeof proto.isAutoBattle === 'function' && !proto.__chayaAutoBattle) {
    const original = proto.isAutoBattle
    proto.isAutoBattle = function (this: unknown) {
      if (forced()) return true
      return original.call(this)
    }
    proto.__chayaAutoBattle = true
  }

  if (typeof proto.makeAutoBattleActions === 'function' && !proto.__chayaSmartBattle) {
    const originalMake = proto.makeAutoBattleActions
    proto.makeAutoBattleActions = function (this: unknown) {
      if (forced()) {
        try {
          makeSmartAutoBattleActions(this as AutoActor)
        } catch {
          // A third-party action API must not leave the battle stuck on input.
          originalMake.call(this)
        }
        return
      }
      originalMake.call(this)
    }
    proto.__chayaSmartBattle = true
  }
}

/**
 * Native auto-battle already finishes most turns inside startInput. This tick
 * only runs when the party is still stuck on input (flag toggled mid-menu,
 * battle plugins that ignore canInput, or actions never filled).
 */
export function tryAutoBattle(enabled: boolean, autoWin: boolean, sceneLatch: object | null): object | null {
  if (!enabled || autoWin) return sceneLatch
  ensureAutoBattleActorHook(() => enabled && !autoWin)
  const { BattleManager, Scene_Battle, SceneManager, $gameParty } = g()
  if (!BattleManager || typeof Scene_Battle !== 'function' || !SceneManager) return sceneLatch
  const scene = SceneManager._scene
  if (!(scene instanceof Scene_Battle)) return null
  if (String(BattleManager._phase) !== 'input') return null
  if (sceneLatch === scene) return sceneLatch
  if (typeof gameTroop()?.isEventRunning === 'function' && gameTroop().isEventRunning()) return sceneLatch
  if (typeof gameMessage()?.isBusy === 'function' && gameMessage().isBusy()) return sceneLatch

  const members = typeof $gameParty?.battleMembers === 'function' ? $gameParty.battleMembers() : []
  let prepared = 0
  for (const actor of members) {
    if (!actor) continue
    // isAutoBattle makes canInput false; still need actions when enabling mid-input.
    if (typeof actor.canMove === 'function' && !actor.canMove()) continue
    if (typeof actor.makeAutoBattleActions === 'function') {
      actor.makeAutoBattleActions()
      prepared += 1
    } else {
      try {
        makeSmartAutoBattleActions(actor)
      } catch {
        actor.makeActions?.()
      }
      prepared += 1
    }
  }
  if (!prepared && members.length) return sceneLatch

  closeBattleInputWindows()
  const windows = scene as { _partyCommandWindow?: CommandWindow; _actorCommandWindow?: CommandWindow }
  for (const w of [windows._partyCommandWindow, windows._actorCommandWindow]) {
    if (!w) continue
    w.deactivate?.()
    w.close?.()
    w.hide?.()
  }
  const startTurn = BattleManager.startTurn
  if (typeof startTurn !== 'function') return sceneLatch
  startTurn.call(BattleManager)
  // Only latch after the engine actually left input; otherwise retry next tick.
  return String(BattleManager._phase) !== 'input' ? scene : null
}
