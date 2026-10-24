/**
 * Local reflex + speech scheduling (T4).
 * Pure react() for host sync events; generateLine / ReflexEngine keep panel-facing APIs.
 * Clock and randomness are injectable; no model I/O here.
 */

import type { CompanionCue } from '../companion'
import {
  canPassCooldown,
  clearCueScope,
  consumeNextCue,
  createCueScheduleState,
  type CueEnvelope,
  type CueScheduleState,
  defaultTtlForKind,
  enqueueCue,
  isDangerKind,
  normalizeCueKind,
  priorityForKind,
  recordCooldown,
  rememberSpokenLine,
  setVisibleConsumers,
  wasLineSpokenRecently,
} from './cue-schedule'
import { renderSpeechLine, type SpeechFacts, type SpeechMemoryOrigin } from './speech-lines'
import type { Cue, MemoryEpisode, RuntimeScope, UserPreference } from './types'

export type ReflexContext = {
  character: string
  locale: string
  recentEpisodes?: MemoryEpisode[]
  facts?: SpeechFacts
  scope?: Pick<RuntimeScope, 'libraryGameId' | 'dataRevision' | 'playthroughId'>
  random?: () => number
  memoryOrigin?: SpeechMemoryOrigin
}

export type ReflexEvent = {
  eventId: string
  kind: CompanionCue | Cue['kind'] | string
  segmentId?: string
  contextEpoch?: number
  factsRevision?: number
  priority?: number
  expiresAt?: number
  evidenceRefs?: string[]
  facts?: SpeechFacts & Record<string, unknown>
  targetKey?: string
  severity?: number
}

export type ReactState = {
  schedule: CueScheduleState
  character: string
  locale: string
}

export type ReactInput = {
  state: ReactState
  event?: ReflexEvent | null
  now?: number
  preferences?: UserPreference[]
  recentEpisodes?: MemoryEpisode[]
  visibleConsumers?: number
  scope?: Pick<RuntimeScope, 'libraryGameId' | 'dataRevision' | 'playthroughId' | 'segmentId'>
  contextEpoch?: number
  currentEncounterId?: string | null
  random?: () => number
  facts?: SpeechFacts
  memoryOrigin?: SpeechMemoryOrigin
  /** When true, only enqueue; caller drains with consume. Default drains one. */
  deferConsume?: boolean
}

export type ReactOutput = {
  state: ReactState
  cue: CueEnvelope | null
  line: string | null
  situation?: string
  evidenceRefs?: string[]
}

export function createReactState(init?: Partial<ReactState>): ReactState {
  return {
    schedule: createCueScheduleState(init?.schedule),
    character: init?.character ?? 'rin',
    locale: init?.locale ?? 'zh',
  }
}

function buildEnvelope(event: ReflexEvent, state: ReactState, now: number, scopeSegment?: string): CueEnvelope {
  const kind = normalizeCueKind(event.kind)
  const segmentId = event.segmentId || scopeSegment || state.schedule.segmentId || 'segment'
  const contextEpoch = event.contextEpoch ?? state.schedule.contextEpoch
  return {
    id: `cue-${event.eventId}-${kind}`,
    eventId: event.eventId,
    segmentId,
    priority: event.priority ?? priorityForKind(kind),
    expiresAt: event.expiresAt ?? now + defaultTtlForKind(kind),
    evidenceRefs: event.evidenceRefs ?? [],
    facts: event.facts ?? {},
    kind,
    contextEpoch,
    targetKey: event.targetKey,
    severity: event.severity,
  }
}

function speechFactsFromCue(cue: Pick<Cue, 'facts'> | ReflexEvent | null | undefined): SpeechFacts {
  const facts = (cue && 'facts' in cue ? (cue.facts ?? undefined) : undefined) as SpeechFacts | undefined
  return facts ?? {}
}

/** Pure companion.react: state + sync event → updated state and at most one speakable cue/line. */
export function react(input: ReactInput): ReactOutput {
  const now = input.now ?? Date.now()
  let state = input.state
  let schedule = state.schedule

  if (typeof input.visibleConsumers === 'number') {
    schedule = setVisibleConsumers(schedule, input.visibleConsumers)
  }
  if (input.contextEpoch != null || input.scope?.segmentId || input.currentEncounterId !== undefined) {
    schedule = clearCueScope(schedule, {
      contextEpoch: input.contextEpoch,
      segmentId: input.scope?.segmentId,
      currentEncounterId: input.currentEncounterId,
    })
  }

  state = { ...state, schedule }

  if (input.event) {
    const envelope = buildEnvelope(input.event, state, now, input.scope?.segmentId)
    const queued = enqueueCue(schedule, envelope, now)
    schedule = queued.state
    state = { ...state, schedule }
  }

  if (input.deferConsume) {
    return { state, cue: null, line: null }
  }

  const drained = consumeNextCue(schedule, now)
  schedule = drained.state
  state = { ...state, schedule }
  const cue = drained.cue
  if (!cue) return { state, cue: null, line: null }

  const cueFacts = speechFactsFromCue(cue)
  const overlayFacts = input.facts ?? {}
  const rendered = renderSpeechLine({
    kind: cue.kind,
    character: state.character,
    locale: state.locale,
    recentEpisodes: input.recentEpisodes,
    facts: {
      ...overlayFacts,
      ...cueFacts,
      libraryGameId: input.scope?.libraryGameId ?? overlayFacts.libraryGameId ?? cueFacts.libraryGameId,
      dataRevision: input.scope?.dataRevision ?? overlayFacts.dataRevision ?? cueFacts.dataRevision,
      playthroughId: input.scope?.playthroughId ?? overlayFacts.playthroughId ?? cueFacts.playthroughId,
      origin: input.memoryOrigin ?? overlayFacts.origin ?? cueFacts.origin,
      outcome: overlayFacts.outcome ?? cueFacts.outcome,
    },
    scope: input.scope,
    random: input.random,
    avoidKeys: schedule.recentLineKeys,
  })

  if (wasLineSpokenRecently(schedule, rendered.lineKey) && !isDangerKind(cue.kind)) {
    // Bounded de-dupe: skip ordinary repeat; keep danger.
    return { state, cue: null, line: null }
  }

  schedule = rememberSpokenLine(schedule, rendered.lineKey)
  state = { ...state, schedule }

  return {
    state,
    cue: { ...cue, evidenceRefs: rendered.evidenceRefs.length ? rendered.evidenceRefs : cue.evidenceRefs },
    line: rendered.text,
    situation: rendered.situation,
    evidenceRefs: rendered.evidenceRefs,
  }
}

/** Compatibility helper for older call sites that only need a line. */
export function generateLine(cue: CompanionCue | Cue['kind'] | Cue | string, context: ReflexContext): string {
  const kind = typeof cue === 'string' ? cue : cue.kind
  const facts = typeof cue === 'string' ? context.facts : { ...context.facts, ...speechFactsFromCue(cue) }
  return renderSpeechLine({
    kind,
    character: context.character,
    locale: context.locale,
    recentEpisodes: context.recentEpisodes,
    facts: {
      ...facts,
      origin: context.memoryOrigin ?? facts?.origin,
    },
    scope: context.scope,
    random: context.random,
  }).text
}

/**
 * Mutable façade used by the current panel loop.
 * Host sync path should prefer pure react() + injected now/random.
 */
export class ReflexEngine {
  private reactState: ReactState
  private lastSpokeTime: Record<string, number> = {}

  constructor(init?: Partial<ReactState>) {
    this.reactState = createReactState({
      ...init,
      schedule: createCueScheduleState({
        visibleConsumers: 1,
        ...(init?.schedule ?? {}),
      }),
    })
  }

  /** Panel-compatible gate; danger bypasses ordinary kind/total cooldowns. */
  shouldTrigger(cueKind: string, now: number = Date.now()): boolean {
    const kind = normalizeCueKind(cueKind)
    if (isDangerKind(kind)) return true
    return canPassCooldown(this.reactState.schedule, kind, now)
  }

  recordTrigger(cueKind: string, now: number = Date.now()): void {
    const kind = normalizeCueKind(cueKind)
    this.lastSpokeTime[kind] = now
    this.lastSpokeTime[cueKind] = now
    this.reactState = {
      ...this.reactState,
      schedule: recordCooldown(this.reactState.schedule, kind, now),
    }
  }

  render(cue: Cue, context: ReflexContext): string {
    this.reactState = {
      ...this.reactState,
      character: context.character,
      locale: context.locale,
    }
    return generateLine(cue, context)
  }

  /** Host-facing pure step with injectable clock/random; updates engine state. */
  react(input: Omit<ReactInput, 'state'> & { state?: ReactState }): ReactOutput {
    const output = react({
      ...input,
      state: input.state ?? this.reactState,
      visibleConsumers: input.visibleConsumers ?? Math.max(1, this.reactState.schedule.visibleConsumers),
    })
    this.reactState = output.state
    return output
  }

  clearScope(next: { contextEpoch?: number; segmentId?: string }): void {
    this.reactState = {
      ...this.reactState,
      schedule: clearCueScope(this.reactState.schedule, next),
    }
  }

  setVisibleConsumers(count: number): void {
    this.reactState = {
      ...this.reactState,
      schedule: setVisibleConsumers(this.reactState.schedule, count),
    }
  }

  getState(): ReactState {
    return this.reactState
  }
}

export const defaultReflexEngine = new ReflexEngine()
