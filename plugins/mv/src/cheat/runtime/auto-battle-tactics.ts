/** Contextual action selection, independent of engine input and command windows. */
import {
  type AutoActor,
  createAction,
  estimateHpRecovery,
  estimateMpRecovery,
  getUsableItems,
  hasUsefulEffect,
  matchBestHealingItem,
  safeEvaluateDamage,
  setActionItem,
  setActionTarget,
} from './auto-battle-effects'
import { gameTroop } from './game-globals'

const g = () => globalThis as unknown as { $gameParty?: { aliveMembers?: () => any[]; deadMembers?: () => any[] }; $gameTroop?: { aliveMembers?: () => any[] } }

export function selectBestAction(actor: AutoActor, availableMp: number, availableTp: number, virtualItems?: Map<number, number>): any {
  const action = createAction(actor)
  const canAttack = typeof actor.canAttack === 'function' ? actor.canAttack() : true
  const canGuard = typeof actor.canGuard === 'function' ? actor.canGuard() : true

  const allUsableSkills: any[] = typeof actor.usableSkills === 'function' ? actor.usableSkills() : []
  const usableSkills = allUsableSkills.filter((s) => {
    if (!s || typeof s !== 'object') return false
    if (s.id === actor.attackSkillId?.() || s.id === actor.guardSkillId?.()) return false
    if (typeof actor.canUse === 'function' && !actor.canUse(s)) return false
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
        if (![7, 8, 11].includes(s.scope)) return false
        const rec = estimateHpRecovery(s, actor, lowestAlly)
        return rec > 0
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

  // 3. 资源续航：MP 监听与技能/道具回蓝 (在无致命危险时，MP < 35% 则补充蓝量)
  const maxMp = actor.mmp ?? 100
  const curMp = Math.min(maxMp, availableMp)
  const learnedSkills: any[] = typeof actor.skills === 'function' ? actor.skills() : allUsableSkills
  const hasMpSkill = learnedSkills.some((s) => {
    if (!s) return false
    const cost = typeof actor.skillMpCost === 'function' ? actor.skillMpCost(s) : s.mpCost
    return (cost ?? 0) > 0
  })
  if (maxMp > 0 && curMp / maxMp < 0.35 && hasMpSkill && lowestRate >= 0.4) {
    const mpSkill = usableSkills.find((s) => {
      const cost = typeof actor.skillMpCost === 'function' ? actor.skillMpCost(s) : (s.mpCost ?? 0)
      return [7, 8, 11].includes(s.scope) && estimateMpRecovery(s, actor, actor) > cost
    })
    if (mpSkill) {
      action.setSkill(mpSkill.id)
      const targetIdx = actor.index?.() ?? 0
      setActionTarget(action, targetIdx)
      return action
    }
    const mpItems = usableItems.filter((item) => [7, 8, 11].includes(item.scope) && estimateMpRecovery(item, actor, actor) > 0)
    const mpItem = mpItems.sort((a, b) => {
      const deficit = maxMp - curMp
      return Math.abs(estimateMpRecovery(a, actor, actor) - deficit) - Math.abs(estimateMpRecovery(b, actor, actor) - deficit)
    })[0]
    if (mpItem) {
      setActionItem(action, mpItem.id)
      const targetIdx = actor.index?.() ?? 0
      setActionTarget(action, targetIdx)
      return action
    }
  }

  // 4. 敌群态势：群怪 AOE (存活敌人 >= 2 且拥有可用全体攻击)
  if (aliveEnemies.length >= 2) {
    const aoeSkill = usableSkills.find((s) => {
      if (![2, 4, 5, 6].includes(s.scope)) return false
      const probe = createAction(actor)
      probe.setSkill(s.id)
      return aliveEnemies.some((enemy) => ([1, 5].includes(s.damage?.type) && safeEvaluateDamage(probe, enemy) > 0) || hasUsefulEffect(s, enemy, [21, 32, 33]))
    })
    if (aoeSkill) {
      action.setSkill(aoeSkill.id)
      setActionTarget(action, 0)
      return action
    }
  }

  // 5. 单体集火与优势技能选择 (默认优先使用战技/魔法，高于平 A；若被缴械必须放技能)
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
    if (![1, 2, 3, 4, 5, 6].includes(skill.scope ?? 1)) continue
    const isDamageSkill = skill.damage && [1, 5].includes(skill.damage.type)

    const testSkill = createAction(actor)
    testSkill.setSkill(skill.id)
    for (const enemy of aliveEnemies) {
      const dmg = isDamageSkill ? safeEvaluateDamage(testSkill, enemy) : 0
      const hasOffensiveEffect = hasUsefulEffect(skill, enemy, [21, 32, 33])
      // 若伤害公式抛错或归 0，且无特殊特效，则不纳入优势技能候选池，确保异常技能不被误选
      if (dmg <= 0 && !hasOffensiveEffect) continue
      // 斩杀加成
      const killBonus = dmg >= (enemy.hp ?? 0) && (enemy.hp ?? 0) > 0 ? 10000 : 0
      const effectBonus = hasOffensiveEffect ? 50 : 0
      const cost = typeof actor.skillMpCost === 'function' ? actor.skillMpCost(skill) : (skill.mpCost ?? 0)
      const score = Math.min(dmg, enemy.hp ?? dmg) + killBonus + effectBonus - cost * 0.001
      if (score > bestScore) {
        bestScore = score
        bestSkill = skill
        bestTarget = enemy
      }
    }
  }

  // Prefer useful skills; conserve MP when a basic attack already finishes the target.
  const basicFinishes = focusEnemy && attackDmg > 0 && attackDmg >= focusEnemy.hp
  const bestCost = bestSkill ? (actor.skillMpCost?.(bestSkill) ?? bestSkill.mpCost ?? 0) + (actor.skillTpCost?.(bestSkill) ?? bestSkill.tpCost ?? 0) : 0
  if (bestSkill && !(basicFinishes && bestCost > 0)) {
    action.setSkill(bestSkill.id)
    if (bestTarget) {
      const targetIdx = typeof bestTarget.index === 'function' ? bestTarget.index() : 0
      setActionTarget(action, targetIdx)
    }
    return action
  }

  // 6. 自身与团队增益战技 (如加攻/加速/加盾等，未达到层数上限时施放)
  for (const skill of usableSkills) {
    if (![7, 8, 11].includes(skill.scope)) continue
    const targets = skill.scope === 11 ? [actor] : aliveAllies
    const target = targets.find((ally) => hasUsefulEffect(skill, ally, [21, 22, 31, 34]))
    if (target) {
      action.setSkill(skill.id)
      setActionTarget(action, target.index?.() ?? 0)
      return action
    }
  }

  // 7. 缴械且无技能方案时，仅向可受到有效伤害的敌人投掷道具。
  if (!canAttack) {
    for (const item of usableItems) {
      if (![1, 2, 3, 4, 5, 6].includes(item.scope) || ![1, 5].includes(item.damage?.type)) continue
      const probe = createAction(actor)
      setActionItem(probe, item.id)
      const target = sortedEnemies.find((enemy) => safeEvaluateDamage(probe, enemy) > 0)
      if (!target) continue
      setActionItem(action, item.id)
      setActionTarget(action, target.index?.() ?? 0)
      return action
    }
  }

  // 8. 基础普攻输出 (未被缴械且无更好技能时)
  if (canAttack && focusEnemy) {
    action.setAttack()
    const targetIdx = typeof focusEnemy.index === 'function' ? focusEnemy.index() : 0
    setActionTarget(action, targetIdx)
    return action
  }

  // 9. 缴械且无有效技能或道具时，使用可用的防御。
  if (canGuard && typeof action.setGuard === 'function') {
    action.setGuard()
    return action
  }

  // An empty action is skipped by the engine when both attack and guard are sealed.
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
        if (typeof itemId === 'number' && itemObj?.consumable !== false) {
          virtualItems.set(itemId, (virtualItems.get(itemId) ?? 0) + 1)
        }
      }
      const selected = action.item?.()
      const targetIndex = action._targetIndex
      if (selected && (selected.scope === 8 || selected.scope === 11 || targetIndex === actor.index?.())) {
        virtualMp = Math.min(actor.mmp ?? 9999, virtualMp + estimateMpRecovery(selected, actor, actor))
      }
      if (typeof actor.setAction === 'function') {
        actor.setAction(i, action)
      }
    }
  }
  actor.setActionState?.('waiting')
}
