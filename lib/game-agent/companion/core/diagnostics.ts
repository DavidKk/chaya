import type { ContextStamp } from '../types'

export type BattleDiagnostic = {
  at: number
  stamp: ContextStamp
  encounterId: string
  phase: 'selection' | 'navigation' | 'engine_wait' | 'result'
  durationMs: number
  reason: string
  commandId?: string
  opportunityId?: string
  tacticRevision?: number
  controlGeneration?: number
  ruleId?: string
  resultId?: string
  evaluationMs?: number
  selectionMs?: number
}

export type BattleDiagnosticSink = (event: BattleDiagnostic) => void

export function emitBattleDiagnostic(sink: BattleDiagnosticSink | undefined, event: BattleDiagnostic): void {
  try {
    sink?.(event)
  } catch {
    // Diagnostics cannot interrupt input, result correlation or control cleanup.
  }
}
