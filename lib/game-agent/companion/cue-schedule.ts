/**
 * Pure cue queue: priority, danger merge, TTL, cooldown, epoch/segment clear,
 * and single consume for visible listeners (T4).
 */

import type { Cue } from './types'

export const CUE_QUEUE_MAX = 16
export const CUE_QUEUE_MAX_BYTES = 16 * 1024

export const TTL_DANGER_MS = 3_000
export const TTL_ORDINARY_MS = 10_000
export const TTL_REMATCH_MS = 15_000

export const COOLDOWN_ORDINARY_KIND_MS = 12_000
export const COOLDOWN_ORDINARY_TOTAL_MS = 4_000
export const DANGER_MERGE_WINDOW_MS = 2_000

export type CueKind = Cue['kind']

export type NormalizedCueKind = CueKind | 'battle'

export type CueEnvelope = Cue & {
  eventId: string
  segmentId: string
  facts: Record<string, unknown>
  contextEpoch: number
  consumed?: boolean
  targetKey?: string
  severity?: number
}

export type CueScheduleState = {
  queue: CueEnvelope[]
  lastOrdinaryAt: number
  lastKindAt: Record<string, number>
  lastDangerByTarget: Record<string, { at: number; severity: number; cueId: string }>
  spokenEventIds: string[]
  recentLineKeys: string[]
  contextEpoch: number
  segmentId: string
  currentEncounterId: string | null
  visibleConsumers: number
}

export type ScheduleBudgets = {
  queueMax?: number
  queueMaxBytes?: number
  ordinaryKindMs?: number
  ordinaryTotalMs?: number
  dangerMergeMs?: number
}

const DEFAULT_BUDGETS: Required<ScheduleBudgets> = {
  queueMax: CUE_QUEUE_MAX,
  queueMaxBytes: CUE_QUEUE_MAX_BYTES,
  ordinaryKindMs: COOLDOWN_ORDINARY_KIND_MS,
  ordinaryTotalMs: COOLDOWN_ORDINARY_TOTAL_MS,
  dangerMergeMs: DANGER_MERGE_WINDOW_MS,
}

const RECENT_SPOKEN_CAP = 24
const RECENT_LINE_CAP = 8

export function createCueScheduleState(init?: Partial<CueScheduleState>): CueScheduleState {
  return {
    queue: [],
    lastOrdinaryAt: -Infinity,
    lastKindAt: {},
    lastDangerByTarget: {},
    spokenEventIds: [],
    recentLineKeys: [],
    contextEpoch: 0,
    segmentId: '',
    currentEncounterId: null,
    visibleConsumers: 0,
    ...init,
  }
}

export function normalizeCueKind(kind: string): CueKind {
  if (kind === 'battle') return 'battle_start'
  return kind as CueKind
}

export function isDangerKind(kind: string): boolean {
  return normalizeCueKind(kind) === 'danger'
}

export function defaultTtlForKind(kind: string): number {
  const normalized = normalizeCueKind(kind)
  if (normalized === 'danger') return TTL_DANGER_MS
  if (normalized === 'rematch') return TTL_REMATCH_MS
  return TTL_ORDINARY_MS
}

export function priorityForKind(kind: string): number {
  const normalized = normalizeCueKind(kind)
  if (normalized === 'danger') return 100
  if (normalized === 'rematch') return 80
  if (normalized === 'battle_start') return 60
  if (normalized === 'battle_loss') return 55
  if (normalized === 'chest' || normalized === 'reward') return 40
  if (normalized === 'battle_win') return 30
  return 20
}

function estimateBytes(cue: CueEnvelope): number {
  return JSON.stringify(cue).length
}

function queueBytes(queue: CueEnvelope[]): number {
  return queue.reduce((sum, cue) => sum + estimateBytes(cue), 0)
}

export function pruneCueQueue(state: CueScheduleState, now: number, budgets: ScheduleBudgets = {}): CueScheduleState {
  const { queueMax, queueMaxBytes } = { ...DEFAULT_BUDGETS, ...budgets }
  let queue = state.queue.filter((cue) => {
    if (cue.expiresAt <= now || cue.consumed || cue.contextEpoch !== state.contextEpoch) return false
    if (normalizeCueKind(cue.kind) === 'rematch') {
      const encounterId = typeof cue.facts.encounterId === 'string' ? cue.facts.encounterId : null
      if (state.segmentId && cue.segmentId && cue.segmentId !== state.segmentId) return false
      if (encounterId && state.currentEncounterId && encounterId !== state.currentEncounterId) return false
    }
    return true
  })
  queue.sort((a, b) => b.priority - a.priority || a.expiresAt - b.expiresAt)

  while (queue.length > queueMax || queueBytes(queue) > queueMaxBytes) {
    const dropOrdinary = [...queue].reverse().find((cue) => !isDangerKind(cue.kind))
    if (dropOrdinary) {
      queue = queue.filter((cue) => cue.id !== dropOrdinary.id)
      continue
    }
    queue = queue.slice(0, Math.max(0, queue.length - 1))
  }

  return { ...state, queue }
}

export function clearCueScope(state: CueScheduleState, next: { contextEpoch?: number; segmentId?: string; currentEncounterId?: string | null }): CueScheduleState {
  const contextEpoch = next.contextEpoch ?? state.contextEpoch
  const segmentId = next.segmentId ?? state.segmentId
  const currentEncounterId = next.currentEncounterId !== undefined ? next.currentEncounterId : state.currentEncounterId
  const epochChanged = contextEpoch !== state.contextEpoch
  const segmentChanged = segmentId !== state.segmentId
  const encounterChanged = currentEncounterId !== state.currentEncounterId
  if (!epochChanged && !segmentChanged && !encounterChanged) return state

  return {
    ...state,
    contextEpoch,
    segmentId,
    currentEncounterId,
    queue: epochChanged || segmentChanged ? [] : encounterChanged ? state.queue.filter((cue) => normalizeCueKind(cue.kind) !== 'rematch') : state.queue,
    lastDangerByTarget: epochChanged || segmentChanged ? {} : state.lastDangerByTarget,
    spokenEventIds: epochChanged ? [] : state.spokenEventIds,
    recentLineKeys: epochChanged ? [] : state.recentLineKeys,
  }
}

export function setVisibleConsumers(state: CueScheduleState, count: number): CueScheduleState {
  const visibleConsumers = Math.max(0, count)
  if (visibleConsumers === state.visibleConsumers) return state
  if (visibleConsumers === 0) {
    return {
      ...state,
      visibleConsumers,
      queue: state.queue.filter((cue) => isDangerKind(cue.kind)),
    }
  }
  return { ...state, visibleConsumers }
}

export function rememberSpokenLine(state: CueScheduleState, lineKey: string): CueScheduleState {
  const recentLineKeys = [...state.recentLineKeys, lineKey].slice(-RECENT_LINE_CAP)
  return { ...state, recentLineKeys }
}

export function wasLineSpokenRecently(state: CueScheduleState, lineKey: string): boolean {
  return state.recentLineKeys.includes(lineKey)
}

function rememberEvent(state: CueScheduleState, eventId: string): CueScheduleState {
  if (state.spokenEventIds.includes(eventId)) return state
  return { ...state, spokenEventIds: [...state.spokenEventIds, eventId].slice(-RECENT_SPOKEN_CAP) }
}

export function canEnqueueEvent(state: CueScheduleState, eventId: string): boolean {
  return !!eventId && !state.spokenEventIds.includes(eventId)
}

export function canPassCooldown(state: CueScheduleState, kind: string, now: number, budgets: ScheduleBudgets = {}): boolean {
  const normalized = normalizeCueKind(kind)
  const { ordinaryKindMs, ordinaryTotalMs } = { ...DEFAULT_BUDGETS, ...budgets }
  if (isDangerKind(normalized)) return true
  const lastKind = state.lastKindAt[normalized] ?? -Infinity
  if (now - lastKind < ordinaryKindMs) return false
  if (now - state.lastOrdinaryAt < ordinaryTotalMs) return false
  return true
}

export function recordCooldown(state: CueScheduleState, kind: string, now: number): CueScheduleState {
  const normalized = normalizeCueKind(kind)
  if (isDangerKind(normalized)) {
    return { ...state, lastKindAt: { ...state.lastKindAt, [normalized]: now } }
  }
  return {
    ...state,
    lastOrdinaryAt: now,
    lastKindAt: { ...state.lastKindAt, [normalized]: now },
  }
}

export function enqueueCue(
  state: CueScheduleState,
  cue: CueEnvelope,
  now: number,
  budgets: ScheduleBudgets = {}
): { state: CueScheduleState; enqueued: CueEnvelope | null; merged: boolean } {
  if (cue.contextEpoch !== state.contextEpoch) return { state, enqueued: null, merged: false }
  if (cue.segmentId && state.segmentId && cue.segmentId !== state.segmentId && normalizeCueKind(cue.kind) === 'rematch') {
    return { state, enqueued: null, merged: false }
  }
  if (!canEnqueueEvent(state, cue.eventId)) return { state, enqueued: null, merged: false }
  if (state.visibleConsumers <= 0 && !isDangerKind(cue.kind)) return { state, enqueued: null, merged: false }

  const { dangerMergeMs } = { ...DEFAULT_BUDGETS, ...budgets }
  if (isDangerKind(cue.kind)) {
    const targetKey = cue.targetKey || 'party'
    const previous = state.lastDangerByTarget[targetKey]
    const severity = cue.severity ?? cue.priority
    if (previous && now - previous.at <= dangerMergeMs) {
      if (severity <= previous.severity) {
        return { state, enqueued: null, merged: true }
      }
      const updated: CueEnvelope = {
        ...cue,
        id: previous.cueId,
        priority: Math.max(cue.priority, priorityForKind('danger')),
      }
      const queue = state.queue.map((item) => (item.id === previous.cueId ? { ...updated, consumed: false } : item))
      const has = queue.some((item) => item.id === previous.cueId)
      const nextQueue = has ? queue : [...queue, updated]
      const next = pruneCueQueue(
        {
          ...state,
          queue: nextQueue,
          lastDangerByTarget: {
            ...state.lastDangerByTarget,
            [targetKey]: { at: now, severity, cueId: updated.id },
          },
        },
        now,
        budgets
      )
      return { state: next, enqueued: updated, merged: true }
    }

    const next = pruneCueQueue(
      {
        ...state,
        queue: [...state.queue, cue],
        lastDangerByTarget: {
          ...state.lastDangerByTarget,
          [targetKey]: { at: now, severity, cueId: cue.id },
        },
      },
      now,
      budgets
    )
    return { state: next, enqueued: cue, merged: false }
  }

  if (!canPassCooldown(state, cue.kind, now, budgets)) return { state, enqueued: null, merged: false }

  const next = pruneCueQueue({ ...state, queue: [...state.queue, cue] }, now, budgets)
  return { state: next, enqueued: cue, merged: false }
}

export function consumeNextCue(state: CueScheduleState, now: number, budgets: ScheduleBudgets = {}): { state: CueScheduleState; cue: CueEnvelope | null } {
  const pruned = pruneCueQueue(state, now, budgets)
  if (pruned.visibleConsumers <= 0) return { state: pruned, cue: null }

  const ranked = [...pruned.queue].sort((a, b) => b.priority - a.priority || a.expiresAt - b.expiresAt)
  const cue = ranked.find((item) => !item.consumed && item.expiresAt > now) ?? null
  if (!cue) return { state: pruned, cue: null }
  if (!isDangerKind(cue.kind) && !canPassCooldown(pruned, cue.kind, now, budgets)) {
    return { state: pruned, cue: null }
  }

  const queue = pruned.queue.filter((item) => item.id !== cue.id)
  let next = rememberEvent({ ...pruned, queue }, cue.eventId)
  next = recordCooldown(next, cue.kind, now)
  return { state: next, cue: { ...cue, consumed: true } }
}
