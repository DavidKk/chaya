import type { BattleRecordEvent } from '@/lib/game-agent/companion/core/recording-types'
import type { MemoryWriteBatch } from '@/lib/game-agent/companion/memory-types'
import type { ActionEvidence } from '@/lib/game-agent/companion/types'

import { battleFrame } from './core/fixtures'

export const experienceScope = battleFrame().stamp.scope

export function hpResult(index: number, overrides: Partial<ActionEvidence> = {}, event: Partial<BattleRecordEvent> = {}): BattleRecordEvent {
  const evidence: ActionEvidence = {
    actionId: `action-${index}`,
    resultId: `result-${index}`,
    source: { kind: 'enemy', id: 10, instance: 'enemy:0' },
    target: { kind: 'actor', id: 1, instance: 'actor:1' },
    ability: { kind: 'skill', id: 1 },
    hpBefore: 100,
    hpAfter: 90,
    hpMax: 100,
    reportedHpDamage: 999,
    stateIdsBefore: [],
    stateIdsAfter: [],
    attribution: 'observed_action',
    ...overrides,
  }
  return {
    scope: experienceScope,
    encounterId: `previous-${index % 2}`,
    at: index + 1,
    ...event,
    eventId: evidence.resultId,
    kind: 'action_result',
    result: { resultId: evidence.resultId, observedAt: index + 1, evidence },
  }
}

export function experienceBatch(events: BattleRecordEvent[], memoryEpoch = 1, recordingRevision = 1): MemoryWriteBatch {
  return { schemaVersion: 1, batchId: 'experience-batch', memoryEpoch, recordingRevision, at: 100, battleRecording: { schemaVersion: 1, events } }
}
