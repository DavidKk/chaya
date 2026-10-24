/** Schema validation for companion memory records. Rejects oversized / malformed payloads. */

import {
  clampText,
  estimateRecordBytes,
  MEMORY_EPISODE_SUMMARY_MAX,
  MEMORY_EVIDENCE_ARRAY_MAX,
  MEMORY_ID_FIELD_MAX,
  MEMORY_MILESTONE_DETAILS_MAX_BYTES,
  MEMORY_STATE_IDS_MAX,
  MEMORY_STRING_FIELD_MAX,
} from './memory-limits'
import {
  MEMORY_SCHEMA_VERSION,
  type MemoryEpisodeRecord,
  type MemoryEvidenceRecord,
  type MemoryPreferenceRecord,
  type MemoryProjectionStats,
  type MemorySaveLink,
  type MemoryWriteBatch,
} from './memory-types'
import type { ActionEvidence, RuntimeScope } from './types'

export class MemorySchemaError extends Error {
  readonly code = 'MEMORY_SCHEMA_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'MemorySchemaError'
  }
}

export class MemoryConflictError extends Error {
  readonly code = 'REQUEST_CONFLICT' as const

  constructor(message = 'Memory request conflict') {
    super(message)
    this.name = 'MemoryConflictError'
  }
}

export class MemoryStaleError extends Error {
  readonly code = 'MEMORY_EPOCH_CHANGED' as const

  constructor(message = 'stale memory epoch') {
    super(message)
    this.name = 'MemoryStaleError'
  }
}

export class MemoryPersistenceError extends Error {
  readonly code = 'PERSISTENCE_DEGRADED' as const

  constructor(message = 'memory persistence unavailable') {
    super(message)
    this.name = 'MemoryPersistenceError'
  }
}

const EPISODE_KINDS = new Set(['knockout', 'battle_result', 'defense_attempt', 'milestone', 'load', 'save'])
const COMPLETENESS = new Set(['complete_for_claim', 'partial', 'unknown'])
const PERSISTENCE = new Set(['pending', 'committed'])
const PREFERENCE_KEYS = new Set(['verbosity', 'spoilers', 'muteUntil', 'style', 'reminderFrequency', 'naturalEnhancement'])
const PREFERENCE_SOURCES = new Set(['user_settings', 'user_instruction'])
const BATTLE_OUTCOMES = new Set(['win', 'lose', 'escape', 'abort'])

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value: unknown, field: string, max = MEMORY_STRING_FIELD_MAX): string {
  if (typeof value !== 'string' || !value.trim()) throw new MemorySchemaError(`Invalid ${field}`)
  if (value.length > max) throw new MemorySchemaError(`${field} exceeds ${max} chars`)
  return value
}

function optionalString(value: unknown, field: string, max = MEMORY_STRING_FIELD_MAX): string | undefined {
  if (value == null) return undefined
  return requireString(value, field, max)
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new MemorySchemaError(`Invalid ${field}`)
  return value
}

function requireInt(value: unknown, field: string, min = Number.MIN_SAFE_INTEGER): number {
  const n = requireNumber(value, field)
  if (!Number.isSafeInteger(n) || n < min) throw new MemorySchemaError(`Invalid ${field}`)
  return n
}

function optionalInt(value: unknown, field: string, min = 0): number | undefined {
  if (value == null) return undefined
  return requireInt(value, field, min)
}

function requireScope(value: unknown): RuntimeScope {
  if (!isObject(value)) throw new MemorySchemaError('Invalid scope')
  return {
    libraryGameId: requireString(value.libraryGameId, 'scope.libraryGameId', MEMORY_ID_FIELD_MAX),
    dataRevision: requireString(value.dataRevision, 'scope.dataRevision', MEMORY_ID_FIELD_MAX),
    playthroughId: requireString(value.playthroughId, 'scope.playthroughId', MEMORY_ID_FIELD_MAX),
    runtimeInstanceId: requireString(value.runtimeInstanceId, 'scope.runtimeInstanceId', MEMORY_ID_FIELD_MAX),
    segmentId: requireString(value.segmentId, 'scope.segmentId', MEMORY_ID_FIELD_MAX),
  }
}

function optionalNumberArray(value: unknown, field: string, max = MEMORY_STATE_IDS_MAX): number[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > max) throw new MemorySchemaError(`Invalid ${field}`)
  return value.map((item, index) => requireInt(item, `${field}[${index}]`))
}

function validateEvidenceItem(value: unknown, index: number): ActionEvidence {
  if (!isObject(value)) throw new MemorySchemaError(`Invalid evidence[${index}]`)
  const source = value.source
  const target = value.target
  if (!isObject(source) || !isObject(target)) throw new MemorySchemaError(`Invalid evidence[${index}] entity`)
  const sourceKind = source.kind
  const targetKind = target.kind
  if (sourceKind !== 'actor' && sourceKind !== 'enemy' && sourceKind !== 'unknown') throw new MemorySchemaError(`Invalid evidence[${index}].source.kind`)
  if (targetKind !== 'actor' && targetKind !== 'enemy') throw new MemorySchemaError(`Invalid evidence[${index}].target.kind`)
  const ability = value.ability
  let normalizedAbility: ActionEvidence['ability']
  if (ability != null) {
    if (!isObject(ability) || (ability.kind !== 'skill' && ability.kind !== 'item')) throw new MemorySchemaError(`Invalid evidence[${index}].ability`)
    normalizedAbility = {
      kind: ability.kind,
      id: requireInt(ability.id, `evidence[${index}].ability.id`, 0),
      name: optionalString(ability.name, `evidence[${index}].ability.name`, MEMORY_STRING_FIELD_MAX),
    }
  }
  const attribution = value.attribution === 'observed_action' || value.attribution === 'unknown' ? value.attribution : null
  if (!attribution) throw new MemorySchemaError(`Invalid evidence[${index}].attribution`)
  return {
    actionId: requireString(value.actionId, `evidence[${index}].actionId`, MEMORY_ID_FIELD_MAX),
    resultId: requireString(value.resultId, `evidence[${index}].resultId`, MEMORY_ID_FIELD_MAX),
    source: {
      kind: sourceKind,
      id: optionalInt(source.id, `evidence[${index}].source.id`, 0),
      instance: optionalString(source.instance, `evidence[${index}].source.instance`, MEMORY_STRING_FIELD_MAX),
    },
    target: {
      kind: targetKind,
      id: requireInt(target.id, `evidence[${index}].target.id`, 0),
      instance: requireString(target.instance, `evidence[${index}].target.instance`, MEMORY_STRING_FIELD_MAX),
    },
    ability: normalizedAbility,
    hpBefore: value.hpBefore == null ? null : requireNumber(value.hpBefore, `evidence[${index}].hpBefore`),
    hpAfter: value.hpAfter == null ? null : requireNumber(value.hpAfter, `evidence[${index}].hpAfter`),
    reportedHpDamage: value.reportedHpDamage == null ? null : requireNumber(value.reportedHpDamage, `evidence[${index}].reportedHpDamage`),
    hpMax: optionalInt(value.hpMax, `evidence[${index}].hpMax`, 0),
    stateIdsBefore: optionalNumberArray(value.stateIdsBefore, `evidence[${index}].stateIdsBefore`),
    stateIdsAfter: optionalNumberArray(value.stateIdsAfter, `evidence[${index}].stateIdsAfter`),
    attribution,
  }
}

export function validateEpisode(value: unknown): MemoryEpisodeRecord {
  if (!isObject(value)) throw new MemorySchemaError('Invalid episode')
  const kind = requireString(value.kind, 'episode.kind', 40)
  if (!EPISODE_KINDS.has(kind)) throw new MemorySchemaError('Unsupported episode.kind')
  const completeness = requireString(value.completeness, 'episode.completeness', 40)
  if (!COMPLETENESS.has(completeness)) throw new MemorySchemaError('Unsupported episode.completeness')
  const persistenceRaw = value.persistence == null ? 'pending' : requireString(value.persistence, 'episode.persistence', 20)
  if (!PERSISTENCE.has(persistenceRaw)) throw new MemorySchemaError('Unsupported episode.persistence')
  const evidenceRaw = value.evidence
  if (!Array.isArray(evidenceRaw) || evidenceRaw.length > MEMORY_EVIDENCE_ARRAY_MAX) throw new MemorySchemaError('Invalid episode.evidence')
  const evidence = evidenceRaw.map(validateEvidenceItem)
  const linkedFrom = value.linkedFrom
  const record: MemoryEpisodeRecord = {
    episodeId: requireString(value.episodeId, 'episode.episodeId', MEMORY_ID_FIELD_MAX),
    scope: requireScope(value.scope),
    encounterId: optionalString(value.encounterId, 'episode.encounterId', MEMORY_ID_FIELD_MAX),
    at: requireInt(value.at, 'episode.at', 0),
    kind: kind as MemoryEpisodeRecord['kind'],
    completeness: completeness as MemoryEpisodeRecord['completeness'],
    summary: clampText(requireString(value.summary, 'episode.summary', MEMORY_EPISODE_SUMMARY_MAX), MEMORY_EPISODE_SUMMARY_MAX),
    evidence,
    memoryEpoch: requireInt(value.memoryEpoch, 'episode.memoryEpoch', 1),
    persistence: persistenceRaw as MemoryEpisodeRecord['persistence'],
    sourceEventIds: Array.isArray(value.sourceEventIds)
      ? value.sourceEventIds.map((id, index) => requireString(id, `episode.sourceEventIds[${index}]`, MEMORY_ID_FIELD_MAX))
      : undefined,
    stableKey: optionalString(value.stableKey, 'episode.stableKey', MEMORY_ID_FIELD_MAX),
    coveredSourceCursor: optionalInt(value.coveredSourceCursor, 'episode.coveredSourceCursor', 0),
  }
  if (isObject(linkedFrom)) {
    record.linkedFrom = {
      segmentId: optionalString(linkedFrom.segmentId, 'episode.linkedFrom.segmentId', MEMORY_ID_FIELD_MAX),
      encounterId: optionalString(linkedFrom.encounterId, 'episode.linkedFrom.encounterId', MEMORY_ID_FIELD_MAX),
      episodeId: optionalString(linkedFrom.episodeId, 'episode.linkedFrom.episodeId', MEMORY_ID_FIELD_MAX),
      saveLinkId: optionalString(linkedFrom.saveLinkId, 'episode.linkedFrom.saveLinkId', MEMORY_ID_FIELD_MAX),
    }
  }
  if (value.outcome != null) {
    const outcome = requireString(value.outcome, 'episode.outcome', 20)
    if (!BATTLE_OUTCOMES.has(outcome)) throw new MemorySchemaError('Unsupported episode.outcome')
    if (kind !== 'battle_result') throw new MemorySchemaError('episode.outcome is only valid for battle_result')
    record.outcome = outcome as MemoryEpisodeRecord['outcome']
  }
  if (value.details != null) {
    if (!isObject(value.details)) throw new MemorySchemaError('Invalid episode.details')
    if (kind !== 'milestone') throw new MemorySchemaError('episode.details is only valid for milestone')
    if (estimateRecordBytes(value.details) > MEMORY_MILESTONE_DETAILS_MAX_BYTES) throw new MemorySchemaError('episode.details exceeds budget')
    record.details = value.details
  }
  record.bytes = estimateRecordBytes(record)
  return record
}

export function validateEvidenceRecord(value: unknown): MemoryEvidenceRecord {
  if (!isObject(value)) throw new MemorySchemaError('Invalid evidence record')
  const completeness = requireString(value.completeness, 'evidence.completeness', 40)
  if (!COMPLETENESS.has(completeness)) throw new MemorySchemaError('Unsupported evidence.completeness')
  const persistence = requireString(value.persistence ?? 'pending', 'evidence.persistence', 20)
  if (!PERSISTENCE.has(persistence)) throw new MemorySchemaError('Unsupported evidence.persistence')
  const evidenceRaw = value.evidence
  if (!Array.isArray(evidenceRaw) || evidenceRaw.length > MEMORY_EVIDENCE_ARRAY_MAX) throw new MemorySchemaError('Invalid evidence.evidence')
  const record: MemoryEvidenceRecord = {
    episodeId: requireString(value.episodeId, 'evidence.episodeId', MEMORY_ID_FIELD_MAX),
    scope: requireScope(value.scope),
    encounterId: optionalString(value.encounterId, 'evidence.encounterId', MEMORY_ID_FIELD_MAX),
    sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs.map((id, index) => requireString(id, `evidence.sourceRefs[${index}]`, MEMORY_ID_FIELD_MAX)) : [],
    completeness: completeness as MemoryEvidenceRecord['completeness'],
    persistence: persistence as MemoryEvidenceRecord['persistence'],
    summary: clampText(requireString(value.summary, 'evidence.summary', MEMORY_EPISODE_SUMMARY_MAX), MEMORY_EPISODE_SUMMARY_MAX),
    evidence: evidenceRaw.map(validateEvidenceItem),
    memoryEpoch: requireInt(value.memoryEpoch, 'evidence.memoryEpoch', 1),
  }
  record.bytes = estimateRecordBytes(record)
  return record
}

export function validatePreference(value: unknown): MemoryPreferenceRecord {
  if (!isObject(value)) throw new MemorySchemaError('Invalid preference')
  const key = requireString(value.key, 'preference.key', MEMORY_ID_FIELD_MAX)
  if (!PREFERENCE_KEYS.has(key)) throw new MemorySchemaError(`Preference key not allowed: ${key}`)
  const source = requireString(value.source ?? 'user_settings', 'preference.source', 40)
  if (!PREFERENCE_SOURCES.has(source)) throw new MemorySchemaError('Unsupported preference.source')
  const serialized = estimateRecordBytes(value.value)
  if (serialized > 4 * 1024) throw new MemorySchemaError('Preference value too large')
  return {
    key,
    value: value.value,
    revision: requireInt(value.revision, 'preference.revision', 1),
    updatedAt: requireInt(value.updatedAt, 'preference.updatedAt', 0),
    scope: optionalString(value.scope, 'preference.scope', MEMORY_ID_FIELD_MAX),
    libraryGameId: optionalString(value.libraryGameId, 'preference.libraryGameId', MEMORY_ID_FIELD_MAX),
    sourceUserMessageId: optionalString(value.sourceUserMessageId, 'preference.sourceUserMessageId', MEMORY_ID_FIELD_MAX),
    source: source as MemoryPreferenceRecord['source'],
  }
}

export function validateSaveLink(value: unknown): MemorySaveLink {
  if (!isObject(value)) throw new MemorySchemaError('Invalid save link')
  const origin = requireString(value.origin, 'saveLink.origin', 20)
  if (!['native', 'quick', 'auto', 'chaya', 'unknown'].includes(origin)) throw new MemorySchemaError('Unsupported saveLink.origin')
  if (!isObject(value.scope)) throw new MemorySchemaError('Invalid saveLink.scope')
  return {
    id: requireString(value.id, 'saveLink.id', MEMORY_ID_FIELD_MAX),
    scope: {
      libraryGameId: requireString(value.scope.libraryGameId, 'saveLink.scope.libraryGameId', MEMORY_ID_FIELD_MAX),
      dataRevision: requireString(value.scope.dataRevision, 'saveLink.scope.dataRevision', MEMORY_ID_FIELD_MAX),
      playthroughId: requireString(value.scope.playthroughId, 'saveLink.scope.playthroughId', MEMORY_ID_FIELD_MAX),
    },
    origin: origin as MemorySaveLink['origin'],
    slot: typeof value.slot === 'string' || typeof value.slot === 'number' ? value.slot : undefined,
    revision: optionalString(value.revision, 'saveLink.revision', MEMORY_ID_FIELD_MAX),
    fromSegmentId: optionalString(value.fromSegmentId, 'saveLink.fromSegmentId', MEMORY_ID_FIELD_MAX),
    toSegmentId: optionalString(value.toSegmentId, 'saveLink.toSegmentId', MEMORY_ID_FIELD_MAX),
    fromEncounterId: optionalString(value.fromEncounterId, 'saveLink.fromEncounterId', MEMORY_ID_FIELD_MAX),
    fromEpisodeId: optionalString(value.fromEpisodeId, 'saveLink.fromEpisodeId', MEMORY_ID_FIELD_MAX),
    fromScope: isObject(value.fromScope)
      ? {
          libraryGameId: requireString(value.fromScope.libraryGameId, 'saveLink.fromScope.libraryGameId', MEMORY_ID_FIELD_MAX),
          dataRevision: requireString(value.fromScope.dataRevision, 'saveLink.fromScope.dataRevision', MEMORY_ID_FIELD_MAX),
          playthroughId: requireString(value.fromScope.playthroughId, 'saveLink.fromScope.playthroughId', MEMORY_ID_FIELD_MAX),
        }
      : undefined,
    at: requireInt(value.at, 'saveLink.at', 0),
    memoryEpoch: requireInt(value.memoryEpoch, 'saveLink.memoryEpoch', 1),
  }
}

function validateProjection(value: unknown): MemoryProjectionStats {
  if (!isObject(value) || !isObject(value.key)) throw new MemorySchemaError('Invalid projection')
  return {
    key: {
      libraryGameId: requireString(value.key.libraryGameId, 'projection.key.libraryGameId', MEMORY_ID_FIELD_MAX),
      dataRevision: requireString(value.key.dataRevision, 'projection.key.dataRevision', MEMORY_ID_FIELD_MAX),
      playthroughId: requireString(value.key.playthroughId, 'projection.key.playthroughId', MEMORY_ID_FIELD_MAX),
      ...(value.key.enemyId === undefined ? {} : { enemyId: requireInt(value.key.enemyId, 'projection.key.enemyId', 0) }),
      ...(value.key.skillId === undefined ? {} : { skillId: requireInt(value.key.skillId, 'projection.key.skillId', 0) }),
    },
    encounters: requireInt(value.encounters, 'projection.encounters', 0),
    defeats: requireInt(value.defeats, 'projection.defeats', 0),
    knockouts: requireInt(value.knockouts, 'projection.knockouts', 0),
    victories: requireInt(value.victories, 'projection.victories', 0),
    memoryEpoch: requireInt(value.memoryEpoch, 'projection.memoryEpoch', 1),
    updatedAt: requireInt(value.updatedAt, 'projection.updatedAt', 0),
  }
}

export function validateWriteBatch(value: unknown): MemoryWriteBatch {
  if (!isObject(value)) throw new MemorySchemaError('Invalid write batch')
  const schemaVersion = requireInt(value.schemaVersion, 'batch.schemaVersion', 1)
  if (schemaVersion !== MEMORY_SCHEMA_VERSION) throw new MemorySchemaError(`Unsupported memory schema ${schemaVersion}`)
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    batchId: requireString(value.batchId, 'batch.batchId', MEMORY_ID_FIELD_MAX),
    memoryEpoch: requireInt(value.memoryEpoch, 'batch.memoryEpoch', 1),
    recordingRevision: requireInt(value.recordingRevision, 'batch.recordingRevision', 1),
    at: requireInt(value.at, 'batch.at', 0),
    episodes: Array.isArray(value.episodes) ? value.episodes.map(validateEpisode) : undefined,
    evidence: Array.isArray(value.evidence) ? value.evidence.map(validateEvidenceRecord) : undefined,
    saveLinks: Array.isArray(value.saveLinks) ? value.saveLinks.map(validateSaveLink) : undefined,
    preferences: Array.isArray(value.preferences) ? value.preferences.map(validatePreference) : undefined,
    projections: Array.isArray(value.projections) ? value.projections.map(validateProjection) : undefined,
    clear: isObject(value.clear)
      ? {
          libraryGameId: optionalString(value.clear.libraryGameId, 'batch.clear.libraryGameId', MEMORY_ID_FIELD_MAX),
          preferences: value.clear.preferences === true,
          episodes: value.clear.episodes !== false,
        }
      : undefined,
    setRecording: typeof value.setRecording === 'boolean' ? value.setRecording : undefined,
  }
}
