import { CompanionCoordinator } from '@/lib/game-agent/companion/core/coordinator'
import { type BattleDiagnosticSink, emitBattleDiagnostic } from '@/lib/game-agent/companion/core/diagnostics'
import type { BattleRecordEvent } from '@/lib/game-agent/companion/core/recording-types'
import type {
  ActionIntent,
  BattleFrame,
  CompanionRunStatus,
  ControlArbiter,
  ControlLease,
  DecisionTicket,
  EncounterOutcome,
  PlayerConstraint,
  TacticPlan,
} from '@/lib/game-agent/companion/core/types'
import type { ContextStamp } from '@/lib/game-agent/companion/types'

import { AGENT_MANUAL_INPUT_EVENT } from '../../handlers'
import type { CompanionFactsInstance } from '../companion-facts'
import { readLiveBattleFrame } from './battle-adapter'
import { createBattleNavigationPort } from './battle-input'
import { advanceBattleMessage } from './battle-message'
import { BattleNavigator } from './battle-navigator'
import { installBattleResultHook } from './battle-result-hook'

export type CompanionRuntimeDeps = {
  runtimeInstanceId: string
  arbiter: ControlArbiter
  facts: Pick<CompanionFactsInstance, 'current' | 'subscribe'>
  getCapabilitiesRevision: () => number
  getDecisionVersions?: () => { memoryEpoch: number; recordingRevision: number }
  onRequestDecision?: (ticket: DecisionTicket) => void | Promise<void>
  onStatusChange?: (status: CompanionRunStatus) => void
  onRecord?: (event: BattleRecordEvent) => void
  onEncounterResult?: (encounterId: string, outcome: EncounterOutcome, turns: number) => void
  checkSupport?: () => string | null
  onUnsupported?: (reason: string) => void
  onDiagnostic?: BattleDiagnosticSink
}

export class CompanionBattleRuntime {
  public readonly arbiter: ControlArbiter
  public readonly coordinator: CompanionCoordinator
  private readonly navigator: BattleNavigator
  private readonly removeListeners: Array<() => void> = []
  private timer?: ReturnType<typeof setInterval>
  private navigating = false
  private navigation?: Promise<void>
  private disposed = false
  private pendingOutcome?: { encounterId: string; outcome: EncounterOutcome; turns: number; stamp: ContextStamp }
  private observationMissingSince: number | null = null
  private engineWait: { started: number; frame: BattleFrame; tacticRevision: number; controlGeneration?: number } | null = null

  constructor(private readonly deps: CompanionRuntimeDeps) {
    this.arbiter = deps.arbiter
    this.navigator = new BattleNavigator(this.arbiter, {
      ...createBattleNavigationPort(
        this.arbiter,
        () => this.readFrame(),
        (id) => this.coordinator.onCommandConfirming(id)
      ),
      validateIntent: (intent, frame) => this.coordinator.validateIntent(intent, frame),
    })
    this.coordinator = new CompanionCoordinator({
      runtimeInstanceId: deps.runtimeInstanceId,
      arbiter: this.arbiter,
      onDispatchIntent: (intent, lease) => {
        this.navigation = this.dispatchIntent(intent, lease)
      },
      onRequestDecision: deps.onRequestDecision,
      onDecisionExhausted: (reason) => {
        if (reason) deps.onUnsupported?.(reason)
        this.pause()
      },
      onStatusChange: deps.onStatusChange,
      onRecord: deps.onRecord,
      onDiagnostic: deps.onDiagnostic,
    })
    this.removeListeners.push(
      installBattleResultHook(
        deps.facts,
        (result) => this.coordinator.onCommandResult(result, deps.facts.current().stamp.scope),
        (id, outcome, turns, event) => {
          const encounter = this.coordinator.ledger.getEncounter(id)
          this.coordinator.onEncounterResult(id, outcome, turns, deps.facts.current().stamp.scope, event.at)
          if (encounter && encounter.finishedAt === undefined) {
            if (outcome === 'win' || outcome === 'escape') {
              // The engine publishes victory before its result message is dismissed.
              // Keep input authority until the scene exits so single-battle goals
              // can acknowledge narration before their task disposes this runtime.
              this.pendingOutcome = { encounterId: id, outcome, turns, stamp: deps.facts.current().stamp }
            } else deps.onEncounterResult?.(id, outcome, turns)
          }
        }
      )
    )
    if (typeof window !== 'undefined') {
      const manual = () => {
        this.coordinator.onManualTakeover()
        this.stopPump()
      }
      window.addEventListener(AGENT_MANUAL_INPUT_EVENT, manual)
      this.removeListeners.push(() => window.removeEventListener(AGENT_MANUAL_INPUT_EVENT, manual))
    }
  }

  private readFrame(): BattleFrame | null {
    const view = this.deps.facts.current()
    const id = view.current.encounterId
    if (!id.known || !id.value || view.current.isPaused) return null
    const frame = readLiveBattleFrame(view.stamp, this.deps.getCapabilitiesRevision(), id.value)
    if (frame) frame.decisionVersions = this.deps.getDecisionVersions?.()
    return frame
  }

  start(ownerId = 'companion_auto'): ControlLease {
    if (this.disposed || this.navigating || this.arbiter.currentLease()) throw new Error('CONTROL_BUSY_OR_DISPOSED')
    const lease = this.arbiter.acquire({
      runtimeInstanceId: this.deps.runtimeInstanceId,
      ownerId,
      scope: 'battle',
      allowedActions: ['attack', 'guard', 'skill'],
      requestedAt: Date.now(),
    })
    this.coordinator.start(lease)
    this.observationMissingSince = null
    this.startPump()
    return lease
  }

  pause(): void {
    this.coordinator.pause()
    this.stopPump()
  }
  resume(): ControlLease {
    return this.start()
  }
  stop(): void {
    this.pendingOutcome = undefined
    this.coordinator.stop()
    this.stopPump()
  }

  private startPump(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 200)
  }
  private stopPump(): void {
    this.finishEngineWait('execution_stopped')
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  tick(): void {
    if (!['running', 'waiting_game', 'waiting_decision'].includes(this.coordinator.getStatus())) return
    if (this.pendingOutcome) {
      const { stamp, encounterId, outcome, turns } = this.pendingOutcome
      const current = this.deps.facts.current()
      if (current.stamp.contextEpoch !== stamp.contextEpoch || JSON.stringify(current.stamp.scope) !== JSON.stringify(stamp.scope)) this.pendingOutcome = undefined
      else if (current.current.scene?.known && current.current.scene.value !== 'battle') {
        this.pendingOutcome = undefined
        this.deps.onEncounterResult?.(encounterId, outcome, turns)
        if (!['running', 'waiting_game', 'waiting_decision'].includes(this.coordinator.getStatus())) return
      }
    }
    const unsupported = this.deps.checkSupport?.()
    if (unsupported) {
      this.deps.onUnsupported?.(unsupported)
      this.pause()
      return
    }
    const lease = this.coordinator.getActiveLease()
    if (!this.navigating && lease) {
      const message = advanceBattleMessage(this.arbiter, lease)
      if (message) {
        this.navigating = true
        this.navigation = message
          .catch(() => {
            if (this.arbiter.isCurrent(lease)) this.pause()
          })
          .finally(() => {
            this.navigating = false
          })
      }
    }
    const frame = this.readFrame()
    if (frame) {
      this.observationMissingSince = null
      if (this.engineWait && (this.engineWait.frame.encounterId !== frame.encounterId || this.engineWait.frame.stamp.contextEpoch !== frame.stamp.contextEpoch)) {
        this.finishEngineWait('context_changed')
      }
      if (!this.navigating && frame.phase === 'resolving') {
        if (!this.engineWait) {
          this.engineWait = {
            started: performance.now(),
            frame,
            tacticRevision: this.coordinator.getTacticPlan().revision,
            controlGeneration: this.coordinator.getActiveLease()?.generation,
          }
        }
      } else this.finishEngineWait('phase_changed')
      this.coordinator.onFrameUpdate(frame, !this.navigating)
    } else {
      this.finishEngineWait('observation_unavailable')
      this.coordinator.onObservationUnavailable()
      const current = this.deps.facts.current().current
      if (current.scene?.known && ['map', 'menu', 'shop', 'save'].includes(current.scene.value ?? '') && !current.encounterId.value) {
        this.observationMissingSince = null
        return
      }
      this.observationMissingSince ??= Date.now()
      if (Date.now() - this.observationMissingSince >= 30_000) {
        this.deps.onUnsupported?.('持续无法读取可验证的战斗现场，已暂停托管。')
        this.pause()
      }
    }
  }

  private finishEngineWait(reason: string): void {
    const wait = this.engineWait
    if (!wait) return
    this.engineWait = null
    emitBattleDiagnostic(this.deps.onDiagnostic, {
      at: Date.now(),
      stamp: wait.frame.stamp,
      encounterId: wait.frame.encounterId,
      phase: 'engine_wait',
      durationMs: performance.now() - wait.started,
      reason,
      tacticRevision: wait.tacticRevision,
      controlGeneration: wait.controlGeneration,
    })
  }

  private async dispatchIntent(intent: ActionIntent, lease: ControlLease): Promise<void> {
    const started = performance.now()
    const stamp = this.deps.facts.current().stamp
    let reason = 'navigation_failed'
    this.navigating = true
    this.coordinator.onCommandNavigating(intent.commandId)
    try {
      const result = await this.navigator.execute(intent, lease)
      reason = result.ok ? (result.committed ? 'committed' : 'not_committed') : result.reason
      if (result.ok && result.committed) this.coordinator.onCommandCommitted(intent.commandId)
      else if (!result.ok && result.unknown) {
        this.coordinator.onCommandUnknown(intent.commandId)
        if (this.arbiter.isCurrent(lease)) this.pause()
      } else this.coordinator.onCommandCancelled(intent.commandId)
    } catch {
      this.coordinator.onCommandUnknown(intent.commandId)
      if (this.arbiter.isCurrent(lease)) this.pause()
    } finally {
      this.navigating = false
      emitBattleDiagnostic(this.deps.onDiagnostic, {
        at: Date.now(),
        stamp,
        encounterId: intent.encounterId!,
        phase: 'navigation',
        durationMs: performance.now() - started,
        reason,
        commandId: intent.commandId,
        opportunityId: intent.opportunityId,
        tacticRevision: intent.tacticRevision,
        controlGeneration: lease.generation,
        ruleId: intent.appliedRuleId,
      })
    }
  }

  applyTacticPatch(ticket: DecisionTicket, patch: unknown): { accepted: boolean; reason?: string } {
    // Re-observe on receipt; timer cadence is not a freshness guarantee.
    const frame = this.readFrame()
    if (frame) this.coordinator.onFrameUpdate(frame, false)
    else this.coordinator.onObservationUnavailable()
    return this.coordinator.applyModelTacticPatch(ticket, patch)
  }
  onDecisionFailed(requestId: string): void {
    this.coordinator.onDecisionFailed(requestId)
  }
  addPlayerConstraint(constraint: PlayerConstraint): void {
    this.coordinator.addPlayerConstraint(constraint)
  }
  clearPlayerConstraints(): void {
    this.coordinator.clearPlayerConstraints()
  }
  getStatus(): CompanionRunStatus {
    return this.coordinator.getStatus()
  }
  getTacticPlan(): TacticPlan {
    return this.coordinator.getTacticPlan()
  }
  async whenIdle(): Promise<void> {
    await this.navigation
    await this.arbiter.whenIdle()
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    for (const remove of this.removeListeners) remove()
  }
}
