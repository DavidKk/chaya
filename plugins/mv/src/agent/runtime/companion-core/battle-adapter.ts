/**
 * MV / MZ Battle Adapter for Companion Core.
 * Extracts BattleFrame, CommandOpportunity, and ActionOffer contracts from RPG Maker.
 */

import type {
  ActionOffer,
  BattleEnemyEntity,
  BattleFrame,
  BattlePartyEntity,
  BattlePhase,
  CommandOpportunity,
  ObservedOrDeclaredEffect,
  SupportedTargetRule,
} from '@/lib/game-agent/companion/core/types'
import type { ContextStamp } from '@/lib/game-agent/companion/types'
import { getUsableItems } from '@/plugins/mv/src/helpers/game/battle-effects'

import { call, g, getBattleScene, type Loose } from './battle-engine'

function parseSkillTargetRule(scopeNum: number): SupportedTargetRule {
  if (scopeNum === 1) return 'one_enemy'
  if (scopeNum === 2) return 'all_enemies'
  if (scopeNum === 7) return 'one_ally'
  if (scopeNum === 8) return 'all_allies'
  if (scopeNum === 9) return 'one_dead_ally'
  if (scopeNum === 10) return 'all_dead_allies'
  if (scopeNum === 11) return 'user'
  if (scopeNum === 0) return 'none'
  return 'unsupported'
}

function parseSkillEffect(skill: Loose): ObservedOrDeclaredEffect {
  const damage = skill.damage as Loose | undefined
  const damageType = Number(damage?.type ?? 0)

  // Type 3 in RPG Maker is HP Recover
  if (damageType === 3 || (Array.isArray(skill.effects) && skill.effects.some((e: Loose) => e.code === 11 && (Number(e.value1) > 0 || Number(e.value2) > 0)))) {
    return { kind: 'heal' }
  }
  // Scope 9/10 or State 1 (Knockout/Death) removal is revive -> heal
  if (Number(skill.scope) === 9 || Number(skill.scope) === 10 || (Array.isArray(skill.effects) && skill.effects.some((e: Loose) => e.code === 22 && Number(e.dataId) === 1))) {
    return { kind: 'heal' }
  }
  if (damageType === 1 || damageType === 5) {
    return { kind: 'damage' }
  }
  if (damageType === 2 || damageType === 4 || damageType === 6) {
    return { kind: 'damage' }
  }
  return { kind: 'other' }
}

function skillCosts(actor: Loose, skill: Loose | undefined): ActionOffer['costs'] {
  if (!skill) return { mp: 0, tp: 0, hasUnknownCost: true }
  const mp = call<number>(actor, 'skillMpCost', skill) ?? Number(skill.mpCost)
  const tp = call<number>(actor, 'skillTpCost', skill) ?? Number(skill.tpCost)
  if (!Number.isFinite(mp) || mp < 0 || !Number.isFinite(tp) || tp < 0) return { mp: 0, tp: 0, hasUnknownCost: true }
  return { mp, tp }
}

export function readLiveBattleFrame(stamp: ContextStamp, capabilitiesRevision: number, encounterId: string): BattleFrame | null {
  const scene = getBattleScene()
  if (!scene || !encounterId) return null

  const bm = g().BattleManager as Loose | undefined
  if (!bm) return null

  const isBattleEnd = Boolean(call<boolean>(bm, 'isBattleEnd') || bm._phase === 'battleEnd')
  const isInputting = Boolean(call<boolean>(bm, 'isInputting'))
  const isInTurn = Boolean(call<boolean>(bm, 'isInTurn') || bm._phase === 'turn')
  const currentActor = call<Loose>(bm, 'actor') ?? null
  const turnCount = Number(call<number>(g().$gameTroop, 'turnCount') ?? 0)

  let phase: BattlePhase = 'resolving'
  if (isBattleEnd) {
    phase = 'result'
  } else if (isInputting) {
    phase = currentActor ? 'actor_command' : 'party_command'
  } else if (isInTurn) {
    phase = 'resolving'
  }

  // Party members
  const gp = g().$gameParty as Loose | undefined
  const battleMembers = (call<Loose[]>(gp, 'battleMembers') ?? []).slice(0, 16)
  const party: BattlePartyEntity[] = battleMembers.map((member, index) => {
    const actorId = call<number>(member, 'actorId') ?? index + 1
    const name = String(call<string>(member, 'name') ?? `Actor ${actorId}`)
    const hp = Number(call<number>(member, 'hp') ?? member?.hp ?? 0)
    const hpMax = Number(call<number>(member, 'mhp') ?? member?.mhp ?? 1)
    const mp = Number(call<number>(member, 'mp') ?? member?.mp ?? 0)
    const mpMax = Number(call<number>(member, 'mmp') ?? member?.mmp ?? 0)
    const tp = Number(call<number>(member, 'tp') ?? member?.tp ?? 0)
    const isDead = Boolean(call<boolean>(member, 'isDead') ?? hp <= 0)
    const statesRaw = (call<Loose[]>(member, 'states') ?? []).slice(0, 8)
    const states = statesRaw.map((s) => ({
      id: Number(s?.id ?? 0),
      name: String(s?.name ?? ''),
    }))

    return {
      actorId,
      name,
      index,
      hp,
      hpMax,
      mp,
      mpMax,
      tp,
      isDead,
      states,
    }
  })

  // Enemies
  const gt = g().$gameTroop as Loose | undefined
  const troopMembers = (call<Loose[]>(gt, 'members') ?? []).slice(0, 16)
  const enemies: BattleEnemyEntity[] = troopMembers.flatMap((enemy, index) => {
    // Hidden reinforcements retain their troop index, but cannot be selected yet.
    if (call<boolean>(enemy, 'isAppeared') === false || call<boolean>(enemy, 'isHidden') === true) return []
    const enemyId = Number(call<number>(enemy, 'enemyId') ?? (enemy?.enemyId as number) ?? index + 1)
    const name = String(call<string>(enemy, 'name') ?? `Enemy ${index + 1}`)
    const hp = Number(call<number>(enemy, 'hp') ?? enemy?.hp ?? 0)
    const hpMax = Number(call<number>(enemy, 'mhp') ?? enemy?.mhp ?? 1)
    const isDead = Boolean(call<boolean>(enemy, 'isDead') ?? hp <= 0)
    const statesRaw = (call<Loose[]>(enemy, 'states') ?? []).slice(0, 8)
    const states = statesRaw.map((s) => ({
      id: Number(s?.id ?? 0),
      name: String(s?.name ?? ''),
    }))

    return [
      {
        enemyId,
        instanceId: `enemy:${index}`,
        name,
        index,
        hp,
        hpMax,
        isDead,
        states,
      },
    ]
  })

  // Opportunities & Offers
  let opportunity: CommandOpportunity | null = null
  const offers: ActionOffer[] = []

  if (phase === 'party_command') {
    opportunity = {
      opportunityId: `${encounterId}:turn:${turnCount}:party`,
      actor: null,
      actionSlot: null,
      kind: 'party',
    }
    offers.push({
      actionKey: 'party:fight',
      actor: null,
      kind: 'attack',
      name: '战斗',
      targetRule: 'none',
      costs: { mp: 0, tp: 0 },
      effect: { kind: 'other' },
    })
  } else if (phase === 'actor_command' && currentActor) {
    const actorId = call<number>(currentActor, 'actorId') ?? 1
    const actionSlot = Number(currentActor._actionInputIndex ?? call<number>(currentActor, 'actionInputIndex'))
    if (!Number.isInteger(actionSlot) || actionSlot < 0) return null
    const actorRef = { kind: 'actor' as const, id: actorId, instance: `actor:${actorId}` }

    opportunity = {
      opportunityId: `${encounterId}:turn:${turnCount}:actor:${actorId}:slot:${actionSlot}`,
      actor: actorRef,
      actionSlot,
      kind: 'actor',
    }

    if (call<boolean>(currentActor, 'canAttack') === true) {
      const abilityId = call<number>(currentActor, 'attackSkillId') ?? 1
      offers.push({
        actionKey: `actor:${actorId}:attack`,
        actor: actorRef,
        kind: 'attack',
        abilityId,
        name: '攻击',
        targetRule: 'one_enemy',
        costs: skillCosts(currentActor, (g().$dataSkills as Loose[] | undefined)?.[abilityId]),
        effect: { kind: 'damage' },
      })
    }

    if (call<boolean>(currentActor, 'canGuard') === true) {
      const abilityId = call<number>(currentActor, 'guardSkillId') ?? 2
      offers.push({
        actionKey: `actor:${actorId}:guard`,
        actor: actorRef,
        kind: 'guard',
        abilityId,
        name: '防御',
        targetRule: 'user',
        costs: skillCosts(currentActor, (g().$dataSkills as Loose[] | undefined)?.[abilityId]),
        effect: { kind: 'guard' },
      })
    }

    const skillTypes = call<number[]>(currentActor, 'addedSkillTypes') ?? []
    const skills = (call<Loose[]>(currentActor, 'skills') ?? []).slice(0, 64)
    for (const skill of skills) {
      if (!skill || typeof skill !== 'object') continue
      const skillId = Number(skill.id)
      if (!Number.isFinite(skillId) || skillId <= 0) continue
      if (!skillTypes.includes(Number(skill.stypeId))) continue
      if (!call<boolean>(currentActor, 'canUse', skill)) continue

      const name = String(skill.name ?? `Skill ${skillId}`)
      const scopeNum = Number(skill.scope ?? 1)
      const targetRule = parseSkillTargetRule(scopeNum)
      const effect = parseSkillEffect(skill)

      offers.push({
        actionKey: `actor:${actorId}:skill:${skillId}`,
        actor: actorRef,
        kind: 'skill',
        abilityId: skillId,
        skillTypeId: Number(skill.stypeId),
        name,
        targetRule,
        costs: skillCosts(currentActor, skill),
        effect,
      })
    }

    const usableItems = getUsableItems(currentActor as any)
    for (const item of usableItems) {
      if (!item || typeof item !== 'object') continue
      const itemId = Number(item.id)
      if (!Number.isFinite(itemId) || itemId <= 0) continue

      const name = String(item.name ?? `Item ${itemId}`)
      const scopeNum = Number(item.scope ?? 1)
      const targetRule = parseSkillTargetRule(scopeNum)
      const effect = parseSkillEffect(item)

      offers.push({
        actionKey: `actor:${actorId}:item:${itemId}`,
        actor: actorRef,
        kind: 'item',
        abilityId: itemId,
        name,
        targetRule,
        costs: { mp: 0, tp: 0 },
        effect,
      })
    }
  }

  return {
    stamp,
    encounterId,
    turnCount,
    phase,
    opportunity,
    party,
    enemies,
    offers,
    capabilitiesRevision,
  }
}
