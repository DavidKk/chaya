import { CompanionCoordinator } from '@/lib/game-agent/companion/core/coordinator'
import type { BattleRecordEvent } from '@/lib/game-agent/companion/core/recording-types'
import type {
  ActionIntent,
  BattleFrame,
  CompanionRunStatus,
  ControlArbiter,
  ControlLease,
  DecisionTicket,
  PlayerConstraint,
  TacticPlan,
} from '@/lib/game-agent/companion/core/types'

import { AGENT_MANUAL_INPUT_EVENT } from '../../handlers'
import type { CompanionFactsInstance } from '../companion-facts'
import { readLiveBattleFrame } from './battle-adapter'
import { createBattleNavigationPort } from './battle-input'
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
}

export class CompanionBattleRuntime {
  public readonly arbiter: ControlArbiter
  public readonly coordinator: CompanionCoordinator
  private readonly navigator: BattleNavigator
  private readonly removeListeners: Array<() => void> = []
  private timer?: ReturnType<typeof setInterval>
  private navigating = false
  private disposed = false

  constructor(private readonly deps: CompanionRuntimeDeps) {
    this.arbiter = deps.arbiter
    this.navigator = new BattleNavigator(
      this.arbiter,
      createBattleNavigationPort(
        this.arbiter,
        () => this.readFrame(),
        (id) => this.coordinator.onCommandConfirming(id)
      )
    )
    this.coordinator = new CompanionCoordinator({
      runtimeInstanceId: deps.runtimeInstanceId,
      arbiter: this.arbiter,
      onDispatchIntent: (intent, lease) => {
        void this.dispatchIntent(intent, lease)
      },
      onRequestDecision: deps.onRequestDecision,
      onStatusChange: deps.onStatusChange,
      onRecord: deps.onRecord,
    })
    this.removeListeners.push(
      installBattleResultHook(
        deps.facts,
        (result) => this.coordinator.onCommandResult(result, deps.facts.current().stamp.scope),
        (id, outcome, turns, event) => this.coordinator.onEncounterResult(id, outcome, turns, deps.facts.current().stamp.scope, event.at)
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
    this.coordinator.stop()
    this.stopPump()
  }

  private startPump(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 200)
  }
  private stopPump(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  tick(): void {
    if (!['running', 'waiting_game', 'waiting_decision'].includes(this.coordinator.getStatus())) return
    const frame = this.readFrame()
    if (frame) this.coordinator.onFrameUpdate(frame, !this.navigating)
    else this.coordinator.onObservationUnavailable()
  }

  private async dispatchIntent(intent: ActionIntent, lease: ControlLease): Promise<void> {
    this.navigating = true
    this.coordinator.onCommandNavigating(intent.commandId)
    try {
      const result = await this.navigator.execute(intent, lease)
      if (result.ok && result.committed) this.coordinator.onCommandCommitted(intent.commandId)
      else if (!result.ok && result.unknown) this.coordinator.onCommandUnknown(intent.commandId)
      else this.coordinator.onCommandCancelled(intent.commandId)
    } catch {
      this.coordinator.onCommandUnknown(intent.commandId)
    } finally {
      this.navigating = false
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
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    for (const remove of this.removeListeners) remove()
  }
}
