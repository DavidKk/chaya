import type { EventKind } from './kind'

export type { EventKind }

export type VisibleBounds = { minX: number; maxX: number; minY: number; maxY: number }

export type InteractBatchSpec = {
  kind: 'interact_batch'
  scope: 'visible_map'
  includeKinds: EventKind[] | 'all'
  excludeKinds: EventKind[]
  includeEventIds: number[]
  excludeEventIds: number[]
  cardinality: 'one' | 'many'
  onChoice: 'ask_player' | 'decide'
  summary: string
}

export type TaskSpec = InteractBatchSpec

export type Candidate = {
  eventId: number
  mapId: number
  x: number
  y: number
  normalizedKind: EventKind
  interactive: boolean
  opened: boolean
  routeStatus?: string
  routeDistance?: number
  deferred?: 'uncertain_kind'
}

export type Job = {
  key: string
  kind: 'interact'
  mapId: number
  eventId: number
}

export type InteractEvidence = {
  messages: string[]
  goldChange: number
  inventoryChanges: unknown[]
  historyRange: { fromSeq: number | null; toSeq: number }
  completeness: { messagesTruncated: boolean; historyGap: boolean }
  sideEffects?: Array<{ eventId: number; outcome: string }>
}

export type JobResult =
  | { status: 'done'; evidence: InteractEvidence }
  | { status: 'skipped'; reason: 'gone' | 'nothing_to_run' | 'runs_by_itself' | 'uncertain_kind' }
  | { status: 'blocked'; reason: 'no_path' | 'no_reaction' | 'timeout'; blockedBy?: number[]; detail?: unknown }
  | { status: 'needs_decision'; reason: 'choice' | 'input_required'; state: unknown }
  | { status: 'busy_other'; reason: 'other_event_busy'; busyEventId?: number; detail?: unknown }
  | { status: 'stopped'; reason: 'interrupted' | 'effect_unknown' | 'runtime_not_updating'; detail?: unknown }
  | { status: 'world_changed'; reason: 'transferred' | 'transferred_on_the_way' | 'scene_changed' | 'left_start_bounds' | 'battle' }

export type LedgerEntry = { status: 'done' | 'skipped' | 'failed'; note: string }

export type JobBoundary = {
  runtimeInstanceId: string
  startMapId: number
  startVisibleBounds: VisibleBounds
}

export type PendingJob = {
  job: Job
  reason: 'choice' | 'input_required'
  version: number
  stateToken?: string
}

export type JobRun = {
  spec: TaskSpec
  specVersion: number
  boundary: JobBoundary
  candidates: Map<number, Candidate>
  ledger: Map<string, LedgerEntry>
  failures: Map<string, number>
  pending?: PendingJob
  log: Array<{ key: string; status: JobResult['status']; note: string }>
  attempts: number
  deadline: number
}

export type JobOutcome =
  | { status: 'completed'; run: JobRun }
  | { status: 'partial'; run: JobRun; reason?: string }
  | { status: 'out_of_scope'; run: JobRun }
  | { status: 'unreachable'; run: JobRun; remaining: Job[] }
  | { status: 'stopped'; run: JobRun }
  | { status: 'limit'; run: JobRun }
  | { status: 'waiting_user'; run: JobRun; question: string }

export const MAX_JOB_FAILURES = 2
export const MAX_JOB_STEPS = 60

export function jobKey(mapId: number, eventId: number) {
  return `${mapId}:${eventId}`
}
