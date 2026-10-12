import { CLI_PROVIDERS_FEATURE, type GameAgentProvider, isCliProvider, isGameAgentProvider } from '@/lib/game-agent/providers'
import { normalizeAgentTimeouts } from '@/lib/game-agent/timeouts'

export const AGENT_SYNC_VERSION = 1 as const

export type AgentSyncStamp = {
  counter: number
  actorId: string
}

export type AgentSyncProfile = {
  id: string
  label: string
  provider: GameAgentProvider
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
  modelRequestTimeoutMs: number
  modelTimeoutMs: number
  gameCallTimeoutMs: number
  proxy: string
}

export type AgentSyncSettings = {
  version: 1
  defaultProfileId: string
  profiles: AgentSyncProfile[]
}

export const AGENT_SYNC_FIELDS = [
  'label',
  'provider',
  'endpoint',
  'defaultModel',
  'temperature',
  'keepAlive',
  'modelRequestTimeoutMs',
  'modelTimeoutMs',
  'gameCallTimeoutMs',
  'proxy',
] as const
export type AgentSyncField = (typeof AGENT_SYNC_FIELDS)[number]

export type AgentSyncRecord = {
  id: string
  values: Omit<AgentSyncProfile, 'id'>
  fieldStamps: Record<AgentSyncField, AgentSyncStamp>
  deletedAt?: AgentSyncStamp
  deletedAtMs?: number
}

export type AgentSyncDocument = {
  version: typeof AGENT_SYNC_VERSION
  actorId: string
  clock: number
  agents: AgentSyncRecord[]
  order: { ids: string[]; stamp: AgentSyncStamp }
}

const ZERO_STAMP: AgentSyncStamp = { counter: 0, actorId: '' }

function copyStamp(stamp: AgentSyncStamp): AgentSyncStamp {
  return { counter: stamp.counter, actorId: stamp.actorId }
}

export function compareAgentSyncStamps(left: AgentSyncStamp | undefined, right: AgentSyncStamp | undefined): number {
  const a = left || ZERO_STAMP
  const b = right || ZERO_STAMP
  return a.counter - b.counter || a.actorId.localeCompare(b.actorId)
}

function maxRecordStamp(record: AgentSyncRecord): AgentSyncStamp {
  let latest = ZERO_STAMP
  for (const field of AGENT_SYNC_FIELDS) {
    if (compareAgentSyncStamps(record.fieldStamps[field], latest) > 0) latest = record.fieldStamps[field]
  }
  return latest
}

export function isAgentSyncRecordVisible(record: AgentSyncRecord): boolean {
  return !record.deletedAt || compareAgentSyncStamps(maxRecordStamp(record), record.deletedAt) > 0
}

function copyRecord(record: AgentSyncRecord): AgentSyncRecord {
  return {
    id: record.id,
    values: { ...record.values },
    fieldStamps: Object.fromEntries(AGENT_SYNC_FIELDS.map((field) => [field, copyStamp(record.fieldStamps[field])])) as Record<AgentSyncField, AgentSyncStamp>,
    ...(record.deletedAt ? { deletedAt: copyStamp(record.deletedAt), deletedAtMs: record.deletedAtMs } : {}),
  }
}

export function createEmptyAgentSyncDocument(actorId: string): AgentSyncDocument {
  return { version: AGENT_SYNC_VERSION, actorId, clock: 0, agents: [], order: { ids: [], stamp: { counter: 0, actorId } } }
}

export function agentSyncDocumentFromSettings(settings: AgentSyncSettings, actorId: string, baselineCounter = 1): AgentSyncDocument {
  const counter = Math.max(1, Math.floor(baselineCounter))
  const stamp = { counter, actorId }
  return {
    version: AGENT_SYNC_VERSION,
    actorId,
    clock: counter,
    agents: settings.profiles.map(({ id, ...values }) => ({
      id,
      values: { ...values },
      fieldStamps: Object.fromEntries(AGENT_SYNC_FIELDS.map((field) => [field, copyStamp(stamp)])) as Record<AgentSyncField, AgentSyncStamp>,
    })),
    order: { ids: settings.profiles.map((profile) => profile.id), stamp: copyStamp(stamp) },
  }
}

function mergeRecord(left: AgentSyncRecord, right: AgentSyncRecord): AgentSyncRecord {
  const values = { ...left.values }
  const fieldStamps = { ...left.fieldStamps }
  for (const field of AGENT_SYNC_FIELDS) {
    if (compareAgentSyncStamps(right.fieldStamps[field], left.fieldStamps[field]) > 0) {
      ;(values[field] as AgentSyncProfile[typeof field]) = right.values[field]
      fieldStamps[field] = copyStamp(right.fieldStamps[field])
    }
  }
  const useRightDelete = compareAgentSyncStamps(right.deletedAt, left.deletedAt) > 0
  const deletedAt = useRightDelete ? right.deletedAt : left.deletedAt
  const deletedAtMs = useRightDelete ? right.deletedAtMs : left.deletedAtMs
  return {
    id: left.id,
    values,
    fieldStamps,
    ...(deletedAt ? { deletedAt: copyStamp(deletedAt), deletedAtMs } : {}),
  }
}

/** Pure, deterministic two-way merge. The returned document keeps the caller's actor identity. */
export function mergeAgentSyncDocuments(local: AgentSyncDocument, remote: AgentSyncDocument): AgentSyncDocument {
  const byId = new Map(local.agents.map((record) => [record.id, copyRecord(record)]))
  for (const record of remote.agents) {
    const current = byId.get(record.id)
    byId.set(record.id, current ? mergeRecord(current, record) : copyRecord(record))
  }
  const agents = [...byId.values()]
  const remoteOrderWins = compareAgentSyncStamps(remote.order.stamp, local.order.stamp) > 0
  const firstOrder = remoteOrderWins ? remote.order : local.order
  const secondOrder = remoteOrderWins ? local.order : remote.order
  const visible = new Set(agents.filter(isAgentSyncRecordVisible).map((record) => record.id))
  const ids: string[] = []
  for (const id of [...firstOrder.ids, ...secondOrder.ids, ...[...visible].sort()]) {
    if (visible.has(id) && !ids.includes(id)) ids.push(id)
  }
  return {
    version: AGENT_SYNC_VERSION,
    actorId: local.actorId,
    clock: Math.max(
      local.clock,
      remote.clock,
      ...agents.flatMap((record) => [...AGENT_SYNC_FIELDS.map((field) => record.fieldStamps[field].counter), record.deletedAt?.counter || 0])
    ),
    agents,
    order: { ids, stamp: copyStamp(firstOrder.stamp) },
  }
}

function profilesEqual(left: AgentSyncProfile, right: AgentSyncProfile) {
  return AGENT_SYNC_FIELDS.every((field) => left[field] === right[field])
}

/** Converts a CRUD result into stamped mutations, including explicit tombstones. */
export function applySettingsToAgentSyncDocument(document: AgentSyncDocument, settings: AgentSyncSettings, now = Date.now()): AgentSyncDocument {
  const next = mergeAgentSyncDocuments(document, createEmptyAgentSyncDocument(document.actorId))
  const byId = new Map(next.agents.map((record) => [record.id, record]))
  const incoming = new Map(settings.profiles.map((profile) => [profile.id, profile]))
  const stamp = (): AgentSyncStamp => ({ counter: ++next.clock, actorId: next.actorId })

  for (const profile of settings.profiles) {
    const current = byId.get(profile.id)
    if (!current) {
      const created = agentSyncDocumentFromSettings({ version: 1, defaultProfileId: profile.id, profiles: [profile] }, next.actorId, ++next.clock).agents[0]
      byId.set(profile.id, created)
      continue
    }
    const currentProfile = { id: current.id, ...current.values }
    if (profilesEqual(currentProfile, profile) && isAgentSyncRecordVisible(current)) continue
    for (const field of AGENT_SYNC_FIELDS) {
      if (current.values[field] !== profile[field] || !isAgentSyncRecordVisible(current)) {
        ;(current.values[field] as AgentSyncProfile[typeof field]) = profile[field]
        current.fieldStamps[field] = stamp()
      }
    }
  }

  for (const record of byId.values()) {
    if (incoming.has(record.id) || !isAgentSyncRecordVisible(record)) continue
    record.deletedAt = stamp()
    record.deletedAtMs = now
  }

  const ids = settings.profiles.map((profile) => profile.id)
  if (ids.join('\u0000') !== next.order.ids.join('\u0000')) next.order = { ids, stamp: stamp() }
  next.agents = [...byId.values()]
  return next
}

/** Apply only edits made relative to the caller's read baseline. */
export function applySettingsDiffToAgentSyncDocument(current: AgentSyncDocument, baseline: AgentSyncSettings, desired: AgentSyncSettings, now = Date.now()): AgentSyncDocument {
  const currentSettings = agentSettingsFromSyncDocument(current)
  const currentById = new Map(currentSettings.profiles.map((profile) => [profile.id, profile]))
  const baselineById = new Map(baseline.profiles.map((profile) => [profile.id, profile]))
  const desiredById = new Map(desired.profiles.map((profile) => [profile.id, profile]))

  for (const profile of desired.profiles) {
    const base = baselineById.get(profile.id)
    const latest = currentById.get(profile.id)
    if (!base || !latest) {
      currentById.set(profile.id, profile)
      continue
    }
    const patched = { ...latest }
    for (const field of AGENT_SYNC_FIELDS) {
      if (profile[field] !== base[field]) (patched[field] as AgentSyncProfile[typeof field]) = profile[field]
    }
    currentById.set(profile.id, patched)
  }
  for (const profile of baseline.profiles) {
    if (!desiredById.has(profile.id)) currentById.delete(profile.id)
  }

  const baselineOrder = baseline.profiles.map((profile) => profile.id)
  const desiredOrder = desired.profiles.map((profile) => profile.id)
  const orderChanged = baselineOrder.join('\u0000') !== desiredOrder.join('\u0000')
  const currentOrder = currentSettings.profiles.map((profile) => profile.id)
  const ids = orderChanged ? [...desiredOrder, ...currentOrder.filter((id) => !desiredById.has(id) && currentById.has(id))] : currentOrder.filter((id) => currentById.has(id))
  for (const id of currentById.keys()) if (!ids.includes(id)) ids.push(id)
  return applySettingsToAgentSyncDocument(current, { version: 1, defaultProfileId: ids[0] || '', profiles: ids.map((id) => currentById.get(id)!) }, now)
}

export function agentSettingsFromSyncDocument(document: AgentSyncDocument): AgentSyncSettings {
  const byId = new Map(document.agents.filter(isAgentSyncRecordVisible).map((record) => [record.id, record]))
  const ids = [...document.order.ids.filter((id) => byId.has(id)), ...[...byId.keys()].filter((id) => !document.order.ids.includes(id)).sort()]
  const profiles = ids.map((id) => {
    const record = byId.get(id)!
    return { id: record.id, ...record.values }
  })
  return { version: 1, defaultProfileId: profiles[0]?.id || '', profiles }
}

export function withAgentSyncActor(document: AgentSyncDocument, actorId: string): AgentSyncDocument {
  return { ...document, actorId, clock: Math.max(document.clock, 0) }
}

function validStamp(value: unknown): value is AgentSyncStamp {
  const stamp = value as AgentSyncStamp
  return Number.isSafeInteger(stamp?.counter) && stamp.counter >= 0 && typeof stamp.actorId === 'string' && stamp.actorId.length <= 160
}

/** Rejects incomplete/corrupt cache documents instead of interpreting them as deletions. */
export function parseAgentSyncDocument(value: unknown): AgentSyncDocument | null {
  const document = value as AgentSyncDocument
  if (document?.version !== AGENT_SYNC_VERSION || typeof document.actorId !== 'string' || !document.actorId || !Number.isSafeInteger(document.clock) || document.clock < 0)
    return null
  if (!Array.isArray(document.agents) || document.agents.length > 100 || !Array.isArray(document.order?.ids) || !validStamp(document.order?.stamp)) return null
  const agents: AgentSyncRecord[] = []
  const ids = new Set<string>()
  for (const record of document.agents) {
    if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id) || typeof record.values !== 'object' || typeof record.fieldStamps !== 'object') return null
    ids.add(record.id)
    // Records written before `proxy` existed (or by older readers) carry no value and a zero stamp, so any real edit wins.
    const values = { ...record.values, ...normalizeAgentTimeouts(record.values), proxy: typeof record.values.proxy === 'string' ? record.values.proxy : '' }
    const fieldStamps = Object.fromEntries(
      AGENT_SYNC_FIELDS.map((field) => [field, validStamp(record.fieldStamps[field]) ? copyStamp(record.fieldStamps[field]) : copyStamp(ZERO_STAMP)])
    ) as Record<AgentSyncField, AgentSyncStamp>
    if (
      typeof values.label !== 'string' ||
      !isGameAgentProvider(values.provider) ||
      typeof values.endpoint !== 'string' ||
      typeof values.defaultModel !== 'string' ||
      typeof values.temperature !== 'number' ||
      typeof values.keepAlive !== 'string' ||
      typeof values.modelRequestTimeoutMs !== 'number' ||
      typeof values.modelTimeoutMs !== 'number' ||
      typeof values.gameCallTimeoutMs !== 'number' ||
      (record.deletedAt !== undefined && !validStamp(record.deletedAt))
    )
      return null
    agents.push(copyRecord({ ...record, values, fieldStamps }))
  }
  if (!document.order.ids.every((id) => typeof id === 'string')) return null
  return {
    version: AGENT_SYNC_VERSION,
    actorId: document.actorId.slice(0, 160),
    clock: document.clock,
    agents,
    order: { ids: [...document.order.ids], stamp: copyStamp(document.order.stamp) },
  }
}

/**
 * Readers that predate CLI providers reject the whole document when any record is unknown.
 * Hide those records (and their order slots) so old plugins keep syncing Ollama agents; merges are
 * unions and deletes need tombstones, so the hidden records survive whatever the old reader sends back.
 */
export function agentSyncDocumentForReader(document: AgentSyncDocument, features: readonly string[] = []): AgentSyncDocument {
  if (features.includes(CLI_PROVIDERS_FEATURE)) return document
  const hidden = new Set(document.agents.filter((record) => isCliProvider(record.values.provider)).map((record) => record.id))
  if (!hidden.size) return document
  return {
    ...document,
    agents: document.agents.filter((record) => !hidden.has(record.id)).map(copyRecord),
    order: { ids: document.order.ids.filter((id) => !hidden.has(id)), stamp: copyStamp(document.order.stamp) },
  }
}
