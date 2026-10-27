import type { RuntimeScope } from '../types'
import { recordingFingerprint } from './recording-schema'
import type { BattleRecordEvent } from './recording-types'
import type { ActionIntent, BattleFrame, EncounterOutcome, ObservedActionResult } from './types'

/** Captures the scope at observation/planning time, before pause or load replaces current state. */
export class CompanionRecordingEmitter {
  private scopes = new Map<string, RuntimeScope>()
  private commands = new Map<string, RuntimeScope>()
  private observed = new Set<string>()

  constructor(private readonly sink?: (event: BattleRecordEvent) => void) {}

  observe(frame: BattleFrame): void {
    const previous = this.scopes.get(frame.encounterId)
    this.scopes.set(frame.encounterId, { ...frame.stamp.scope })
    if (previous && recordingFingerprint(previous) === recordingFingerprint(frame.stamp.scope)) return
    this.emit({
      eventId: 'start',
      kind: 'encounter_started',
      scope: frame.stamp.scope,
      encounterId: frame.encounterId,
      at: Date.now(),
      // A first frame may arrive midway through an encounter.
      coverage: 'partial',
    })
    this.trim(this.scopes)
  }

  planned(intent: ActionIntent, scope: RuntimeScope): void {
    this.commands.set(intent.commandId, { ...scope })
    this.trim(this.commands)
  }

  committed(intent: ActionIntent, at: number): void {
    const scope = this.commands.get(intent.commandId)
    if (!scope || !intent.encounterId) return
    this.emit({
      eventId: intent.commandId,
      kind: 'command_committed',
      scope,
      encounterId: intent.encounterId,
      at,
      commandId: intent.commandId,
      opportunityId: intent.opportunityId,
      actionKey: intent.actionOffer.actionKey,
      actorId: intent.actorId,
      tacticRevision: intent.tacticRevision,
      ruleId: intent.appliedRuleId,
    })
  }

  result(result: ObservedActionResult, suppliedScope?: RuntimeScope): void {
    const scope = (result.commandId ? this.commands.get(result.commandId) : undefined) || suppliedScope || (result.encounterId ? this.scopes.get(result.encounterId) : undefined)
    if (!scope || !result.encounterId || !result.resultId) return
    this.emit({ eventId: result.resultId, kind: 'action_result', scope, encounterId: result.encounterId, at: result.observedAt, result: { ...result, resultId: result.resultId } })
  }

  finish(encounterId: string, outcome: EncounterOutcome, turns: number, suppliedScope?: RuntimeScope, at = Date.now()): void {
    const scope = suppliedScope || this.scopes.get(encounterId)
    if (!scope) return
    this.emit({ eventId: `finish:${outcome}`, kind: 'encounter_finished', scope, encounterId, at, outcome, turns })
  }

  private emit(event: BattleRecordEvent): void {
    if (!this.sink) return
    const key = recordingFingerprint([event.scope, event.encounterId, event.kind, event.eventId])
    if (this.observed.has(key)) return
    this.observed.add(key)
    if (this.observed.size > 2048) this.observed.delete(this.observed.values().next().value!)
    try {
      this.sink(JSON.parse(JSON.stringify(event)) as BattleRecordEvent)
    } catch {
      // Persistence diagnostics belong to the writer; they cannot interrupt navigation.
    }
  }

  private trim(map: Map<string, RuntimeScope>): void {
    if (map.size > 256) map.delete(map.keys().next().value!)
  }
}
