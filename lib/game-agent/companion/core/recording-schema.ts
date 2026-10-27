import { MemorySchemaError } from '../memory-errors'
import type { RuntimeScope } from '../types'
import type { BattleRecordEvent, BattleRecordingBatch, MemoryManagementRequest } from './recording-types'
import type { ObservedActionResult } from './types'

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemorySchemaError('Invalid recording object')
  return value as Record<string, unknown>
}
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new MemorySchemaError('Invalid recording identifier')
  return value
}
const number = (value: unknown, min = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new MemorySchemaError('Invalid recording number')
  return value
}
const bool = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new MemorySchemaError('Invalid recording boolean')
  return value
}

function scope(value: unknown): RuntimeScope {
  const raw = object(value)
  return {
    libraryGameId: text(raw.libraryGameId),
    dataRevision: text(raw.dataRevision),
    playthroughId: text(raw.playthroughId),
    runtimeInstanceId: text(raw.runtimeInstanceId),
    segmentId: text(raw.segmentId),
  }
}

export function validateBattleRecord(value: unknown): BattleRecordEvent {
  const raw = object(value)
  const base = { eventId: text(raw.eventId), scope: scope(raw.scope), encounterId: text(raw.encounterId), at: number(raw.at) }
  if (raw.kind === 'encounter_started') {
    if (raw.coverage !== 'partial' && raw.coverage !== 'complete') throw new MemorySchemaError('Invalid recording coverage')
    return { ...base, kind: raw.kind, coverage: raw.coverage }
  }
  if (raw.kind === 'encounter_finished') {
    if (!['win', 'lose', 'escape', 'abort', 'unknown'].includes(String(raw.outcome))) throw new MemorySchemaError('Invalid recording outcome')
    return { ...base, kind: raw.kind, outcome: raw.outcome as 'win' | 'lose' | 'escape' | 'abort' | 'unknown', turns: number(raw.turns) }
  }
  if (raw.kind === 'command_committed') {
    const commandId = text(raw.commandId)
    if (base.eventId !== commandId) throw new MemorySchemaError('Command recording must use command identity')
    return {
      ...base,
      kind: raw.kind,
      commandId,
      opportunityId: text(raw.opportunityId),
      actionKey: text(raw.actionKey),
      tacticRevision: number(raw.tacticRevision, 1),
      ...(raw.actorId === undefined ? {} : { actorId: number(raw.actorId) }),
      ...(raw.ruleId === undefined ? {} : { ruleId: text(raw.ruleId) }),
    }
  }
  if (raw.kind !== 'action_result') throw new MemorySchemaError('Unsupported recording kind')
  const input = object(raw.result)
  const result: ObservedActionResult & { resultId: string } = { resultId: text(input.resultId), observedAt: number(input.observedAt) }
  if (result.resultId !== base.eventId) throw new MemorySchemaError('Result recording must use result identity')
  for (const key of ['commandId', 'encounterId', 'actionId'] as const) if (input[key] !== undefined) result[key] = text(input[key])
  if (result.encounterId !== undefined && result.encounterId !== base.encounterId) throw new MemorySchemaError('Result encounter mismatch')
  for (const key of ['actorId', 'targetId', 'hpDamage', 'hpRecovery', 'mpDamage'] as const) if (input[key] !== undefined) result[key] = number(input[key])
  for (const key of ['isHit', 'isCritical', 'isKnockout'] as const) if (input[key] !== undefined) result[key] = bool(input[key])
  if (input.targetKind !== undefined) {
    if (input.targetKind !== 'actor' && input.targetKind !== 'enemy') throw new MemorySchemaError('Invalid recording target')
    result.targetKind = input.targetKind
  }
  return { ...base, kind: raw.kind, result }
}

export function validateBattleRecording(value: unknown): BattleRecordingBatch {
  const raw = object(value)
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.events) || raw.events.length > 128) throw new MemorySchemaError('Invalid battle recording batch')
  return { schemaVersion: 1, events: raw.events.map(validateBattleRecord) }
}

export function validateMemoryManagement(value: unknown): MemoryManagementRequest {
  const raw = object(value)
  const base = {
    requestId: text(raw.requestId),
    expectedMemoryEpoch: number(raw.expectedMemoryEpoch, 1),
    expectedRecordingRevision: number(raw.expectedRecordingRevision, 1),
  }
  if (raw.action === 'set_recording') return { ...base, action: raw.action, enabled: bool(raw.enabled) }
  if (raw.action !== 'clear') throw new MemorySchemaError('Invalid memory management action')
  return {
    ...base,
    action: raw.action,
    ...(raw.preferences === undefined ? {} : { preferences: bool(raw.preferences) }),
    ...(raw.episodes === undefined ? {} : { episodes: bool(raw.episodes) }),
  }
}

/** Stable property order makes transport serialization order irrelevant to retry identity. */
export function recordingFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)])
      )
    }
    return item
  }
  return JSON.stringify(canonical(value))
}
