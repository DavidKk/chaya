import { MemorySchemaError } from './memory-errors'
import { MEMORY_ID_FIELD_MAX, MEMORY_STATE_IDS_MAX, MEMORY_STRING_FIELD_MAX } from './memory-limits'
import type { ActionEvidence } from './types'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemorySchemaError('Invalid action evidence object')
  return value as Record<string, unknown>
}

function text(value: unknown, max = MEMORY_STRING_FIELD_MAX): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MemorySchemaError('Invalid action evidence identifier')
  return value
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new MemorySchemaError('Invalid action evidence number')
  return value
}

function integer(value: unknown): number {
  const result = number(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new MemorySchemaError('Invalid action evidence integer')
  return result
}

function states(value: unknown): number[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > MEMORY_STATE_IDS_MAX) throw new MemorySchemaError('Invalid action evidence states')
  return value.map((item) => {
    const result = number(item)
    if (!Number.isSafeInteger(result)) throw new MemorySchemaError('Invalid action evidence state')
    return result
  })
}

/** Shared by legacy episodes and canonical battle records, without a schema import cycle. */
export function validateActionEvidence(value: unknown): ActionEvidence {
  const raw = object(value)
  const source = object(raw.source)
  const target = object(raw.target)
  if (source.kind !== 'actor' && source.kind !== 'enemy' && source.kind !== 'unknown') throw new MemorySchemaError('Invalid action evidence source')
  if (target.kind !== 'actor' && target.kind !== 'enemy') throw new MemorySchemaError('Invalid action evidence target')
  if (raw.attribution !== 'observed_action' && raw.attribution !== 'unknown') throw new MemorySchemaError('Invalid action evidence attribution')
  let ability: ActionEvidence['ability']
  if (raw.ability != null) {
    const input = object(raw.ability)
    if (input.kind !== 'skill' && input.kind !== 'item') throw new MemorySchemaError('Invalid action evidence ability')
    ability = { kind: input.kind, id: integer(input.id), ...(input.name == null ? {} : { name: text(input.name) }) }
  }
  return {
    actionId: text(raw.actionId, MEMORY_ID_FIELD_MAX),
    resultId: text(raw.resultId, MEMORY_ID_FIELD_MAX),
    source: {
      kind: source.kind,
      ...(source.id == null ? {} : { id: integer(source.id) }),
      ...(source.instance == null ? {} : { instance: text(source.instance) }),
    },
    target: { kind: target.kind, id: integer(target.id), instance: text(target.instance) },
    ...(ability ? { ability } : {}),
    hpBefore: raw.hpBefore == null ? null : number(raw.hpBefore),
    hpAfter: raw.hpAfter == null ? null : number(raw.hpAfter),
    reportedHpDamage: raw.reportedHpDamage == null ? null : number(raw.reportedHpDamage),
    ...(raw.hpMax == null ? {} : { hpMax: integer(raw.hpMax) }),
    ...(raw.stateIdsBefore == null ? {} : { stateIdsBefore: states(raw.stateIdsBefore) }),
    ...(raw.stateIdsAfter == null ? {} : { stateIdsAfter: states(raw.stateIdsAfter) }),
    attribution: raw.attribution,
  }
}
