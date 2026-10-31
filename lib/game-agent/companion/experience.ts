import type { ExperienceEvidenceRef, ExperienceQuery, ExperienceTarget, HpExperience, HpExperienceConditions, HpExperienceSample } from './experience-types'
import type { RuntimeScope } from './types'

const MAX_REFS = 3
const MIN_ACTIONS = 3
const MIN_ENCOUNTERS = 2

function states(ids: number[] | undefined | null): number[] | null {
  return ids == null ? null : [...new Set(ids)].sort((a, b) => a - b)
}

function hpBand(hp: number | null, max: number | null): HpExperienceConditions['hpBand'] {
  if (hp === null || max === null || max <= 0 || hp < 0 || hp > max) return 'unknown'
  const ratio = hp / max
  return ratio <= 0.3 ? 'low' : ratio <= 0.7 ? 'middle' : 'high'
}

function conditionsOf(sample: HpExperienceSample): HpExperienceConditions | null {
  const e = sample.evidence
  if (e.attribution !== 'observed_action' || e.source.kind === 'unknown' || !e.source.id || !e.ability) return null
  if (e.hpBefore === null || e.hpAfter === null || e.hpBefore < 0 || e.hpAfter < 0) return null
  if (!Number.isFinite(e.hpBefore - e.hpAfter)) return null
  if (e.hpMax !== undefined && (e.hpMax <= 0 || e.hpBefore > e.hpMax || e.hpAfter > e.hpMax)) return null
  return {
    source: { kind: e.source.kind, id: e.source.id },
    ability: { kind: e.ability.kind, id: e.ability.id },
    target: { kind: e.target.kind, id: e.target.id },
    hpMax: e.hpMax ?? null,
    hpBand: hpBand(e.hpBefore, e.hpMax ?? null),
    stateIds: states(e.stateIdsBefore),
  }
}

function scopeKey(scope: RuntimeScope): string[] {
  return [scope.libraryGameId, scope.dataRevision, scope.playthroughId]
}

function encounterKey(sample: HpExperienceSample): string {
  return JSON.stringify([...scopeKey(sample.scope), sample.scope.runtimeInstanceId, sample.scope.segmentId, sample.encounterId])
}

// Compact context references; full keys still govern grouping and collisions are rejected.
function referenceId(identity: string): string {
  return (
    'experience:' +
    [2166136261, 2246822507, 3266489909, 668265263]
      .map((seed) => {
        let hash = seed
        for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619)
        return (hash >>> 0).toString(16).padStart(8, '0')
      })
      .join('')
  )
}

function evidenceRef(sample: HpExperienceSample): ExperienceEvidenceRef {
  return {
    scope: { ...sample.scope },
    encounterId: sample.encounterId,
    eventId: sample.eventId,
    actionId: sample.evidence.actionId,
    resultId: sample.evidence.resultId,
    hpBefore: sample.evidence.hpBefore!,
    hpAfter: sample.evidence.hpAfter!,
  }
}

/** Derives bounded observations from acknowledged facts, without model calls or new writes. */
export function projectHpExperiences(samples: HpExperienceSample[], memoryEpoch: number): HpExperience[] {
  const groups = new Map<string, { conditions: HpExperienceConditions; samples: HpExperienceSample[] }>()
  for (const sample of samples) {
    const conditions = conditionsOf(sample)
    if (!conditions) continue
    const key = JSON.stringify([...scopeKey(sample.scope), conditions])
    const group = groups.get(key) ?? { conditions, samples: [] }
    group.samples.push(sample)
    groups.set(key, group)
  }
  const identities = new Map<string, string>()
  const collisions = new Set<string>()
  const result: HpExperience[] = []
  for (const [key, group] of groups) {
    // Stable under replay order. Counterexamples test the earliest retained nonzero observation.
    const sorted = group.samples.sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId) || encounterKey(a).localeCompare(encounterKey(b)))
    const losses = sorted.map((sample) => sample.evidence.hpBefore! - sample.evidence.hpAfter!)
    const sign = Math.sign(losses.find((loss) => loss !== 0) ?? 0)
    const supporting = sorted.filter((_, index) => Math.sign(losses[index]) === sign)
    const counterexamples = sorted.filter((_, index) => Math.sign(losses[index]) !== sign)
    const sampleActions = new Set(sorted.map((sample) => JSON.stringify([encounterKey(sample), sample.evidence.actionId]))).size
    const sampleEncounters = new Set(sorted.map(encounterKey)).size
    const conditionsKnown = group.conditions.hpMax !== null && group.conditions.hpBand !== 'unknown' && group.conditions.stateIds !== null
    const claim = sign > 0 ? 'hp_decreased' : sign < 0 ? 'hp_increased' : 'hp_unchanged'
    const status =
      counterexamples.length > 0
        ? 'has_counterexamples'
        : sign !== 0 && conditionsKnown && sampleActions >= MIN_ACTIONS && sampleEncounters >= MIN_ENCOUNTERS
          ? 'conditionally_supported'
          : 'observation_summary'
    const identity = JSON.stringify([key, claim])
    const experienceId = referenceId(identity)
    if (identities.has(experienceId) && identities.get(experienceId) !== identity) collisions.add(experienceId)
    identities.set(experienceId, identity)
    const scope = sorted[0].scope
    result.push({
      experienceId,
      projectionVersion: 1,
      memoryEpoch,
      scope: { libraryGameId: scope.libraryGameId, dataRevision: scope.dataRevision, playthroughId: scope.playthroughId },
      conditions: group.conditions,
      claim,
      status,
      applicability: 'unknown',
      sampleActions,
      sampleEncounters,
      targetResults: sorted.length,
      supportingResults: supporting.length,
      counterexampleResults: counterexamples.length,
      hpLoss: { min: Math.min(...losses), max: Math.max(...losses) },
      evidenceRefs: supporting.slice(-MAX_REFS).map(evidenceRef),
      counterexampleRefs: counterexamples.slice(-MAX_REFS).map(evidenceRef),
      updatedAt: Math.max(...sorted.map((sample) => sample.at)),
      summary: '',
    })
  }
  return result.filter((item) => !collisions.has(item.experienceId))
}

function applicability(conditions: HpExperienceConditions, targets?: ExperienceTarget[]): HpExperience['applicability'] {
  if (!targets) return 'unknown'
  if (!targets.some((entity) => entity.kind === conditions.source.kind && entity.id === conditions.source.id)) return 'conditions_differ'
  const matching = targets.filter((target) => target.kind === conditions.target.kind && target.id === conditions.target.id)
  if (!matching.length) return 'conditions_differ'
  let unknown = false
  for (const target of matching) {
    const targetStates = states(target.stateIds)
    const band = hpBand(target.hp, target.hpMax)
    if (
      (conditions.hpMax !== null && target.hpMax !== null && conditions.hpMax !== target.hpMax) ||
      (conditions.hpBand !== 'unknown' && band !== 'unknown' && conditions.hpBand !== band) ||
      (conditions.stateIds !== null && targetStates !== null && JSON.stringify(conditions.stateIds) !== JSON.stringify(targetStates))
    ) {
      continue
    }
    if (conditions.hpMax === null || target.hpMax === null || conditions.hpBand === 'unknown' || band === 'unknown' || conditions.stateIds === null || targetStates === null) {
      unknown = true
    } else return 'matching_observed_conditions'
  }
  return unknown ? 'unknown' : 'conditions_differ'
}

function summaryOf(item: HpExperience): string {
  const { source, ability, target, hpMax, hpBand: band, stateIds } = item.conditions
  const label = (entity: { kind: 'actor' | 'enemy'; id: number }) => `${entity.kind === 'actor' ? '角色' : '敌人'} ${entity.id}`
  const condition = `目标生命上限 ${hpMax ?? '未知'}、血量段 ${band}、状态 ${stateIds === null ? '未知' : stateIds.join(',') || '无'}`
  const amount = item.hpLoss.min === item.hpLoss.max ? String(item.hpLoss.min) : `${item.hpLoss.min} 至 ${item.hpLoss.max}`
  const range = `实际 HP 减少量 ${amount}（负值为恢复，受生命上下限截断）`
  const status =
    item.status === 'has_counterexamples'
      ? `存在 ${item.counterexampleResults} 条零变化或反向变化反例`
      : item.status === 'conditionally_supported'
        ? '保留样本在上述条件下方向一致'
        : '样本或已知条件不足，仅为观察摘要'
  const current = item.applicability === 'conditions_differ' ? '；当前目标条件不同，不适用' : item.applicability === 'unknown' ? '；当前适用性未知' : ''
  return `仅保留记录：${label(source)} 的${ability.kind === 'skill' ? '技能' : '物品'} ${ability.id} → ${label(target)}；${condition}；${item.sampleActions} 次行动 / ${item.sampleEncounters} 场遭遇 / ${item.targetResults} 条目标结果，${range}；${status}${current}。来源属性等仍未知，不保证后续效果。`
}

export function queryHpExperiences(experiences: HpExperience[], scope: RuntimeScope, filter: ExperienceQuery = {}): HpExperience[] {
  const limit = Number.isFinite(filter.limit) ? Math.max(0, Math.min(8, Math.floor(filter.limit!))) : 3
  const selected = experiences.filter((item) => {
    if (JSON.stringify(scopeKey(scope)) !== JSON.stringify([item.scope.libraryGameId, item.scope.dataRevision, item.scope.playthroughId])) return false
    const { source, target, ability } = item.conditions
    if (filter.enemyIds && ![source, target].some((entity) => entity.kind === 'enemy' && filter.enemyIds!.includes(entity.id))) return false
    if (filter.skillIds && (ability.kind !== 'skill' || !filter.skillIds.includes(ability.id))) return false
    return true
  })
  const rank = { matching_observed_conditions: 0, unknown: 1, conditions_differ: 2 }
  return selected
    .map((item) => ({ ...item, applicability: applicability(item.conditions, filter.targets) }))
    .sort((a, b) => rank[a.applicability] - rank[b.applicability] || b.updatedAt - a.updatedAt || a.experienceId.localeCompare(b.experienceId))
    .slice(0, limit)
    .map((item) => JSON.parse(JSON.stringify({ ...item, summary: summaryOf(item) })) as HpExperience)
}
