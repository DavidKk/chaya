/**
 * Companion and Gameplay Memory Core Contracts (T0).
 * Defined per docs/technical/companion.md and docs/technical/companion-memory.md.
 *
 * Defines identity, game facts & mechanics, domain events, memory evidence,
 * in-process ports, error codes, and message wire protocols.
 */
import type { CompanionMessageEvent } from '@/lib/runtime/companion-protocol'

import type { SourceGameEvent } from '../audit'
import type { HpExperience } from './experience-types'

export type RuntimeScope = {
  libraryGameId: string
  dataRevision: string
  playthroughId: string
  runtimeInstanceId: string
  segmentId: string
}

export type ContextStamp = {
  scope: RuntimeScope
  contextEpoch: number
  factsRevision: number
}

export type SourceCursor = {
  producerId: string
  epoch: number
  sourceSeq: number
}

export type FactValue<T> = {
  value: T | null
  known: boolean
  sourceRefs: string[]
}

export type CapabilitySupport = 'supported' | 'partial' | 'unsupported'

// ============================================================================
// Current Game Facts & Known Mechanics (T0 named types & discriminated unions)
// ============================================================================

export type FactSceneKind = 'map' | 'battle' | 'menu' | 'title' | 'gameover' | 'shop' | 'save' | 'load' | 'other'

export type FactMapInfo = {
  mapId: number
  displayName?: string
  width?: number
  height?: number
}

export type FactEntityRef = {
  kind: 'actor' | 'enemy'
  id: number
  instance: string
}

export type FactStateEffect = {
  stateId: number
  name?: string
  turnsRemaining?: number | null
  isBuff?: boolean
  isDebuff?: boolean
}

export type FactPartyMember = {
  actorId: number
  name: string
  index: number
  hp: number
  hpMax: number
  mp: number
  mpMax: number
  tp?: number
  isDead: boolean
  states: FactStateEffect[]
}

export type FactEnemyMember = {
  enemyId: number
  instanceId: string
  name: string
  index: number
  hp: number | null
  hpMax: number | null
  isDead: boolean
  states: FactStateEffect[]
  letter?: string
}

export type FactLegalAction = {
  actionKey: string
  kind: 'attack' | 'skill' | 'item' | 'guard' | 'escape'
  actorIndex: number
  id?: number
  name?: string
  mpCost?: number
  tpCost?: number
  targetScope?: 'one_enemy' | 'all_enemies' | 'one_ally' | 'all_allies' | 'user' | 'none'
}

export type CurrentGameFacts = {
  scene: FactValue<FactSceneKind>
  rawSceneName?: string | null
  map: FactValue<FactMapInfo>
  encounterId: FactValue<string>
  party: FactValue<FactPartyMember[]>
  enemies: FactValue<FactEnemyMember[]>
  legalActions: FactValue<FactLegalAction[]>
  isPaused: boolean
}

export type StandardMechanicElement = 'physical' | 'fire' | 'ice' | 'thunder' | 'water' | 'earth' | 'wind' | 'light' | 'dark' | 'none' | 'unknown'

export type StandardHitType = 'certain' | 'physical' | 'magical' | 'unknown'

export type KnownSkillMechanic = {
  skillId: number
  name: string
  element: StandardMechanicElement
  rawElementId?: number
  hitType: StandardHitType
  scope: string
  mpCost: number
  tpCost: number
  description?: string
  lethalRisk: 'high' | 'medium' | 'low' | 'unknown'
  addedStateIds: number[]
  removedStateIds: number[]
  isDisarmable: FactValue<boolean>
  isReflectable: FactValue<boolean>
  source: 'database_entry' | 'observed_action' | 'unknown'
}

export type KnownStateMechanic = {
  stateId: number
  name: string
  restriction: 'none' | 'attack_enemy' | 'attack_ally' | 'cannot_move' | 'unknown'
  isKnockout: boolean
  continuousHpDamageRate?: number
  source: 'database_entry' | 'observed_action' | 'unknown'
}

export type KnownMechanics = {
  skills: Record<number, KnownSkillMechanic>
  states: Record<number, KnownStateMechanic>
  spoilerFilterApplied: boolean
}

export type FactView = {
  stamp: ContextStamp
  capabilities: Record<string, CapabilitySupport>
  current: CurrentGameFacts
  mechanics: KnownMechanics
}

// ============================================================================
// Domain Events (Discriminated Union for Memory Ingestion & In-game Lifecycle)
// ============================================================================

export type ActionGameEvent = {
  kind: 'action'
  commandId?: string
  actionId: string
  resultId: string
  source: { kind: 'actor' | 'enemy' | 'unknown'; id?: number; instance?: string }
  target: { kind: 'actor' | 'enemy'; id: number; instance: string }
  ability?: { kind: 'skill' | 'item'; id: number; name?: string }
  hpBefore: number | null
  hpAfter: number | null
  reportedHpDamage: number | null
  hpMax?: number
  stateIdsBefore?: number[]
  stateIdsAfter?: number[]
  attribution: 'observed_action' | 'unknown'
  encounterId?: string
  at: number
}

export type KnockoutGameEvent = {
  kind: 'knockout'
  target: { kind: 'actor' | 'enemy'; id: number; instance: string }
  killer?: { kind: 'actor' | 'enemy' | 'unknown'; id?: number; instance?: string }
  lethalActionId?: string
  lethalAbility?: { kind: 'skill' | 'item'; id: number; name?: string }
  encounterId?: string
  at: number
}

export type BattleStartGameEvent = {
  kind: 'battle_start'
  encounterId: string
  troopId?: number
  troopName?: string
  enemyIds: number[]
  at: number
}

export type BattleResultGameEvent = {
  kind: 'battle_result'
  encounterId: string
  outcome: 'win' | 'lose' | 'escape' | 'abort'
  canLose?: boolean
  turns: number
  survivorActorIds: number[]
  at: number
}

export type SaveGameEvent = {
  kind: 'save'
  operationId: string
  phase: 'begin' | 'commit' | 'rollback'
  saveSlot?: number | string
  saveKind: 'native' | 'quick' | 'auto' | 'unknown'
  revision?: string
  at: number
}

export type LoadGameEvent = {
  kind: 'load'
  operationId: string
  phase: 'begin' | 'commit' | 'rollback'
  saveSlot?: number | string
  saveKind: 'native' | 'quick' | 'auto' | 'unknown'
  fromSegmentId: string
  toSegmentId?: string
  fromScope?: RuntimeScope
  toScope?: RuntimeScope
  initiatorTaskId?: string
  origin?: 'verified_metadata' | 'linked_load_context' | 'unknown'
  at: number
}

export type MilestoneGameEvent = {
  kind: 'milestone'
  milestoneId: string
  name: string
  details?: Record<string, unknown>
  at: number
}

export type AdminManagementGameEvent = {
  kind: 'admin'
  action: 'clear_memory' | 'toggle_recording' | 'apply_preference'
  requestId: string
  targetMemoryEpoch: number
  at: number
}

export type CompanionDomainEvent =
  ActionGameEvent | KnockoutGameEvent | BattleStartGameEvent | BattleResultGameEvent | SaveGameEvent | LoadGameEvent | MilestoneGameEvent | AdminManagementGameEvent

export type MemoryInput = {
  source: SourceGameEvent
  domainEvent?: CompanionDomainEvent
  stamp: ContextStamp
  memoryEpoch: number
  recordingRevision: number
  coveredSourceCursor: SourceCursor
}

// ============================================================================
// Memory Evidence, Episodes & Ingestion
// ============================================================================

export type CompletenessKind = 'complete_for_claim' | 'partial' | 'unknown'

export type MemoryEvidence = {
  episodeId: string
  scope: RuntimeScope
  encounterId?: string
  sourceRefs: string[]
  completeness: CompletenessKind
  persistence: 'pending' | 'committed'
  summary: string
  evidence: ActionEvidence[]
  memoryEpoch: number
}

export type ActionEvidence = {
  actionId: string
  resultId: string
  source: { kind: 'actor' | 'enemy' | 'unknown'; id?: number; instance?: string }
  target: { kind: 'actor' | 'enemy'; id: number; instance: string }
  ability?: { kind: 'skill' | 'item'; id: number; name?: string }
  hpBefore: number | null
  hpAfter: number | null
  reportedHpDamage: number | null
  hpMax?: number
  stateIdsBefore?: number[]
  stateIdsAfter?: number[]
  attribution: 'observed_action' | 'unknown'
}

export type MemoryEpisode = {
  episodeId: string
  scope: RuntimeScope
  encounterId?: string
  at: number
  kind: 'knockout' | 'battle_result' | 'defense_attempt'
  completeness: CompletenessKind
  summary: string
  evidence: ActionEvidence[]
  memoryEpoch: number
}

export type MemoryQueryIntent = 'current_encounter' | 'recent_death' | 'rematch' | 'explicit_history'

export type MemoryQueryFilter = {
  intent?: MemoryQueryIntent
  enemyIds?: number[]
  skillIds?: number[]
  encounterId?: string
  segmentId?: string
  limit?: number
}

// ============================================================================
// Cue & Reflex Contracts
// ============================================================================

export type CueKind = 'danger' | 'battle_start' | 'battle_win' | 'battle_loss' | 'rematch' | 'chest' | 'reward' | 'general'

export type Cue = {
  id: string
  eventId?: string
  segmentId?: string
  priority: number
  expiresAt: number
  evidenceRefs: string[]
  facts?: Record<string, unknown>
  kind: CueKind
}

// ============================================================================
// User Preferences & Operation Cards
// ============================================================================

export type UserPreference = {
  key: string
  value: unknown
  revision: number
  updatedAt: number
  sourceUserMessageId?: string
  scope?: string
}

export type OperationCard = {
  cardId: string
  action: string
  label: string
  targetGoal: string
  stamp: ContextStamp
  contextCondition?: string
  expiresAt: number
}

// ============================================================================
// In-Process Ports (T0 Port Interfaces)
// ============================================================================

export type MemoryIngestResult = {
  accepted: boolean
  newMemoryEpoch?: number
  pendingEpisodeIds: string[]
}

export type MemoryQueryResult = {
  episodes: MemoryEpisode[]
  completeness: CompletenessKind
  memoryEpoch: number
  origin?: 'current_playthrough' | 'linked_load_context' | 'unknown'
  unresolvedCandidates?: string[]
}

export type MemoryPort = {
  ingest(input: MemoryInput): Promise<MemoryIngestResult>
  query(scope: RuntimeScope, filter: MemoryQueryFilter): Promise<MemoryQueryResult>
  getPreferences(userScope: string): Promise<UserPreference[]>
  applyPreference(userScope: string, pref: UserPreference): Promise<{ applied: boolean; revision: number }>
  clear(scope: RuntimeScope, requestId: string): Promise<{ newMemoryEpoch: number }>
  setRecording(scope: RuntimeScope, enabled: boolean, requestId: string): Promise<{ recordingRevision: number }>
}

export type CompanionReactContext = {
  character: string
  locale: string
  now: number
  recentEpisodes?: MemoryEpisode[]
  preferences?: UserPreference[]
}

export type CompanionReactResult = {
  cue: Cue | null
  nextState?: unknown
}

export type CompanionCandidate = {
  candidateId: string
  character: string
  locale: string
  kind: CueKind
  textTemplate: string
  evidenceRefs: string[]
  stamp: ContextStamp
  expiresAt: number
}

export type CompanionPort = {
  react(state: unknown, event: CompanionDomainEvent | SourceGameEvent, context: CompanionReactContext): CompanionReactResult
  chat(request: CompanionChatRequest, cancelSignal?: AbortSignal): AsyncIterable<CompanionMessageEvent>
  prepare(context: { stamp: ContextStamp; character: string; locale: string; budget: number }): Promise<CompanionCandidate[]>
}

export type ControlPort = {
  start(params: {
    taskId?: string
    requestId: string
    goal: string
    shape?: 'single' | 'batch' | 'open'
    lifetime?: 'goal' | 'until_stopped'
  }): Promise<{ accepted: boolean; taskId: string }>
  reply(taskId: string, replyPayload: unknown): Promise<{ accepted: boolean }>
  stop(taskId: string, reason?: string): Promise<{ stopped: boolean }>
  status(taskId: string): Promise<{ active: boolean; taskId: string; phase?: string }>
}

export type EntryRouteDecision =
  | { target: 'companion_chat'; prompt: string; conversationId?: string }
  | { target: 'autopilot_control'; action: string; goal: string; cardId?: string }
  | { target: 'clarification'; question: string }

export type EntryRoutePort = {
  route(input: { text?: string; cardId?: string; requestId: string; stamp: ContextStamp }): Promise<EntryRouteDecision>
}

// ============================================================================
// Error Codes & Uniform Error Envelope
// ============================================================================

export type CompanionErrorCode =
  | 'NOT_READY'
  | 'STALE_CONTEXT'
  | 'STALE_CARD'
  | 'CONTROL_BUSY'
  | 'MODEL_BUSY'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_TIMEOUT'
  | 'CAPABILITY_UNSUPPORTED'
  | 'PERSISTENCE_DEGRADED'
  | 'MEMORY_EPOCH_CHANGED'
  | 'CANCELLED'
  | 'STORAGE_TRANSACTION_FAILED'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'REQUEST_CONFLICT'

export type CompanionError = {
  code: CompanionErrorCode
  message: string
  retryable: boolean
  requestId?: string
  currentStamp?: ContextStamp
}

// ============================================================================
// ============================================================================
// Companion Chat & Reasoning Contracts (In-process Domain Types)
// ============================================================================

export type CompanionChatRequest = {
  requestId: string
  conversationId: string
  messageId: string
  userPrompt: string
  character: string
  locale: string
  stamp: ContextStamp
  recentHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type StructuredOutputBlock =
  | {
      kind: 'experience_ref'
      experienceId: string
      summary: string
    }
  | {
      kind: 'evidence_ref'
      episodeId: string
      summary: string
      completeness: CompletenessKind
    }
  | {
      kind: 'skill_advice'
      skillId: number
      skillName: string
      targetActorId?: number
      rationale: string
      knownCondition: boolean
    }
  | {
      kind: 'operation_card'
      card: OperationCard
    }

export type FactSourceCursor = SourceCursor

export type GameFactsPort = {
  current(): FactView
  subscribe(afterSourceCursor: FactSourceCursor | null, listener: (factView: FactView) => void): () => void
  readMechanics(entityRefs: FactEntityRef[]): KnownMechanics
}

export type IntentClassification =
  { kind: 'chat'; prompt: string } | { kind: 'control'; action: string; goal: string; cardId?: string } | { kind: 'clarification'; question: string }

export type AdviceContext = {
  stamp: ContextStamp
  currentParty: FactPartyMember[]
  currentEnemies: FactEnemyMember[]
  legalActions: FactLegalAction[]
  knownMechanics: KnownMechanics
  historicalEpisodes: MemoryEpisode[]
  historicalExperiences?: HpExperience[]
  knownGaps: string[]
  spoilerFilterApplied: boolean
}

export type ExecutionShape = 'single' | 'batch' | 'open'
export type ExecutionLifetime = 'goal' | 'until_stopped'

export type ResourceQueueItem = {
  resourceKey: string
  requestId: string
  priority: 'interactive_chat' | 'control_turn' | 'background_candidate'
  enqueuedAt: number
  timeoutMs: number
}

export type StorageTransactionContract = {
  memoryEpoch: number
  recordingRevision: number
  coveredCursor: SourceCursor
}
