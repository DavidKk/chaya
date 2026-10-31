import type { ObservedActionResult } from '@/lib/game-agent/companion/core/types'
import type { BattleResultGameEvent, CompanionDomainEvent } from '@/lib/game-agent/companion/types'

export type BattleEventSource = {
  subscribe(listener: (event: CompanionDomainEvent) => void): () => void
}

// Reuse the authoritative facts producer; do not wrap BattleManager again.
export function installBattleResultHook(
  source: BattleEventSource,
  onResult: (result: ObservedActionResult) => void,
  onEncounterResult: (encounterId: string, outcome: 'win' | 'lose' | 'escape' | 'abort', turns: number, event: BattleResultGameEvent) => void
): () => void {
  return source.subscribe((event) => {
    if (event.kind === 'battle_result') {
      onEncounterResult(event.encounterId, event.outcome, event.turns, event)
      return
    }
    if (event.kind !== 'action') return
    const delta = event.hpBefore !== null && event.hpAfter !== null ? event.hpBefore - event.hpAfter : event.reportedHpDamage
    onResult({
      commandId: event.attribution === 'observed_action' ? event.commandId : undefined,
      encounterId: event.encounterId,
      actionId: event.actionId,
      resultId: event.resultId,
      actorId: event.source.kind === 'actor' ? event.source.id : undefined,
      targetKind: event.target.kind,
      targetId: event.target.id,
      hpDamage: delta !== null && delta > 0 ? delta : undefined,
      hpRecovery: delta !== null && delta < 0 ? -delta : undefined,
      isKnockout: event.hpBefore !== null && event.hpBefore > 0 && event.hpAfter === 0,
      observedAt: event.at,
      evidence: {
        actionId: event.actionId,
        resultId: event.resultId,
        source: event.source,
        target: event.target,
        ability: event.ability,
        hpBefore: event.hpBefore,
        hpAfter: event.hpAfter,
        reportedHpDamage: event.reportedHpDamage,
        hpMax: event.hpMax,
        stateIdsBefore: event.stateIdsBefore,
        stateIdsAfter: event.stateIdsAfter,
        attribution: event.attribution,
      },
    })
  })
}
