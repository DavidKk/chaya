import { currentCompanionFacts } from '../companion-facts'
import { currentAgentRuntimeIdentity } from '../identity'
import type { StoryFailure } from './story-failure-memory'

export type StoryFailureJournal = {
  version: 1
  failures: Array<[string, StoryFailure[]]>
  choices: Array<[string, string[]]>
}

const owners = new WeakMap<object, string>()
const installed = new WeakSet<object>()
let warned = false

export function installStoryFailureJournal(): void {
  const engine = globalThis as any
  const manager = engine.DataManager
  if (!manager || installed.has(manager)) return
  installed.add(manager)
  const setup = manager.setupNewGame
  if (typeof setup === 'function') {
    manager.setupNewGame = function (...args: unknown[]) {
      const result = setup.apply(this, args)
      if (engine.$gameSystem) owners.set(engine.$gameSystem, `new:${Date.now()}:${Math.random()}`)
      return result
    }
  }
}

export function storyFailureJournalKey(): string | null {
  const engine = globalThis as any
  const gameId = currentAgentRuntimeIdentity()?.libraryGameId
  const owner = engine.$gameSystem
  if (!gameId || !owner) return null
  let scope = owners.get(owner)
  if (!scope) {
    const stamp = currentCompanionFacts()?.stamp().scope
    if (stamp?.playthroughId && !/^(unknown:|unknown-playthrough)/.test(stamp.playthroughId)) {
      scope = JSON.stringify([stamp.dataRevision, stamp.playthroughId])
    } else {
      const manager = engine.DataManager
      const slot = manager?._lastAccessedId
      const info = manager?.loadSavefileInfo?.(slot)
      if (info?.timestamp && slot) scope = JSON.stringify(['native', slot, info.timestamp])
    }
    if (scope) owners.set(owner, scope)
  }
  return scope ? `chaya.story.failures.v1:${JSON.stringify([gameId, scope])}` : null
}

function report(error: unknown): void {
  if (warned) return
  warned = true
  console.warn('[story-failure-journal] Could not persist failure memory', error)
}

export function readStoryFailureJournal(key: string | null): StoryFailureJournal | null {
  if (!key) return null
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (!raw) return null
    const journal = JSON.parse(raw)
    if (journal?.version !== 1 || !Array.isArray(journal.failures) || !Array.isArray(journal.choices)) return null
    const valid = journal.failures.every(
      (entry: any) =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        Array.isArray(entry[1]) &&
        entry[1].every(
          (failure: any) =>
            failure &&
            Number.isInteger(failure.mapId) &&
            Number.isInteger(failure.eventId) &&
            typeof failure.reason === 'string' &&
            typeof failure.detail === 'string' &&
            failure.condition &&
            typeof failure.condition === 'object' &&
            !Array.isArray(failure.condition) &&
            (failure.condition.requiredLevel === undefined || (Number.isFinite(failure.condition.requiredLevel) && failure.condition.requiredLevel >= 0)) &&
            (failure.condition.requiresLockpick === undefined || typeof failure.condition.requiresLockpick === 'boolean') &&
            (failure.condition.navigation === undefined || typeof failure.condition.navigation === 'boolean') &&
            (failure.condition.blockerEventIds === undefined ||
              (Array.isArray(failure.condition.blockerEventIds) && failure.condition.blockerEventIds.every((id: unknown) => Number.isInteger(id) && Number(id) > 0))) &&
            (failure.facts === null || typeof failure.facts === 'string') &&
            typeof failure.permanent === 'boolean' &&
            Number.isFinite(failure.attempts) &&
            Number.isFinite(failure.firstFailedAt) &&
            Number.isFinite(failure.lastFailedAt)
        )
    )
    if (
      !valid ||
      !journal.choices.every(
        (entry: any) => Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1]) && entry[1].every((label: unknown) => typeof label === 'string')
      )
    )
      return null
    return journal
  } catch (error) {
    report(error)
    return null
  }
}

export function writeStoryFailureJournal(key: string | null, journal: StoryFailureJournal): void {
  if (!key) return
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(journal))
  } catch (error) {
    report(error)
  }
}
