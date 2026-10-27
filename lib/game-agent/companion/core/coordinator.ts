import { chooseAction } from './action-selector'
import { CompanionActionLedger } from './ledger'
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
  onStatusChange?: (status: CompanionRunStatus) => void
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
  public readonly ledger = new CompanionActionLedger()

  constructor(private readonly options: CoordinatorOptions) {
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
    this.playerConstraints.push({ ...constraint })
    this.goalRevision += 1
    this.pendingDecisionTicket = null
  }

  clearPlayerConstraints(): void {
    this.playerConstraints = []
    this.goalRevision += 1
    this.pendingDecisionTicket = null
  }

  onFrameUpdate(input: BattleFrame, allowDispatch = true): ActionSelectionResult | null {
    if (!active(this.status)) return null
    const frame = clone(input)
    if (frame.stamp.scope.runtimeInstanceId !== this.options.runtimeInstanceId) {
      this.pause()
      return null
    }
    if (this.observedContext && this.observedContext !== contextKey(frame)) {
      if (this.previousEncounter) this.ledger.finishEncounter(this.previousEncounter.id, 'unknown', this.previousEncounter.turn)
      this.pendingDecisionTicket = null
      this.recentResults = []
      this.occupied.clear()
      this.retryAfter.clear()
    }
    this.observedContext = contextKey(frame)
    this.previousEncounter = { id: frame.encounterId, turn: frame.turnCount }
    this.latestFrame = frame
    if (!this.activeLease || !this.options.arbiter.isCurrent(this.activeLease)) {
      this.activeLease = null
      this.pendingDecisionTicket = null
      this.setStatus('paused')
      return null
    }

    this.ledger.startEncounter(frame.encounterId, frame.stamp.scope.libraryGameId, frame.stamp.scope.playthroughId)
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
    if (!allowDispatch || !frame.opportunity) return null
    if (this.ledger.getPendingCommands().length >= 128) {
      this.setStatus('waiting_game')
      return null
    }
    const key = this.opportunityKey(frame)
    if (this.occupied.has(key) || Date.now() < (this.retryAfter.get(key) || 0)) return null

    const selection = chooseAction(frame, evaluateSituation(frame, this.recentResults, this.playerConstraints), this.tacticPlan)
    if (selection.kind === 'action') {
      this.setStatus('running')
      selection.intent.encounterId = frame.encounterId
      // Reserve before invoking callbacks, including the uncertain-confirmation path.
      this.occupied.set(key, { commandId: selection.intent.commandId, turn: frame.turnCount })
      this.ledger.recordPlanned(selection.intent)
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

  private checkAndTriggerDecision(frame: BattleFrame, reason: string): void {
    const key = JSON.stringify([
      contextKey(frame),
      frame.opportunity?.opportunityId,
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
    if (this.pendingDecisionTicket && Date.now() < this.pendingDecisionTicket.expiresAt) return
    if (Date.now() < this.nextDecisionAt || this.decisionAttempts >= 3 || !this.options.onRequestDecision) return

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
      expiresAt: Date.now() + 15_000,
      dependencies: [
        { name: 'phase', expected: frame.phase },
        { name: 'encounterId', expected: frame.encounterId },
        { name: 'opportunityId', expected: frame.opportunity?.opportunityId || '' },
      ],
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
    if (command.intent.encounterId) this.ledger.incrementCommandsCommitted(command.intent.encounterId)
    const next = consumeTactic(this.tacticPlan, command.intent)
    if (next !== this.tacticPlan) this.pendingDecisionTicket = null
    this.tacticPlan = next
  }

  onCommandResult(result: ObservedActionResult): void {
    if (!this.ledger.ingestResult(result)) return
    // A correlated result is also proof that this command was committed.
    if (result.commandId) {
      this.onCommandCommitted(result.commandId)
      this.ledger.recordObserved(result.commandId, result)
    }
    if (result.encounterId && result.encounterId !== this.latestFrame?.encounterId) return
    this.recentResults.push({ ...result })
    if (this.recentResults.length > 50) this.recentResults.shift()
  }

  onEncounterResult(encounterId: string, outcome: EncounterOutcome, turns: number): void {
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
