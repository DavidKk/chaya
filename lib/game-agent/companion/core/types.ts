/**
 * Companion Core Rebuild domain types.
 * Pure contracts without engine or Node I/O dependencies.
 * Defined per docs/technical/companion-core-rebuild.md.
 */

import type { ActionEvidence, ContextStamp, FactEntityRef } from '@/lib/game-agent/companion/types'

// ============================================================================
// Control Arbiter Contracts
// ============================================================================

export type ControlRevocationReason = 'user_stop' | 'user_pause' | 'manual_takeover' | 'goal_replaced' | 'scene_change' | 'context_epoch_change' | 'timeout' | 'disposed'

export type AuthorizedControlRequest = {
  runtimeInstanceId: string
  ownerId: string
  scope: string
  allowedActions: string[]
  requestedAt: number
}

export type ControlLease = {
  runtimeInstanceId: string
  ownerId: string
  generation: number
  acquiredAt: number
}

export interface ControlArbiter {
  acquire(input: AuthorizedControlRequest): ControlLease
  assertCurrent(lease: ControlLease): void
  isCurrent(lease: ControlLease): boolean
  currentLease(): ControlLease | null
  trackInput(lease: ControlLease, cancel: () => void): () => void
  whenIdle(): Promise<void>
  revoke(lease: ControlLease, reason: ControlRevocationReason): void
  release(lease: ControlLease): void
}

// ============================================================================
// Battle Observation & Capability Contracts
// ============================================================================

export type BattlePhase = 'party_command' | 'actor_command' | 'resolving' | 'result' | 'blocked'

export type CommandOpportunityKind = 'party' | 'actor'

export type CommandOpportunity = {
  opportunityId: string
  actor: FactEntityRef | null
  actionSlot: number | null
  kind: CommandOpportunityKind
}

export type SupportedTargetRule = 'one_enemy' | 'all_enemies' | 'one_ally' | 'all_allies' | 'one_dead_ally' | 'all_dead_allies' | 'user' | 'none' | 'unsupported'

export type KnownActionCosts = {
  mp: number
  tp: number
  hasUnknownCost?: boolean
}

export type ObservedOrDeclaredEffect = {
  kind: 'damage' | 'heal' | 'guard' | 'buff' | 'debuff' | 'escape' | 'other' | 'unknown'
  powerEstimate?: number
  isCertainHit?: boolean
}

export type ActionOffer = {
  actionKey: string
  actor: FactEntityRef | null
  kind: 'attack' | 'guard' | 'skill' | 'item' | 'escape'
  abilityId?: number
  skillTypeId?: number
  name: string
  targetRule: SupportedTargetRule
  costs: KnownActionCosts
  effect: ObservedOrDeclaredEffect
}

export type BattlePartyEntity = {
  actorId: number
  name: string
  index: number
  hp: number
  hpMax: number
  mp: number
  mpMax: number
  tp: number
  isDead: boolean
  states: Array<{ id: number; name: string }>
}

export type BattleEnemyEntity = {
  enemyId: number
  instanceId: string
  name: string
  index: number
  hp: number | null
  hpMax: number | null
  isDead: boolean
  states: Array<{ id: number; name: string }>
}

export type BattleFrame = {
  stamp: ContextStamp
  encounterId: string
  turnCount: number
  phase: BattlePhase
  opportunity: CommandOpportunity | null
  party: BattlePartyEntity[]
  enemies: BattleEnemyEntity[]
  offers: ActionOffer[]
  capabilitiesRevision: number
  blockedReason?: string
  decisionVersions?: { memoryEpoch: number; recordingRevision: number }
}

// ============================================================================
// Dynamic Tactics & Patching Contracts
// ============================================================================

export type RuleLifetime =
  { kind: 'persistent' } | { kind: 'encounter'; encounterId: string } | { kind: 'opportunity'; opportunityId: string } | { kind: 'next_matching_action'; actorId?: number }

export type TacticCondition =
  | { kind: 'always' }
  | { kind: 'hp_ratio_below'; target: 'self' | 'lowest_ally' | 'any_ally' | 'party_avg'; threshold: number }
  | { kind: 'resource_below'; target: 'self'; resource: 'mp' | 'tp'; threshold: number }
  | { kind: 'has_state'; target: 'self' | 'any_ally' | 'any_enemy'; stateId: number }
  | { kind: 'enemy_count_at_least'; count: number }
  | {
      kind: 'observed_hit_margin_below'
      threshold: number
      samplesCount?: number
      fallbackIfUnknown?: boolean
    }
  | { kind: 'all'; conditions: TacticCondition[] }
  | { kind: 'any'; conditions: TacticCondition[] }

export type SupportedActionPreference = {
  kind: 'heal' | 'attack' | 'guard' | 'skill' | 'item' | 'escape'
  abilityId?: number
  targetPreference?: 'lowest_hp' | 'first_enemy' | 'highest_threat' | 'self'
}

export type TacticRule = {
  id: string
  priority: number
  when: TacticCondition
  prefer: SupportedActionPreference
  lifetime: RuleLifetime
  reason?: string
}

export type TacticPlan = {
  schemaVersion: 1
  revision: number
  rules: TacticRule[]
}

export type TacticOperation =
  | { op: 'add_rule'; rule: TacticRule }
  | { op: 'replace_rule'; ruleId: string; rule: TacticRule }
  | { op: 'remove_rule'; ruleId: string }
  | { op: 'modify_param'; ruleId: string; threshold?: number; priority?: number }

export type TacticPatch = {
  operations: TacticOperation[]
  reason: string
  evidenceRefs: string[]
}

export type DecisionDependency = {
  name: string
  expected: string | number | boolean
}

export type DecisionTicket = {
  requestId: string
  stamp: ContextStamp
  encounterId: string
  goalRevision: number
  controlGeneration: number
  baseTacticRevision: number
  decisionGeneration: number
  capabilitiesRevision: number
  memoryEpoch?: number
  recordingRevision?: number
  expiresAt: number
  dependencies: DecisionDependency[]
  mode?: 'quick' | 'deep'
  reason?: string
}

// ============================================================================
// Action Lifecycle & Selection Contracts
// ============================================================================

export type ActionLifeCycle = 'planned' | 'navigating' | 'confirming' | 'committed' | 'observed' | 'unknown' | 'rejected' | 'cancelled'

export type ActionTargetRef = {
  kind: 'actor' | 'enemy' | 'all_enemies' | 'all_allies' | 'user' | 'none'
  targetIndex?: number
  entityId?: number
  instanceId?: string
}

export type ActionIntent = {
  commandId: string
  encounterId?: string
  turnCount?: number
  opportunityId: string
  actorId?: number
  actionOffer: ActionOffer
  target: ActionTargetRef
  tacticRevision: number
  appliedRuleId?: string
  appliedRuleSignature?: string
  reason: string
}

export type ActionSelectionResult = { kind: 'action'; intent: ActionIntent } | { kind: 'wait'; reason: string } | { kind: 'blocked'; reason: string }

export type ObservedActionResult = {
  commandId?: string
  encounterId?: string
  actionId?: string
  resultId?: string
  actorId?: number
  targetKind?: 'actor' | 'enemy'
  targetId?: number
  hpDamage?: number
  hpRecovery?: number
  mpDamage?: number
  isHit?: boolean
  isCritical?: boolean
  isKnockout?: boolean
  observedAt: number
  /** Authoritative observed facts for retrieval; older recordings may omit them. */
  evidence?: ActionEvidence
}

// ============================================================================
// Coordinator State & Lifecycle Contracts
// ============================================================================

export type CompanionRunStatus = 'idle' | 'running' | 'waiting_game' | 'waiting_decision' | 'paused' | 'stopping' | 'completed' | 'interrupted' | 'failed'

export type PlayerConstraint = {
  id: string
  kind: 'forbid_item' | 'forbid_skill' | 'focus_enemy' | 'reserve_mp'
  param?: number | string
}

export type CommittedCommandState = {
  commandId: string
  opportunityId: string
  intent: ActionIntent
  lifecycle: ActionLifeCycle
  committedAt?: number
  results: ObservedActionResult[]
}

export type EncounterOutcome = 'win' | 'lose' | 'escape' | 'abort' | 'unknown'

export type EncounterStatistics = {
  encounterId: string
  libraryGameId: string
  playthroughId: string
  outcome: EncounterOutcome
  turnsCount: number
  commandsCommitted: number
  startedAt: number
  finishedAt?: number
}
