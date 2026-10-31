import type { RuntimeScope } from '../types'
import { chooseAction } from './action-selector'
import { type BattleDiagnosticSink, emitBattleDiagnostic } from './diagnostics'
import { CompanionActionLedger } from './ledger'
import { CompanionRecordingEmitter } from './recording-emitter'
import type { BattleRecordEvent } from './recording-types'
import { evaluateSituation } from './situation'
import { clonePlan, validateTacticPlan } from './tactic-validation'
import { applyTacticPatch, consumeTactic, DEFAULT_TACTIC_PLAN, expireTactics } from './tactics'
import type {
  ActionIntent,
  ActionSelectionResult,
  BattleFrame,
  CompanionRunStatus,
  ControlArbiter,
  ControlLease,
  DecisionTicket,
  EncounterOutcome,
  ObservedActionResult,
  PlayerConstraint,
  TacticPlan,
} from './types'

export type CoordinatorOptions = {
  runtimeInstanceId: string
  arbiter: ControlArbiter
  initialTactic?: TacticPlan
  onDispatchIntent?: (intent: ActionIntent, lease: ControlLease) => void
  onRequestDecision?: (ticket: DecisionTicket) => void | Promise<void>
  onDecisionExhausted?: (reason?: string) => void
  onStatusChange?: (status: CompanionRunStatus) => void
  onRecord?: (event: BattleRecordEvent) => void
  onDiagnostic?: BattleDiagnosticSink
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const active = (status: CompanionRunStatus) => ['running', 'waiting_game', 'waiting_decision'].includes(status)
const contextKey = (frame: BattleFrame) => JSON.stringify([frame.stamp.scope, frame.stamp.contextEpoch, frame.encounterId])

export class CompanionCoordinator {
  private status: CompanionRunStatus = 'idle'
  private activeLease: ControlLease | null = null
  private tacticPlan: TacticPlan
  private goalRevision = 1
  private decisionGeneration = 0
  private latestFrame: BattleFrame | null = null
  private observedContext = ''
  private previousEncounter: { id: string; turn: number } | null = null
  private recentResults: ObservedActionResult[] = []
  private pendingDecisionTicket: DecisionTicket | null = null
  private playerConstraints: PlayerConstraint[] = []
  private occupied = new Map<string, { commandId: string; turn: number }>()
  private retryAfter = new Map<string, number>()
  private decisionKey = ''
  private decisionAttempts = 0
  private nextDecisionAt = 0
  private nextReviewAt = 0
  private reviewReason: string | null = null
  private lastCommandId: string | null = null
  private defensiveRound = { turn: -1, count: 0, guarded: false, other: false }
  public readonly ledger = new CompanionActionLedger()
  private readonly recording: CompanionRecordingEmitter

  constructor(private readonly options: CoordinatorOptions) {
    this.recording = new CompanionRecordingEmitter(options.onRecord)
    const plan = options.initialTactic || DEFAULT_TACTIC_PLAN
    if (!validateTacticPlan(plan)) throw new Error('INVALID_INITIAL_TACTIC')
    this.tacticPlan = clonePlan(plan)
  }

  getStatus(): CompanionRunStatus {
    return this.status
  }
  getActiveLease(): ControlLease | null {
    return this.activeLease ? { ...this.activeLease } : null
  }
  getTacticPlan(): TacticPlan {
    return clonePlan(this.tacticPlan)
  }
  getGoalRevision(): number {
    return this.goalRevision
  }
  getPlayerConstraints(): PlayerConstraint[] {
    return clone(this.playerConstraints)
  }
  getCurrentAction() {
    return this.lastCommandId ? this.ledger.getCommand(this.lastCommandId) : undefined
  }
  getDecisionContext(ticket: DecisionTicket) {
    if (!this.latestFrame || JSON.stringify(ticket) !== JSON.stringify(this.pendingDecisionTicket)) return null
    return clone({
      reason: ticket.reason,
      frame: this.latestFrame,
      tactic: this.tacticPlan,
      constraints: this.playerConstraints,
      recentResults: this.recentResults.slice(-12),
    })
  }

  private setStatus(next: CompanionRunStatus): void {
    if (this.status !== next) {
      this.status = next
      this.options.onStatusChange?.(next)
    }
  }

  start(lease: ControlLease): void {
    this.options.arbiter.assertCurrent(lease)
    if (lease.runtimeInstanceId !== this.options.runtimeInstanceId) throw new Error('RUNTIME_MISMATCH')
    this.activeLease = { ...lease }
    this.pendingDecisionTicket = null
    this.latestFrame = null
    this.reviewReason = null
    this.decisionKey = ''
    this.defensiveRound = { turn: -1, count: 0, guarded: false, other: false }
    this.setStatus('running')
  }

  pause(): void {
    if (this.activeLease) this.options.arbiter.revoke(this.activeLease, 'user_pause')
    this.activeLease = null
    this.pendingDecisionTicket = null
    this.setStatus('paused')
  }

  resume(lease: ControlLease): void {
    // A new lease must observe the live game before it can navigate.
    this.start(lease)
  }

  stop(reason: 'user_stop' | 'manual_takeover' | 'completed' = 'user_stop'): void {
    if (this.activeLease) this.options.arbiter.revoke(this.activeLease, reason === 'manual_takeover' ? 'manual_takeover' : 'user_stop')
    this.activeLease = null
    this.pendingDecisionTicket = null
    this.latestFrame = null
    this.setStatus('idle')
  }

  onManualTakeover(): void {
    this.stop('manual_takeover')
  }

  onObservationUnavailable(): void {
    if (!active(this.status)) return
    this.latestFrame = null
    this.pendingDecisionTicket = null
    this.setStatus('waiting_game')
  }

  addPlayerConstraint(constraint: PlayerConstraint): void {
    const next = [...this.playerConstraints.filter((existing) => existing.id !== constraint.id), { ...constraint }]
    if (next.length > 32) throw new Error('PLAYER_CONSTRAINT_LIMIT')
    this.playerConstraints = next
    this.goalRevision += 1
    this.pendingDecisionTicket = null
  }

  clearPlayerConstraints(): void {
    this.playerConstraints = []
    this.goalRevision += 1
    this.pendingDecisionTicket = null
  }

  private select(frame: BattleFrame, excludingCommandId?: string, diagnose = false): ActionSelectionResult {
    const started = performance.now()
    const budgetFrame = clone(frame)
    for (const command of this.ledger.getPendingCommands()) {
      const intent = command.intent
      if (command.commandId === excludingCommandId || intent.encounterId !== frame.encounterId || intent.turnCount !== frame.turnCount) continue
      const actor = budgetFrame.party.find((member) => member.actorId === intent.actorId)
      if (actor) {
        actor.mp = Math.max(0, actor.mp - intent.actionOffer.costs.mp)
        actor.tp = Math.max(0, actor.tp - intent.actionOffer.costs.tp)
      }
    }
    const evaluating = performance.now()
    const situation = evaluateSituation(budgetFrame, this.recentResults, this.playerConstraints)
    const choosing = performance.now()
    const selection = chooseAction(budgetFrame, situation, this.tacticPlan)
    if (diagnose) {
      const finished = performance.now()
      const intent = selection.kind === 'action' ? selection.intent : undefined
      emitBattleDiagnostic(this.options.onDiagnostic, {
        at: Date.now(),
        stamp: frame.stamp,
        encounterId: frame.encounterId,
        phase: 'selection',
        durationMs: finished - started,
        evaluationMs: choosing - evaluating,
        selectionMs: finished - choosing,
        reason: intent?.reason ?? (selection.kind !== 'action' ? selection.reason : 'selected'),
        commandId: intent?.commandId,
        opportunityId: frame.opportunity?.opportunityId,
        tacticRevision: this.tacticPlan.revision,
        controlGeneration: this.activeLease?.generation,
        ruleId: intent?.appliedRuleId,
      })
    }
    return selection
  }

  validateIntent(intent: ActionIntent, frame: BattleFrame): boolean {
    if (!active(this.status) || frame.opportunity?.opportunityId !== intent.opportunityId || contextKey(frame) !== this.observedContext) return false
    const selection = this.select(frame, intent.commandId)
    if (
      selection.kind !== 'action' ||
      JSON.stringify(selection.intent.actionOffer) !== JSON.stringify(intent.actionOffer) ||
      JSON.stringify(selection.intent.target) !== JSON.stringify(intent.target)
    )
      return false
    const refreshed = {
      ...intent,
      tacticRevision: selection.intent.tacticRevision,
      appliedRuleId: selection.intent.appliedRuleId,
      appliedRuleSignature: selection.intent.appliedRuleSignature,
      reason: selection.intent.reason,
    }
    if (!this.ledger.refreshPlannedIntent(refreshed)) return false
    Object.assign(intent, refreshed)
    return true
  }

  onFrameUpdate(input: BattleFrame, allowDispatch = true): ActionSelectionResult | null {
    if (!active(this.status)) return null
    const frame = clone(input)
    if (frame.stamp.scope.runtimeInstanceId !== this.options.runtimeInstanceId) {
      this.pause()
      return null
    }
    if (this.observedContext && this.observedContext !== contextKey(frame)) {
      if (this.previousEncounter) {
        this.ledger.finishEncounter(this.previousEncounter.id, 'unknown', this.previousEncounter.turn)
        this.recording.finish(this.previousEncounter.id, 'unknown', this.previousEncounter.turn)
      }
      this.pendingDecisionTicket = null
      this.recentResults = []
      this.occupied.clear()
      this.retryAfter.clear()
      this.reviewReason = null
      this.defensiveRound = { turn: -1, count: 0, guarded: false, other: false }
    }
    this.observedContext = contextKey(frame)
    this.previousEncounter = { id: frame.encounterId, turn: frame.turnCount }
    const previousFrame = this.latestFrame
    this.latestFrame = frame
    // MV/MZ can increment the turn while the last actor's confirmation is still settling.
    // Keep that input round open until the next command phase so its commitment is counted.
    if ((frame.phase === 'party_command' || frame.phase === 'actor_command') && this.defensiveRound.turn !== frame.turnCount) {
      const previous = this.defensiveRound
      const count = frame.turnCount === previous.turn + 1 && previous.guarded && !previous.other ? previous.count + 1 : 0
      this.defensiveRound = { turn: frame.turnCount, count, guarded: false, other: false }
      if (count >= 3) this.reviewReason = 'repeated_emergency_guard'
    }
    if (this.pendingDecisionTicket && Date.now() >= this.pendingDecisionTicket.expiresAt) this.pendingDecisionTicket = null
    if (previousFrame?.encounterId === frame.encounterId) {
      if (
        frame.party.some((member) => {
          const previous = previousFrame.party.find((candidate) => candidate.actorId === member.actorId)
          return previous && previous.hp > 0 && (member.isDead || previous.hp - member.hp >= member.hpMax * 0.25)
        })
      )
        this.reviewReason = 'sudden_party_damage'
      else if (frame.enemies.some((enemy) => !previousFrame.enemies.some((previous) => previous.instanceId === enemy.instanceId && previous.enemyId === enemy.enemyId))) {
        this.reviewReason = 'enemy_composition_changed'
      }
    }
    if (!this.activeLease || !this.options.arbiter.isCurrent(this.activeLease)) {
      this.activeLease = null
      this.pendingDecisionTicket = null
      this.setStatus('paused')
      return null
    }

    this.ledger.startEncounter(frame.encounterId, frame.stamp.scope.libraryGameId, frame.stamp.scope.playthroughId)
    this.recording.observe(frame)
    const plan = expireTactics(this.tacticPlan, frame)
    if (plan !== this.tacticPlan) this.pendingDecisionTicket = null
    this.tacticPlan = plan
    this.ledger.pruneOld()
    for (const [key, until] of this.retryAfter) {
      if (Date.now() >= until) this.retryAfter.delete(key)
    }
    for (const [key, occupied] of this.occupied) {
      const id = occupied.commandId
      const command = this.ledger.getCommand(id)
      if (
        command?.lifecycle === 'unknown' &&
        command.opportunityId !== frame.opportunity?.opportunityId &&
        (frame.opportunity || frame.phase === 'resolving' || frame.phase === 'result')
      )
        this.onCommandCommitted(id)
      if (occupied.turn < frame.turnCount - 1) this.occupied.delete(key)
      if (occupied.turn < frame.turnCount - 1) this.retryAfter.delete(key)
    }

    if (frame.phase !== 'party_command' && frame.phase !== 'actor_command') {
      this.setStatus('waiting_game')
      return null
    }
    if (this.defensiveRound.count >= 6) {
      this.options.onDecisionExhausted?.('连续多个回合仅执行保命防御，尚未找到可继续推进的战术，已暂停托管。')
      this.pause()
      return null
    }
    if (!allowDispatch || !frame.opportunity) return null
    if (this.ledger.getPendingCommands().length >= 128) {
      this.setStatus('waiting_game')
      return null
    }
    const key = this.opportunityKey(frame)
    if (this.occupied.has(key) || Date.now() < (this.retryAfter.get(key) || 0)) return null

    const selection = this.select(frame, undefined, true)
    if (selection.kind === 'action') {
      this.setStatus('running')
      if (this.reviewReason && Date.now() >= this.nextReviewAt && !this.pendingDecisionTicket) {
        this.nextReviewAt = Date.now() + 20_000
        this.checkAndTriggerDecision(frame, this.reviewReason, 'deep')
        this.reviewReason = null
      }
      selection.intent.encounterId = frame.encounterId
      selection.intent.turnCount = frame.turnCount
      // Reserve before invoking callbacks, including the uncertain-confirmation path.
      this.occupied.set(key, { commandId: selection.intent.commandId, turn: frame.turnCount })
      this.ledger.recordPlanned(selection.intent)
      this.lastCommandId = selection.intent.commandId
      this.recording.planned(selection.intent, frame.stamp.scope)
      try {
        this.options.onDispatchIntent?.(clone(selection.intent), { ...this.activeLease })
      } catch {
        this.onCommandUnknown(selection.intent.commandId)
      }
    } else if (selection.kind === 'blocked') {
      this.setStatus('waiting_decision')
      this.checkAndTriggerDecision(frame, selection.reason)
    } else {
      this.setStatus('waiting_game')
    }
    return selection
  }

  private opportunityKey(frame: BattleFrame): string {
    return `${contextKey(frame)}:${frame.opportunity?.opportunityId}`
  }

  private checkAndTriggerDecision(frame: BattleFrame, reason: string, mode: 'quick' | 'deep' = 'quick'): void {
    if (this.pendingDecisionTicket && Date.now() < this.pendingDecisionTicket.expiresAt) return
    const key = JSON.stringify([
      contextKey(frame),
      mode === 'quick' ? frame.opportunity?.opportunityId : 'encounter',
      frame.capabilitiesRevision,
      frame.decisionVersions,
      this.goalRevision,
      this.tacticPlan.revision,
      reason,
    ])
    if (key !== this.decisionKey) {
      this.decisionKey = key
      this.decisionAttempts = 0
      this.nextDecisionAt = 0
      this.pendingDecisionTicket = null
    }
    if (Date.now() < this.nextDecisionAt || !this.options.onRequestDecision) return
    if (this.decisionAttempts >= 3) {
      if (mode === 'quick') this.options.onDecisionExhausted?.()
      return
    }

    this.decisionAttempts += 1
    this.decisionGeneration += 1
    const ticket: DecisionTicket = {
      requestId: `dec-${Date.now()}-${this.decisionGeneration}`,
      stamp: clone(frame.stamp),
      encounterId: frame.encounterId,
      goalRevision: this.goalRevision,
      controlGeneration: this.activeLease!.generation,
      baseTacticRevision: this.tacticPlan.revision,
      decisionGeneration: this.decisionGeneration,
      capabilitiesRevision: frame.capabilitiesRevision,
      ...frame.decisionVersions,
      expiresAt: Date.now() + (mode === 'deep' ? 30_000 : 8_000),
      mode,
      reason,
      dependencies:
        mode === 'quick'
          ? [
              { name: 'phase', expected: frame.phase },
              { name: 'encounterId', expected: frame.encounterId },
              { name: 'opportunityId', expected: frame.opportunity?.opportunityId || '' },
            ]
          : [{ name: 'encounterId', expected: frame.encounterId }],
    }
    this.pendingDecisionTicket = ticket
    this.nextDecisionAt = ticket.expiresAt + 1000 * this.decisionAttempts
    try {
      const request = this.options.onRequestDecision(clone(ticket))
      if (request) void request.catch(() => this.onDecisionFailed(ticket.requestId))
    } catch {
      this.onDecisionFailed(ticket.requestId)
    }
  }

  onDecisionFailed(requestId: string): void {
    if (this.pendingDecisionTicket?.requestId !== requestId) return
    this.pendingDecisionTicket = null
    this.nextDecisionAt = Date.now() + 1000 * this.decisionAttempts
  }

  applyModelTacticPatch(ticket: DecisionTicket, patch: unknown): { accepted: boolean; reason?: string } {
    if (!active(this.status)) return { accepted: false, reason: 'STATUS_NOT_ACTIVE' }
    if (!this.activeLease || !this.options.arbiter.isCurrent(this.activeLease)) return { accepted: false, reason: 'LEASE_REVOKED' }
    const saved = this.pendingDecisionTicket
    const frame = this.latestFrame
    // The caller receives a copy. Its envelope cannot extend a deadline or drop dependencies.
    if (!saved || JSON.stringify(ticket) !== JSON.stringify(saved)) return { accepted: false, reason: 'UNKNOWN_OR_MODIFIED_TICKET' }
    if (!frame || Date.now() >= saved.expiresAt) return { accepted: false, reason: 'EXPIRED' }
    if (
      saved.controlGeneration !== this.activeLease.generation ||
      saved.goalRevision !== this.goalRevision ||
      saved.baseTacticRevision !== this.tacticPlan.revision ||
      saved.decisionGeneration !== this.decisionGeneration ||
      JSON.stringify(saved.stamp.scope) !== JSON.stringify(frame.stamp.scope) ||
      saved.stamp.contextEpoch !== frame.stamp.contextEpoch ||
      saved.encounterId !== frame.encounterId ||
      saved.capabilitiesRevision !== frame.capabilitiesRevision ||
      saved.memoryEpoch !== frame.decisionVersions?.memoryEpoch ||
      saved.recordingRevision !== frame.decisionVersions?.recordingRevision
    ) {
      return { accepted: false, reason: 'STALE_CONTEXT' }
    }
    const dependencies: Record<string, string | number | boolean> = {
      phase: frame.phase,
      encounterId: frame.encounterId,
      opportunityId: frame.opportunity?.opportunityId || '',
    }
    if (!saved.dependencies.every((d) => Object.prototype.hasOwnProperty.call(dependencies, d.name) && dependencies[d.name] === d.expected)) {
      return { accepted: false, reason: 'DEPENDENCY_CHANGED' }
    }
    try {
      this.tacticPlan = applyTacticPatch(this.tacticPlan, patch)
      this.pendingDecisionTicket = null
      this.setStatus('running')
      return { accepted: true }
    } catch (err) {
      this.onDecisionFailed(saved.requestId)
      return { accepted: false, reason: (err as Error).message }
    }
  }

  onCommandNavigating(commandId: string): void {
    this.ledger.recordNavigating(commandId)
  }
  onCommandConfirming(commandId: string): void {
    this.ledger.recordConfirming(commandId)
  }

  onCommandCommitted(commandId: string): void {
    const command = this.ledger.getCommand(commandId)
    if (!command || !this.ledger.recordCommitted(commandId)) return
    this.recording.committed(command.intent, this.ledger.getCommand(commandId)!.committedAt!)
    const intent = command.intent
    if (intent.actorId !== undefined && intent.encounterId === this.latestFrame?.encounterId && intent.turnCount === this.defensiveRound.turn) {
      if (intent.actionOffer.kind === 'guard' && (!intent.appliedRuleId || intent.appliedRuleId === 'default_self_preserve_guard')) this.defensiveRound.guarded = true
      else {
        this.defensiveRound.other = true
        this.defensiveRound.count = 0
      }
    }
    if (command.intent.encounterId) this.ledger.incrementCommandsCommitted(command.intent.encounterId)
    const next = consumeTactic(this.tacticPlan, command.intent)
    if (next !== this.tacticPlan) this.pendingDecisionTicket = null
    this.tacticPlan = next
  }

  onCommandResult(result: ObservedActionResult, scope?: RuntimeScope): void {
    const started = performance.now()
    this.recording.result(result, scope)
    if (!this.ledger.ingestResult(result)) return
    // A correlated result is also proof that this command was committed.
    if (result.commandId) {
      this.onCommandCommitted(result.commandId)
      this.ledger.recordObserved(result.commandId, result)
    }
    const command = result.commandId ? this.ledger.getCommand(result.commandId) : undefined
    const frame = this.latestFrame
    if (frame && (!result.encounterId || result.encounterId === frame.encounterId) && (!scope || JSON.stringify(scope) === JSON.stringify(frame.stamp.scope))) {
      emitBattleDiagnostic(this.options.onDiagnostic, {
        at: Date.now(),
        stamp: frame.stamp,
        encounterId: frame.encounterId,
        phase: 'result',
        durationMs: performance.now() - started,
        reason: command ? 'command_correlated' : 'unattributed_result',
        commandId: result.commandId,
        resultId: result.resultId,
        tacticRevision: command?.intent.tacticRevision,
        ruleId: command?.intent.appliedRuleId,
      })
    }
    if (result.encounterId && result.encounterId !== this.latestFrame?.encounterId) return
    this.recentResults.push({ ...result })
    if (this.recentResults.length > 50) this.recentResults.shift()
  }

  onEncounterResult(encounterId: string, outcome: EncounterOutcome, turns: number, scope?: RuntimeScope, at?: number): void {
    this.recording.finish(encounterId, outcome, turns, scope, at)
    this.ledger.finishEncounter(encounterId, outcome, turns)
    if (active(this.status) && encounterId === this.latestFrame?.encounterId) {
      this.pendingDecisionTicket = null
      this.setStatus('waiting_game')
    }
  }

  onCommandUnknown(commandId: string): void {
    this.ledger.recordUnknown(commandId)
  }

  onCommandCancelled(commandId: string): void {
    if (!this.ledger.recordCancelled(commandId)) return
    for (const [key, occupied] of this.occupied) {
      if (occupied.commandId === commandId) {
        this.occupied.delete(key)
        this.retryAfter.set(key, Date.now() + 1000)
      }
    }
  }
}
