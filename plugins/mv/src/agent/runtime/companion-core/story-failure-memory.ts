import { currentAgentRuntimeIdentity } from '../identity'
import { readStoryFailureJournal, storyFailureJournalKey, writeStoryFailureJournal } from './story-failure-journal'
import { StoryLoopDetector } from './story-loop-detector'
import { storyNavigationFacts, type StoryRetryCondition, storyRetryFacts } from './story-retry-facts'

export type StoryFailure = {
  mapId: number
  eventId: number
  reason: string
  detail: string
  condition: StoryRetryCondition
  facts: string | null
  permanent: boolean
  attempts: number
  firstFailedAt: number
  lastFailedAt: number
}

type FailureStore = {
  owner: unknown
  gameId: string | undefined
  journalKey: string | null
  failures: Map<string, StoryFailure[]>
  choices: Map<string, Set<string>>
  pendingChoices: Map<string, Array<{ key: string; label: string; facts: string | null }>>
  loops: Map<number, StoryLoopDetector>
}

const STORAGE_KEY = '__CHAYA_STORY_FAILURE_MEMORY__'

class StoryChoiceAttempts {
  constructor(
    private readonly choices: string[],
    private readonly attempted: Set<string>,
    private readonly persist: (label: string) => void
  ) {}

  public has(index: number): boolean {
    return this.attempted.has(this.choices[index])
  }

  public add(index: number): void {
    if (index >= 0 && index < this.choices.length && !this.attempted.has(this.choices[index])) {
      this.attempted.add(this.choices[index])
      this.persist(this.choices[index])
    }
  }

  public get size(): number {
    return Array.from(this).length
  }

  public [Symbol.iterator](): IterableIterator<number> {
    return this.choices
      .map((_, index) => index)
      .filter((index) => this.has(index))
      .values()
  }
}

function storage(): FailureStore {
  const engine = globalThis as any
  const gameId = currentAgentRuntimeIdentity()?.libraryGameId
  let current: FailureStore | undefined = engine[STORAGE_KEY]
  if (!current || current.owner !== engine.$gameSystem || current.gameId !== gameId) {
    const journalKey = storyFailureJournalKey()
    const journal = readStoryFailureJournal(journalKey)
    current = {
      owner: engine.$gameSystem,
      gameId,
      journalKey,
      failures: new Map(journal?.failures ?? []),
      choices: new Map((journal?.choices ?? []).map(([key, labels]) => [key, new Set(labels)])),
      pendingChoices: new Map(),
      loops: new Map(),
    }
    engine[STORAGE_KEY] = current
  }
  current.pendingChoices ??= new Map()
  for (const [key, pending] of current.pendingChoices) {
    if (!Array.isArray(pending)) current.pendingChoices.delete(key)
  }
  return current
}

function persist(current: FailureStore): void {
  writeStoryFailureJournal(current.journalKey, {
    version: 1,
    failures: [...current.failures],
    choices: [...current.choices].map(([key, labels]) => [key, [...labels]]),
  })
}

export class StoryFailureMemory {
  public static record(mapId: number, eventId: number, reason: string, detail: string, condition: StoryRetryCondition = {}, permanent = false): StoryFailure {
    if (reason === 'no_path') condition = { ...condition, navigation: true }
    const current = storage()
    const records = current.failures
    const key = `${mapId}:${eventId}`
    const history = records.get(key) ?? []
    const facts = storyRetryFacts(mapId, eventId, condition)
    const previous = history.find(
      (failure) => failure.facts === facts && failure.reason === reason && failure.permanent === permanent && JSON.stringify(failure.condition) === JSON.stringify(condition)
    )
    if (previous) {
      previous.attempts++
      previous.lastFailedAt = Date.now()
      persist(current)
      return previous
    }
    const failure: StoryFailure = {
      mapId,
      eventId,
      reason,
      detail,
      condition: { ...condition },
      facts,
      permanent,
      attempts: 1,
      firstFailedAt: Date.now(),
      lastFailedAt: Date.now(),
    }
    history.push(failure)
    records.set(key, history)
    persist(current)
    return failure
  }

  public static blocked(mapId: number, eventId: number): StoryFailure | undefined {
    return storage()
      .failures.get(`${mapId}:${eventId}`)
      ?.find((failure) => {
        if (failure.reason === 'error') return false
        if (failure.permanent) return true
        if (failure.reason === 'no_path' && !failure.condition.navigation && storyNavigationFacts(eventId)?.[0] === 'reachable') return false
        const current = storyRetryFacts(mapId, eventId, failure.condition)
        return current === null || failure.facts === null || current === failure.facts
      })
  }

  public static history(mapId: number, eventId?: number): StoryFailure[] {
    return Array.from(storage().failures.values())
      .flat()
      .filter((failure) => failure.mapId === mapId && (eventId === undefined || failure.eventId === eventId))
      .map((failure) => ({ ...failure, condition: { ...failure.condition } }))
  }

  public static choiceAttempts(mapId: number, eventId: number, choices: string[], condition: StoryRetryCondition = {}, prompt = ''): StoryChoiceAttempts {
    const current = storage()
    const facts = storyRetryFacts(mapId, eventId, condition)
    const key = JSON.stringify(['outcome-v3', mapId, eventId, prompt, [...choices].sort(), condition, facts])
    if (!current.choices.has(key)) current.choices.set(key, new Set())
    const eventKey = `${mapId}:${eventId}`
    const pending = current.pendingChoices.get(eventKey) ?? []
    const attempted = new Set([...current.choices.get(key)!, ...pending.filter((entry) => entry.key === key).map((entry) => entry.label)])
    return new StoryChoiceAttempts(choices, attempted, (label) => {
      const entries = current.pendingChoices.get(eventKey) ?? []
      entries.push({ key, label, facts: storyRetryFacts(mapId, eventId) })
      current.pendingChoices.set(eventKey, entries)
    })
  }

  public static settleChoice(mapId: number, eventId: number, success: boolean): void {
    const current = storage()
    const eventKey = `${mapId}:${eventId}`
    const pending = current.pendingChoices.get(eventKey)
    current.pendingChoices.delete(eventKey)
    if (pending && !success) {
      for (const entry of pending) {
        if (!current.choices.has(entry.key)) current.choices.set(entry.key, new Set())
        current.choices.get(entry.key)!.add(entry.label)
      }
      persist(current)
    }
  }

  public static settleUnownedChoices(pendingEventId: number | null): void {
    const engine = globalThis as any
    if (engine.$gameMessage?.isBusy?.() || engine.$gameMap?.isEventRunning?.()) return
    for (const [key, pending] of storage().pendingChoices) {
      const [mapId, eventId] = key.split(':').map(Number)
      if (mapId === engine.$gameMap?.mapId?.() && eventId === pendingEventId) continue
      const changed = mapId !== engine.$gameMap?.mapId?.() || pending.some((entry) => entry.facts !== storyRetryFacts(mapId, eventId))
      this.settleChoice(mapId, eventId, changed)
    }
  }

  public static loopDetector(mapId: number): StoryLoopDetector {
    const current = storage()
    if (!current.loops.has(mapId)) current.loops.set(mapId, new StoryLoopDetector(12))
    return current.loops.get(mapId)!
  }
}
