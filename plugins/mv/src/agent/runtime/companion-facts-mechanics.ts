import type {
  FactEnemyMember,
  FactEntityRef,
  FactLegalAction,
  FactPartyMember,
  KnownMechanics,
  KnownSkillMechanic,
  KnownStateMechanic,
  StandardHitType,
  StandardMechanicElement,
} from '@/lib/game-agent/companion/types'

type Loose = Record<string, unknown>
const g = () => globalThis as unknown as Loose

export function call<T>(obj: unknown, name: string, ...args: unknown[]): T | undefined {
  try {
    const fn = (obj as Loose | null | undefined)?.[name]
    return typeof fn === 'function' ? ((fn as (...a: unknown[]) => unknown).apply(obj, args) as T) : undefined
  } catch {
    return undefined
  }
}

export function readLegalActions(): FactLegalAction[] {
  const w = g()
  const party = (call<unknown[]>(w.$gameParty, 'battleMembers') ?? call<unknown[]>(w.$gameParty, 'members') ?? []).slice(0, 16)
  const actions: FactLegalAction[] = []

  party.forEach((member, index) => {
    if (actions.length >= 256) return
    if (!member || call<boolean>(member, 'isDead')) return
    const canMove = call<boolean>(member, 'canMove') ?? false
    if (!canMove) return

    if (call<boolean>(member, 'canAttack') ?? false) {
      actions.push({
        actionKey: `actor:${index}:attack`,
        kind: 'attack',
        actorIndex: index,
        name: '攻击',
        targetScope: 'one_enemy',
      })
    }
    if (call<boolean>(member, 'canGuard') ?? false) {
      actions.push({
        actionKey: `actor:${index}:guard`,
        kind: 'guard',
        actorIndex: index,
        name: '防御',
        targetScope: 'user',
      })
    }
    const skills = call<unknown[]>(member, 'skills') ?? []
    for (const skill of skills) {
      if (actions.length >= 256) break
      if (!skill || typeof skill !== 'object') continue
      const skillId = Number((skill as Loose).id)
      if (!Number.isFinite(skillId) || skillId <= 0) continue
      const canUse = call<boolean>(member, 'canUse', skill) ?? false
      if (!canUse) continue

      const mpCost = call<number>(member, 'skillMpCost', skill) ?? Number((skill as Loose).mpCost) ?? 0
      const tpCost = call<number>(member, 'skillTpCost', skill) ?? Number((skill as Loose).tpCost) ?? 0
      const name = String((skill as Loose).name ?? '')
      const scopeNum = Number((skill as Loose).scope)
      let targetScope: FactLegalAction['targetScope']
      if (scopeNum === 1 || scopeNum === 2) targetScope = scopeNum === 2 ? 'all_enemies' : 'one_enemy'
      else if (scopeNum >= 7 && scopeNum <= 10) targetScope = scopeNum === 8 || scopeNum === 10 ? 'all_allies' : 'one_ally'
      else if (scopeNum === 11) targetScope = 'user'
      else if (scopeNum === 0) targetScope = 'none'

      actions.push({
        actionKey: `actor:${index}:skill:${skillId}`,
        kind: 'skill',
        actorIndex: index,
        id: skillId,
        name,
        mpCost,
        tpCost,
        targetScope,
      })
    }
  })

  return actions
}

export function readPartyFacts(): FactPartyMember[] {
  const w = g()
  const party = call<unknown[]>(w.$gameParty, 'members') ?? []
  return party.map((member, index) => {
    const actorId = call<number>(member, 'actorId') ?? index + 1
    const name = String(call<string>(member, 'name') ?? `Actor ${actorId}`)
    const hp = Number(call<number>(member, 'hp') ?? (member as Loose)?.hp ?? 0)
    const hpMax = Number(call<number>(member, 'mhp') ?? (member as Loose)?.mhp ?? 1)
    const mp = Number(call<number>(member, 'mp') ?? (member as Loose)?.mp ?? 0)
    const mpMax = Number(call<number>(member, 'mmp') ?? (member as Loose)?.mmp ?? 0)
    const tp = Number(call<number>(member, 'tp') ?? (member as Loose)?.tp ?? 0)
    const isDead = Boolean(call<boolean>(member, 'isDead') ?? hp <= 0)
    const statesRaw = call<unknown[]>(member, 'states') ?? []
    const states = statesRaw.slice(0, 16).map((s) => ({
      stateId: Number((s as Loose)?.id ?? 0),
      name: String((s as Loose)?.name ?? ''),
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
}

export function readEnemyFacts(): FactEnemyMember[] {
  const w = g()
  const troop = call<unknown[]>(w.$gameTroop, 'members') ?? []
  return troop.map((enemy, index) => {
    const enemyId = Number(call<number>(enemy, 'enemyId') ?? (enemy as Loose)?.enemyId ?? index + 1)
    const letter = String((enemy as Loose)?.letter ?? '')
    const name = String(call<string>(enemy, 'name') ?? `Enemy ${index + 1}`)
    const hp = typeof (enemy as Loose)?.hp === 'number' ? Number((enemy as Loose).hp) : null
    const hpMax = typeof (enemy as Loose)?.mhp === 'number' ? Number((enemy as Loose).mhp) : null
    const isDead = Boolean(call<boolean>(enemy, 'isDead') ?? hp === 0)
    const statesRaw = call<unknown[]>(enemy, 'states') ?? []
    const states = statesRaw.slice(0, 16).map((s) => ({
      stateId: Number((s as Loose)?.id ?? 0),
      name: String((s as Loose)?.name ?? ''),
    }))

    return {
      enemyId,
      instanceId: `enemy:${index}`,
      name,
      index,
      hp,
      hpMax,
      isDead,
      states,
      ...(letter ? { letter } : {}),
    }
  })
}

function mapHitType(code: unknown): StandardHitType {
  const num = Number(code)
  if (num === 0) return 'certain'
  if (num === 1) return 'physical'
  if (num === 2) return 'magical'
  return 'unknown'
}

function mapElement(elementId: unknown): { element: StandardMechanicElement; rawElementId?: number } {
  const id = Number(elementId)
  if (id <= 0) return { element: 'none', rawElementId: 0 }
  return { element: 'unknown', rawElementId: id }
}

/**
 * Reads mechanics bounded strictly by:
 * 1. Legal player skills and observed enemy skills.
 * 2. States currently present on party/enemies or linked to the above skills.
 * Never iterates arbitrarily across full database tables.
 */
export function readBoundedMechanics(
  legalActions: FactLegalAction[],
  observedSkillIds: Set<number>,
  party: FactPartyMember[],
  enemies: FactEnemyMember[],
  _entityRefs?: FactEntityRef[]
): KnownMechanics {
  const w = g()
  const skillsData = (w.$dataSkills as unknown[] | undefined) ?? []
  const statesData = (w.$dataStates as unknown[] | undefined) ?? []

  const skills: Record<number, KnownSkillMechanic> = {}
  const states: Record<number, KnownStateMechanic> = {}

  const activeSkillIds = new Set<number>()
  for (const act of legalActions) {
    if (act.kind === 'skill' && act.id) activeSkillIds.add(act.id)
  }
  for (const sId of [...observedSkillIds].slice(-128)) activeSkillIds.add(sId)

  // Bound state IDs strictly to active combat participants and skill effects
  const activeStateIds = new Set<number>([1]) // State 1 is Knockout in RM
  for (const member of party) {
    for (const st of member.states) if (st.stateId > 0) activeStateIds.add(st.stateId)
  }
  for (const enemy of enemies) {
    for (const st of enemy.states) if (st.stateId > 0) activeStateIds.add(st.stateId)
  }

  for (const id of [...activeSkillIds].slice(0, 256)) {
    const s = skillsData[id] as Loose | undefined
    if (!s) continue
    const damage = s.damage as Loose | undefined
    const hitType = mapHitType(s.hitType)
    const { element, rawElementId } = mapElement(damage?.elementId)
    const mpCost = Number(s.mpCost ?? 0)
    const tpCost = Number(s.tpCost ?? 0)

    const effects = (Array.isArray(s.effects) ? s.effects : []) as Loose[]
    const addedStateIds: number[] = []
    const removedStateIds: number[] = []

    for (const eff of effects) {
      if (eff.code === 21 && typeof eff.dataId === 'number' && eff.dataId > 0) {
        addedStateIds.push(eff.dataId)
        activeStateIds.add(eff.dataId)
      }
      if (eff.code === 22 && typeof eff.dataId === 'number' && eff.dataId > 0) {
        removedStateIds.push(eff.dataId)
        activeStateIds.add(eff.dataId)
      }
    }

    skills[id] = {
      skillId: id,
      name: String(s.name ?? '').slice(0, 100),
      element,
      rawElementId,
      hitType,
      scope: String(s.scope ?? ''),
      mpCost,
      tpCost,
      description: s.description ? String(s.description).slice(0, 600) : undefined,
      lethalRisk: 'unknown',
      addedStateIds: addedStateIds.slice(0, 8),
      removedStateIds: removedStateIds.slice(0, 8),
      isDisarmable: { value: null, known: false, sourceRefs: [] },
      isReflectable: {
        value: null,
        known: false,
        sourceRefs: [`$dataSkills[${id}].hitType`],
      },
      source: 'database_entry',
    }
  }

  for (const id of [...activeStateIds].slice(0, 128)) {
    const st = statesData[id] as Loose | undefined
    if (!st) continue
    const restrictionNum = Number(st.restriction ?? 0)
    let restriction: KnownStateMechanic['restriction'] = 'none'
    if (restrictionNum === 1) restriction = 'attack_enemy'
    else if (restrictionNum === 2) restriction = 'attack_ally'
    else if (restrictionNum === 4) restriction = 'cannot_move'

    states[id] = {
      stateId: id,
      name: String(st.name ?? ''),
      restriction,
      isKnockout: id === 1,
      source: 'database_entry',
    }
  }

  return {
    skills,
    states,
    spoilerFilterApplied: true,
  }
}
