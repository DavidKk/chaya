/**
 * Companion Action Ledger & Basic Statistics.
 * Correlates commands with observed results and tracks encounter outcomes idempotently.
 */

import type { ActionIntent, CommittedCommandState, EncounterOutcome, EncounterStatistics, ObservedActionResult } from './types'

export class CompanionActionLedger {
  private commands = new Map<string, CommittedCommandState>()
  private seenResults = new Set<string>()
  private encounters = new Map<string, EncounterStatistics>()

  recordPlanned(intent: ActionIntent): void {
    if (this.commands.has(intent.commandId)) return
    this.commands.set(intent.commandId, {
      commandId: intent.commandId,
      opportunityId: intent.opportunityId,
      intent: JSON.parse(JSON.stringify(intent)) as ActionIntent,
      lifecycle: 'planned',
      results: [],
    })
  }

  recordNavigating(commandId: string): void {
    const entry = this.commands.get(commandId)
    if (entry && (entry.lifecycle === 'planned' || entry.lifecycle === 'navigating')) {
      entry.lifecycle = 'navigating'
    }
  }

  recordConfirming(commandId: string): void {
    const entry = this.commands.get(commandId)
    if (entry && (entry.lifecycle === 'navigating' || entry.lifecycle === 'planned')) {
      entry.lifecycle = 'confirming'
    }
  }

  recordCommitted(commandId: string): boolean {
    const entry = this.commands.get(commandId)
    if (!entry || entry.committedAt !== undefined || entry.lifecycle === 'cancelled') return false
    entry.lifecycle = 'committed'
    entry.committedAt = Date.now()
    return true
  }

  ingestResult(result: ObservedActionResult): boolean {
    if (!result.resultId) return true
    const key = JSON.stringify([result.encounterId, result.resultId])
    if (this.seenResults.has(key)) return false
    this.seenResults.add(key)
    if (this.seenResults.size > 2000) this.seenResults.delete(this.seenResults.values().next().value!)
    return true
  }

  recordObserved(commandId: string, result: ObservedActionResult): void {
    const entry = this.commands.get(commandId)
    if (entry && entry.committedAt !== undefined) {
      if (result.resultId && entry.results.some((r) => r.resultId === result.resultId)) return
      entry.lifecycle = 'observed'
      entry.results.push({ ...result })
    }
  }

  recordUnknown(commandId: string): void {
    const entry = this.commands.get(commandId)
    if (entry && entry.committedAt === undefined && entry.lifecycle !== 'cancelled') {
      entry.lifecycle = 'unknown'
    }
  }

  recordCancelled(commandId: string): boolean {
    const entry = this.commands.get(commandId)
    if (entry && entry.lifecycle !== 'committed' && entry.lifecycle !== 'observed') {
      entry.lifecycle = 'cancelled'
      return true
    }
    return false
  }

  getCommand(commandId: string): CommittedCommandState | undefined {
    const entry = this.commands.get(commandId)
    return entry ? (JSON.parse(JSON.stringify(entry)) as CommittedCommandState) : undefined
  }

  getPendingCommands(): CommittedCommandState[] {
    return Array.from(this.commands.values())
      .filter((c) => ['committed', 'confirming', 'unknown'].includes(c.lifecycle) && !(c.lifecycle === 'committed' && c.intent.actionOffer.actionKey === 'party:fight'))
      .map((c) => this.getCommand(c.commandId)!)
  }

  startEncounter(encounterId: string, libraryGameId: string, playthroughId: string): void {
    if (!this.encounters.has(encounterId)) {
      this.encounters.set(encounterId, {
        encounterId,
        libraryGameId,
        playthroughId,
        outcome: 'unknown',
        turnsCount: 0,
        commandsCommitted: 0,
        startedAt: Date.now(),
      })
    }
  }

  finishEncounter(encounterId: string, outcome: EncounterOutcome, turnsCount?: number): void {
    const enc = this.encounters.get(encounterId)
    if (enc && (enc.finishedAt === undefined || (enc.outcome === 'unknown' && outcome !== 'unknown'))) {
      enc.outcome = outcome
      enc.finishedAt ??= Date.now()
      if (turnsCount !== undefined) enc.turnsCount = turnsCount
    }
  }

  incrementCommandsCommitted(encounterId: string): void {
    const enc = this.encounters.get(encounterId)
    if (enc) {
      enc.commandsCommitted += 1
    }
  }

  getEncounter(encounterId: string): EncounterStatistics | undefined {
    const entry = this.encounters.get(encounterId)
    return entry ? { ...entry } : undefined
  }

  getOutcomeSummary(): {
    total: number
    win: number
    lose: number
    escape: number
    abort: number
    unknown: number
  } {
    const summary = { total: 0, win: 0, lose: 0, escape: 0, abort: 0, unknown: 0 }
    for (const enc of this.encounters.values()) {
      summary.total += 1
      summary[enc.outcome] += 1
    }
    return summary
  }

  pruneOld(maxRecords = 200): void {
    // Keep uncertain/live commands; completed encounters can no longer produce command results.
    for (const [id, entry] of this.commands) {
      if (this.commands.size <= maxRecords) break
      const finished = entry.intent.encounterId && this.encounters.get(entry.intent.encounterId)?.finishedAt !== undefined
      const partyConfirmed = entry.lifecycle === 'committed' && entry.intent.actionOffer.actionKey === 'party:fight'
      if (finished || partyConfirmed || ['observed', 'cancelled', 'rejected'].includes(entry.lifecycle)) this.commands.delete(id)
    }
    for (const [id, entry] of this.encounters) {
      if (this.encounters.size <= maxRecords) break
      if (entry.finishedAt !== undefined) this.encounters.delete(id)
    }
  }
}
