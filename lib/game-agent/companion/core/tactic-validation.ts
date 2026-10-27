import type { TacticPatch, TacticPlan } from './types'

type Row = Record<string, unknown>
export type PatchValidationResult = { ok: true } | { ok: false; reason: string }
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 160): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const number = (v: unknown, min = 0, max = 10000): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const id = (v: unknown) => number(v, 1, 999999) && Number.isInteger(v)
const keys = (v: Row, names: string[]) => Object.keys(v).every((key) => names.includes(key))
const oneOf = (v: unknown, choices: string[]) => typeof v === 'string' && choices.includes(v)

function condition(v: unknown, depth = 0, budget = { nodes: 0 }): boolean {
  if (!object(v) || depth > 6 || ++budget.nodes > 128) return false
  switch (v.kind) {
    case 'always':
      return keys(v, ['kind'])
    case 'hp_ratio_below':
      return keys(v, ['kind', 'target', 'threshold']) && oneOf(v.target, ['self', 'lowest_ally', 'any_ally', 'party_avg']) && number(v.threshold, 0, 1)
    case 'resource_below':
      return (
        keys(v, ['kind', 'target', 'resource', 'threshold']) && v.target === 'self' && oneOf(v.resource, ['mp', 'tp']) && number(v.threshold, 0, v.resource === 'tp' ? 100 : 999999)
      )
    case 'has_state':
      return keys(v, ['kind', 'target', 'stateId']) && oneOf(v.target, ['self', 'any_ally', 'any_enemy']) && id(v.stateId)
    case 'enemy_count_at_least':
      return keys(v, ['kind', 'count']) && number(v.count, 1, 16) && Number.isInteger(v.count)
    case 'observed_hit_margin_below':
      return (
        keys(v, ['kind', 'threshold', 'samplesCount', 'fallbackIfUnknown']) &&
        number(v.threshold, 0, 999999) &&
        (v.samplesCount === undefined || (number(v.samplesCount, 1, 50) && Number.isInteger(v.samplesCount))) &&
        (v.fallbackIfUnknown === undefined || typeof v.fallbackIfUnknown === 'boolean')
      )
    case 'all':
    case 'any':
      return (
        keys(v, ['kind', 'conditions']) &&
        Array.isArray(v.conditions) &&
        v.conditions.length > 0 &&
        v.conditions.length <= 16 &&
        v.conditions.every((c) => condition(c, depth + 1, budget))
      )
    default:
      return false
  }
}

function lifetime(v: unknown): boolean {
  if (!object(v)) return false
  switch (v.kind) {
    case 'persistent':
      return keys(v, ['kind'])
    case 'encounter':
      return keys(v, ['kind', 'encounterId']) && text(v.encounterId)
    case 'opportunity':
      return keys(v, ['kind', 'opportunityId']) && text(v.opportunityId, 512)
    case 'next_matching_action':
      return keys(v, ['kind', 'actorId']) && (v.actorId === undefined || id(v.actorId))
    default:
      return false
  }
}

function rule(v: unknown): boolean {
  if (!object(v) || !keys(v, ['id', 'priority', 'when', 'prefer', 'lifetime', 'reason'])) return false
  const p = v.prefer
  return (
    text(v.id) &&
    number(v.priority) &&
    condition(v.when) &&
    lifetime(v.lifetime) &&
    (v.reason === undefined || text(v.reason, 1000)) &&
    object(p) &&
    keys(p, ['kind', 'abilityId', 'targetPreference']) &&
    oneOf(p.kind, ['heal', 'attack', 'guard', 'skill']) &&
    (p.abilityId === undefined || id(p.abilityId)) &&
    (p.targetPreference === undefined || oneOf(p.targetPreference, ['lowest_hp', 'first_enemy', 'highest_threat', 'self']))
  )
}

export function validateTacticPlan(v: unknown): v is TacticPlan {
  if (!object(v) || v.schemaVersion !== 1 || !id(v.revision) || !Array.isArray(v.rules) || v.rules.length > 128) return false
  return v.rules.every(rule) && new Set(v.rules.map((r) => r.id)).size === v.rules.length
}

export function validateTacticPatch(patch: unknown): PatchValidationResult {
  if (
    !object(patch) ||
    !keys(patch, ['operations', 'reason', 'evidenceRefs']) ||
    !text(patch.reason, 2000) ||
    !Array.isArray(patch.evidenceRefs) ||
    patch.evidenceRefs.length > 32 ||
    !patch.evidenceRefs.every((r) => text(r, 512)) ||
    !Array.isArray(patch.operations) ||
    !patch.operations.length ||
    patch.operations.length > 32
  ) {
    return { ok: false, reason: 'Invalid patch envelope or size' }
  }
  for (const op of patch.operations) {
    if (!object(op)) return { ok: false, reason: 'Invalid operation' }
    let valid = false
    switch (op.op) {
      case 'add_rule':
        valid = keys(op, ['op', 'rule']) && rule(op.rule)
        break
      case 'replace_rule':
        valid = keys(op, ['op', 'ruleId', 'rule']) && text(op.ruleId) && rule(op.rule)
        break
      case 'remove_rule':
        valid = keys(op, ['op', 'ruleId']) && text(op.ruleId)
        break
      case 'modify_param':
        valid =
          keys(op, ['op', 'ruleId', 'threshold', 'priority']) &&
          text(op.ruleId) &&
          (op.threshold !== undefined || op.priority !== undefined) &&
          (op.threshold === undefined || number(op.threshold, 0, 999999)) &&
          (op.priority === undefined || number(op.priority))
        break
    }
    if (!valid) return { ok: false, reason: `Invalid operation: ${String(op.op)}` }
  }
  return { ok: true }
}

export function clonePlan(plan: TacticPlan): TacticPlan {
  return JSON.parse(JSON.stringify(plan)) as TacticPlan
}

export function validatedPatch(patch: unknown): TacticPatch {
  const validation = validateTacticPatch(patch)
  if (!validation.ok) throw new Error(validation.reason)
  return JSON.parse(JSON.stringify(patch)) as TacticPatch
}
