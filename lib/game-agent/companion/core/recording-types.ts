import type { RuntimeScope } from '../types'
import type { EncounterOutcome, ObservedActionResult } from './types'

export type BattleRecordBase = {
  eventId: string
  scope: RuntimeScope
  encounterId: string
  at: number
}

export type BattleRecordEvent = BattleRecordBase &
  (
    | { kind: 'encounter_started'; coverage: 'partial' | 'complete' }
    | { kind: 'encounter_finished'; outcome: EncounterOutcome; turns: number }
    | {
        kind: 'command_committed'
        commandId: string
        opportunityId: string
        actionKey: string
        actorId?: number
        tacticRevision: number
        ruleId?: string
      }
    | { kind: 'action_result'; result: ObservedActionResult & { resultId: string } }
  )

export type BattleRecordingBatch = {
  schemaVersion: 1
  events: BattleRecordEvent[]
}

export type BattleRecordingStatistics = {
  libraryGameId: string
  dataRevision: string
  playthroughId: string
  encounters: number
  win: number
  lose: number
  escape: number
  abort: number
  unknown: number
}

export type BattleRecordingSnapshot = {
  schemaVersion: 1
  projectionVersion: 1
  /** Counts describe recorded observations, including partial encounters, not all historical play. */
  coverage: 'observed_only'
  statistics: BattleRecordingStatistics[]
  recentEvents: BattleRecordEvent[]
  /** Detail retention is bounded; totals are not reconstructed from recentEvents. */
  detailsTrimmed: boolean
}

export type MemoryManagementRequest = {
  requestId: string
  expectedMemoryEpoch: number
  expectedRecordingRevision: number
} & ({ action: 'set_recording'; enabled: boolean } | { action: 'clear'; preferences?: boolean; episodes?: boolean })

export type MemoryManagementState = {
  memoryEpoch: number
  recordingRevision: number
  recordingEnabled: boolean
}
