/**
 * Companion host orchestration (T5). Parent wires createCompanionHost into the game host.
 */

import type { SourceGameEvent } from '@/lib/game-agent/audit'
import { canClaimDisarmUseful, hasGuardAction } from '@/lib/game-agent/companion/advice'
import type { GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { MemoryEpisodeRecord } from '@/lib/game-agent/companion/memory-types'
import { createReactState, react, type ReactState } from '@/lib/game-agent/companion/reflex-engine'
import { COMPANION_ROUTE_FORMAT, COMPANION_ROUTE_SYSTEM, parseCompanionRoute } from '@/lib/game-agent/companion/router'
import type { SpeechBattleOutcome, SpeechMemoryOrigin } from '@/lib/game-agent/companion/speech-lines'
import type { CompanionDomainEvent, ContextStamp, Cue, FactView, MemoryEpisode, UserPreference } from '@/lib/game-agent/companion/types'
import type { AgentTask } from '@/lib/game-agent/runtime'
import {
  COMPANION_LOCAL_EVENT,
  COMPANION_PROTOCOL_VERSION,
  type CompanionEventBatch,
  type CompanionHostRequest,
  type CompanionHostStatus,
  type CompanionMemoryResult,
  type CompanionMessageEvent,
  type CompanionRouteResult,
  type CompanionSelection,
} from '@/lib/runtime/companion-protocol'
import { isCompanionHostRequest } from '@/lib/runtime/companion-validation'

import { buildCandidateMessages, CompanionCandidateCache, parseCandidatePayload, PREPARE_FORMAT, renderCandidateTemplate } from './companion-candidates'
import { type CompanionChatHostDeps, CompanionChatSlot, type CompanionComplete, type CompanionControlStart } from './companion-chat'
import { CompanionRequestLedger, CONTROL_TICKET_TTL_MS, type ControlTicket } from './companion-requests'

export type CompanionFactsPort = {
  current(): FactView
  /** Matches T1 companion-facts; domain/source may be narrowed by the parent adapter. */
  subscribe(listener: (domainEvent: CompanionDomainEvent, sourceEvent: SourceGameEvent) => void): () => void
}

export type CompanionHostDependencies = {
  facts: CompanionFactsPort
  memory: GameplayMemoryStore
  complete: CompanionComplete
  startControl: CompanionControlStart
  stopExternalControl: () => void
  libraryGameId: string
  now?: () => number
  random?: () => number
}

export type CompanionHost = {
  dispatch(message: CompanionHostRequest, remote: boolean, signal?: AbortSignal): Promise<unknown>
  dispose(): void
}

type HostSettings = {
  recording: boolean
  naturalEnhancement: boolean
  verbosity: 'quiet' | 'normal' | 'chatty'
  spoilers: 'avoid' | 'allow'
  muteUntil: number
}

function selectionOf(message: CompanionHostRequest): CompanionSelection | null {
  if (message.type !== 'agent.companion.route' && message.type !== 'agent.companion.chat') return null
  return { profileId: message.profileId, model: message.model, locale: message.locale, character: message.character }
}

function nearbyUnopenedChest(details: Record<string, unknown> | undefined): boolean {
  if (!details) return false
  // Explicit nearby + unopened flags only; battle_reward / level_up must not qualify.
  const nearby = details.nearby === true || details.nearby === 'true'
  if (nearby) {
    if (details.unopened === true || details.unopened === 'true') return true
    if (details.opened === false || details.opened === 'false') return true
    if (details.opened === true || details.opened === 'true' || details.unopened === false || details.unopened === 'false') return false
  }
  const events = details.nearbyEvents ?? details.chests ?? details.nearbyChests
  if (!Array.isArray(events)) return false
  return events.some((item) => {
    if (!item || typeof item !== 'object') return false
    const row = item as Record<string, unknown>
    if (row.opened === true || row.opened === 'true') return false
    const unopened = row.unopened === true || row.unopened === 'true' || row.opened === false || row.opened === 'false' || row.opened == null
    const distance = typeof row.distance === 'number' ? row.distance : Number(row.distance)
    const near = !Number.isFinite(distance) || distance <= 6
    return near && unopened
  })
}

type DomainCueKind = 'battle_win' | 'battle_loss' | 'danger' | 'chest' | 'battle_start'

function eventKindFromDomain(domain: CompanionDomainEvent | null, view: FactView): DomainCueKind | null {
  if (domain?.kind === 'battle_result') {
    if (domain.outcome === 'win') return 'battle_win'
    if (domain.outcome === 'lose') return 'battle_loss'
    return null
  }
  if (domain?.kind === 'knockout' && domain.target.kind === 'actor') return 'danger'
  // battle_reward / level_up are claimed rewards — never treat as an unopened nearby chest.
  if (domain?.kind === 'milestone') {
    const name = domain.name || ''
    if (/battle_reward|level_up/i.test(name)) return null
    if (/^chest$/i.test(name) || name === 'nearby_chest' || name === 'unopened_chest') {
      if (nearbyUnopenedChest(domain.details)) return 'chest'
    }
    return null
  }
  const party = view.current.party.value ?? []
  if (party.some((member) => !member.isDead && member.hpMax > 0 && member.hp / member.hpMax <= 0.35)) return 'danger'
  if (view.current.scene.value === 'battle' && view.current.encounterId.value) return 'battle_start'
  return null
}

const LEGACY_EPISODE_KINDS = new Set(['knockout', 'battle_result', 'defense_attempt'])

function isLegacyEpisodeKind(kind: string): kind is MemoryEpisode['kind'] {
  return LEGACY_EPISODE_KINDS.has(kind)
}

type SpeechEpisodeExtra = MemoryEpisodeRecord & { origin?: string; outcome?: SpeechBattleOutcome }

function toSpeechEpisodes(records: MemoryEpisodeRecord[]): MemoryEpisode[] {
  const out: MemoryEpisode[] = []
  for (const episode of records) {
    if (!isLegacyEpisodeKind(episode.kind)) continue
    const extra = episode as SpeechEpisodeExtra
    out.push({
      episodeId: episode.episodeId,
      scope: episode.scope,
      encounterId: episode.encounterId,
      at: episode.at,
      kind: episode.kind,
      completeness: episode.completeness,
      summary: episode.summary,
      evidence: episode.evidence,
      memoryEpoch: episode.memoryEpoch,
      ...(episode.linkedFrom ? { linkedFrom: episode.linkedFrom } : {}),
      ...(extra.origin ? { origin: extra.origin } : {}),
      ...(extra.outcome ? { outcome: extra.outcome } : {}),
    } as MemoryEpisode)
  }
  return out
}

function mapMemoryEpisodes(detailed: { scope: CompanionMemoryResult['scope']; memoryEpoch: number; episodes: MemoryEpisodeRecord[] }): CompanionMemoryResult {
  return {
    scope: detailed.scope,
    memoryEpoch: detailed.memoryEpoch,
    episodes: toSpeechEpisodes(detailed.episodes),
  }
}

function memoryOriginOf(origin: string | undefined): SpeechMemoryOrigin | undefined {
  if (origin === 'linked_load_context') return 'linked_load_context'
  if (origin === 'current' || origin === 'current_playthrough') return 'current_playthrough'
  if (origin === 'unknown') return 'unknown'
  return undefined
}

function battleOutcomeOf(kind: DomainCueKind | null, domain: CompanionDomainEvent | null): SpeechBattleOutcome | undefined {
  if (domain?.kind === 'battle_result') return domain.outcome
  if (kind === 'battle_win') return 'win'
  if (kind === 'battle_loss') return 'lose'
  return undefined
}

export function createCompanionHost(deps: CompanionHostDependencies): CompanionHost {
  const now = deps.now ?? (() => Date.now())
  const random = deps.random ?? Math.random
  const ledger = new CompanionRequestLedger(now)
  const candidates = new CompanionCandidateCache(now)
  const settings: HostSettings = {
    recording: deps.memory.isRecordingEnabled(),
    naturalEnhancement: true,
    verbosity: 'normal',
    spoilers: 'avoid',
    muteUntil: 0,
  }

  let disposed = false
  let reflex: ReactState = createReactState({ character: 'rin', locale: 'zh' })
  let lastSelection: CompanionSelection | null = null
  let lastConversationId: string | null = null
  const routeJobs = new Map<string, { controller: AbortController; done: Promise<void> }>()

  const publish = (partial: Omit<CompanionMessageEvent, 'seq' | 'at'> & { at?: number }) => {
    const event = ledger.appendEvent(partial)
    try {
      window.dispatchEvent(new CustomEvent(COMPANION_LOCAL_EVENT, { detail: event }))
    } catch {
      /* non-DOM host */
    }
    return event
  }

  const chatDeps: CompanionChatHostDeps = {
    complete: deps.complete,
    memory: deps.memory,
    ledger,
    now,
    publish,
    currentFacts: () => deps.facts.current(),
    getPreferences: () => readablePreferences(),
  }
  const chat = new CompanionChatSlot(chatDeps)

  let prefsGeneration = 0
  const readyGeneration = prefsGeneration
  void deps.memory.ready().then(() => {
    if (disposed || readyGeneration !== prefsGeneration) return
    const read = (key: string) =>
      deps.memory.getPreference(key, deps.libraryGameId, deps.libraryGameId) ??
      deps.memory.getPreference(key, undefined, deps.libraryGameId) ??
      deps.memory.getPreference(key, deps.libraryGameId)
    const natural = read('naturalEnhancement')
    const verbosity = read('verbosity')
    const spoilers = read('spoilers')
    const muteUntil = read('muteUntil')
    if (disposed || readyGeneration !== prefsGeneration) return
    settings.recording = deps.memory.isRecordingEnabled()
    if (typeof natural?.value === 'boolean') settings.naturalEnhancement = natural.value
    if (verbosity?.value === 'quiet' || verbosity?.value === 'normal' || verbosity?.value === 'chatty') settings.verbosity = verbosity.value
    if (spoilers?.value === 'avoid' || spoilers?.value === 'allow') settings.spoilers = spoilers.value
    if (typeof muteUntil?.value === 'number' && Number.isFinite(muteUntil.value)) settings.muteUntil = muteUntil.value
  })

  function readablePreferences(): UserPreference[] {
    return deps.memory.listPreferences(deps.libraryGameId).map((item) => ({
      key: item.key,
      value: item.value,
      revision: item.revision,
      updatedAt: item.updatedAt,
      scope: item.scope,
      sourceUserMessageId: item.sourceUserMessageId,
    }))
  }

  function statusOf(): CompanionHostStatus {
    const view = deps.facts.current()
    const memory = deps.memory.getStatus()
    return {
      version: COMPANION_PROTOCOL_VERSION,
      stamp: view.stamp,
      capabilities: view.capabilities,
      activeRequestId: chat.status().activeRequestId,
      memory: {
        epoch: memory.memoryEpoch,
        recording: memory.recordingEnabled,
        count: memory.episodeCount,
        persistence: memory.persistence === 'unavailable' ? 'degraded' : memory.persistence,
        error: memory.error,
        usedBytes: memory.usedBytes,
        pendingCount: memory.pendingCount,
      },
      naturalEnhancement: settings.naturalEnhancement,
      preferences: {
        verbosity: settings.verbosity,
        spoilers: settings.spoilers,
        muteUntil: settings.muteUntil,
      },
    }
  }

  function rememberSelection(selection: CompanionSelection, conversationId?: string): void {
    if (lastSelection && (lastSelection.character !== selection.character || lastSelection.locale !== selection.locale)) {
      chat.bumpGeneration(lastSelection.character !== selection.character ? 'role' : 'locale')
      void stopPrepare()
    }
    if (conversationId && lastConversationId && conversationId !== lastConversationId) chat.bumpGeneration('conversation')
    lastSelection = selection
    if (conversationId) lastConversationId = conversationId
    reflex = { ...reflex, character: selection.character, locale: selection.locale }
  }

  function queryMemory(view: FactView, enemyIds?: number[]): { episodes: MemoryEpisode[]; origin?: SpeechMemoryOrigin } {
    const detailed = deps.memory.queryDetailed(view.stamp.scope, {
      intent: 'rematch',
      enemyIds: enemyIds?.length ? enemyIds : undefined,
      limit: 3,
    })
    return { episodes: toSpeechEpisodes(detailed.episodes), origin: memoryOriginOf(detailed.origin) }
  }

  async function stopPrepare(clearCache = true): Promise<void> {
    candidates.abortPrepare()
    await candidates.waitPrepare()
    if (clearCache) candidates.clear()
  }

  function speakCue(line: string, cue: Cue, stamp: ContextStamp, consumerId?: string): void {
    publish({
      kind: 'cue',
      messageId: `cue-${cue.id}`,
      consumerId,
      stamp,
      text: line,
      cue,
    })
  }

  function handleFacts(domainEvent: CompanionDomainEvent | null, sourceEvent: SourceGameEvent | null): void {
    if (disposed) return
    const view = deps.facts.current()
    if (domainEvent?.kind === 'load' && domainEvent.phase === 'begin') {
      chat.bumpGeneration('load')
      candidates.clear()
      ledger.clearGenerationScoped()
      reflex = react({
        state: reflex,
        contextEpoch: view.stamp.contextEpoch,
        scope: view.stamp.scope,
        currentEncounterId: view.current.encounterId.value,
        visibleConsumers: ledger.visibleConsumerCount(),
        deferConsume: true,
        now: now(),
      }).state
      publish({ kind: 'context.changed', messageId: `ctx-${view.stamp.contextEpoch}`, stamp: view.stamp })
      return
    }

    const visible = ledger.visibleConsumerCount()
    const activeConsumer = ledger.activeVisibleConsumer()
    if (activeConsumer) reflex = { ...reflex, character: activeConsumer.character, locale: activeConsumer.locale }

    const kind = eventKindFromDomain(domainEvent, view)
    const enemyIds = (view.current.enemies.value ?? []).map((enemy) => enemy.enemyId)
    const needMemory = kind === 'battle_start' || kind === 'danger' || kind === 'battle_win' || kind === 'battle_loss'
    const memory = needMemory ? queryMemory(view, enemyIds) : { episodes: [] as MemoryEpisode[], origin: undefined }
    const episodes = memory.episodes
    const legalActions = view.current.legalActions.value ?? []
    const defense = false
    const disarmSkill = Object.values(view.mechanics.skills).find((skill) => skill.isDisarmable.known && skill.isDisarmable.value === true)
    const disarm = disarmSkill ? canClaimDisarmUseful(legalActions, view.mechanics, disarmSkill.skillId) : false
    const eventId = sourceEvent?.eventId || (domainEvent ? `${domainEvent.kind}-${domainEvent.at}` : `fact-${view.stamp.factsRevision}-${now()}`)
    const outcome = battleOutcomeOf(kind, domainEvent)
    const speechFacts = {
      enemyIds,
      encounterId: view.current.encounterId.value ?? undefined,
      libraryGameId: view.stamp.scope.libraryGameId,
      dataRevision: view.stamp.scope.dataRevision,
      playthroughId: view.stamp.scope.playthroughId,
      knownDefenseUseful: defense,
      knownDisarmUseful: disarm,
      hasLegalGuard: hasGuardAction(legalActions),
      origin: memory.origin,
      outcome,
    }

    const output = react({
      state: reflex,
      now: now(),
      random,
      visibleConsumers: visible,
      contextEpoch: view.stamp.contextEpoch,
      currentEncounterId: view.current.encounterId.value,
      scope: view.stamp.scope,
      recentEpisodes: episodes,
      memoryOrigin: memory.origin,
      facts: speechFacts,
      event: kind
        ? {
            eventId,
            kind,
            segmentId: view.stamp.scope.segmentId,
            contextEpoch: view.stamp.contextEpoch,
            factsRevision: view.stamp.factsRevision,
            facts: speechFacts,
            evidenceRefs: episodes.slice(0, 2).map((item) => item.episodeId),
            targetKey: kind === 'danger' ? 'party' : undefined,
          }
        : null,
    })
    reflex = output.state
    if (settings.muteUntil > now()) return
    if (settings.verbosity === 'quiet' && output.cue?.kind !== 'danger') return
    if (!output.line || !output.cue) {
      maybePrepareCandidates(view, episodes)
      return
    }

    const cue: Cue = {
      id: output.cue.id,
      eventId: output.cue.eventId,
      segmentId: output.cue.segmentId,
      priority: output.cue.priority,
      expiresAt: output.cue.expiresAt,
      evidenceRefs: output.evidenceRefs ?? output.cue.evidenceRefs,
      facts: output.cue.facts,
      kind: output.cue.kind,
    }
    let line = output.line
    if (settings.naturalEnhancement && cue.kind !== 'danger') {
      const candidate = candidates.take(cue.kind, view.stamp, reflex.character, reflex.locale)
      if (candidate) {
        line =
          renderCandidateTemplate(candidate.textTemplate, {
            enemyName: view.current.enemies.value?.[0]?.name || '',
            abilityName: episodes[0]?.evidence.find((item) => item.ability?.name)?.ability?.name || '',
            partyName: view.current.party.value?.[0]?.name || '',
            outcome: '',
          }) || line
      }
    }
    speakCue(line, cue, view.stamp, activeConsumer?.consumerId)
    maybePrepareCandidates(view, episodes)
  }

  function maybePrepareCandidates(view: FactView, episodes: MemoryEpisode[]): void {
    if (!settings.naturalEnhancement || disposed || ledger.visibleConsumerCount() <= 0) return
    const visible = ledger.primaryVisibleSelection()
    if (!lastSelection) return
    const selection = visible ? { ...lastSelection, locale: visible.locale, character: visible.character } : lastSelection
    if (!episodes.length && view.current.scene.value !== 'battle') return
    const line = candidates.waterline({
      stamp: view.stamp,
      character: selection.character,
      locale: selection.locale,
      memoryEpoch: deps.memory.getEpoch(),
      encounterId: view.current.encounterId.value,
    })
    const prepareSignal = candidates.beginPrepare(line)
    if (!prepareSignal) return
    const prepareWork = deps
      .complete(buildCandidateMessages({ stamp: view.stamp, character: selection.character, locale: selection.locale, facts: view, episodes }), {
        profileId: selection.profileId,
        model: selection.model,
        purpose: 'prepare',
        signal: prepareSignal,
        conversationKey: `companion-prepare:${selection.character}:${selection.locale}`,
        format: PREPARE_FORMAT as unknown as Record<string, unknown>,
      })
      .then((message) => {
        if (disposed || ledger.visibleConsumerCount() <= 0 || prepareSignal.aborted) {
          candidates.failPrepare(line)
          return
        }
        candidates.endPrepare(
          line,
          parseCandidatePayload(message.content, {
            stamp: view.stamp,
            character: selection.character,
            locale: selection.locale,
            facts: view,
            episodes,
          })
        )
      })
      .catch(() => candidates.failPrepare(line))
    candidates.trackPrepare(prepareWork.then(() => undefined))
  }

  const unsubscribe = deps.facts.subscribe((domainEvent, sourceEvent) => handleFacts(domainEvent ?? null, sourceEvent ?? null))

  async function routeMessage(message: Extract<CompanionHostRequest, { type: 'agent.companion.route' }>, signal?: AbortSignal): Promise<CompanionRouteResult> {
    const selection = selectionOf(message)!
    rememberSelection(selection, message.conversationId)
    const stamp = deps.facts.current().stamp
    const prompt = message.prompt.trim()
    if (!prompt) return { kind: 'clarification', text: '我还没确定你的意思，请说明是想聊聊，还是让我操作游戏。', stamp }
    const controller = new AbortController()
    if (signal?.aborted) controller.abort(signal.reason)
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    let settleRoute!: () => void
    const routeDone = new Promise<void>((resolve) => {
      settleRoute = resolve
    })
    routeJobs.set(message.requestId, { controller, done: routeDone })
    try {
      const reply = await deps.complete(
        [
          { role: 'system', content: COMPANION_ROUTE_SYSTEM },
          { role: 'user', content: JSON.stringify({ prompt, stamp, scene: deps.facts.current().current.scene.value, locale: selection.locale }) },
        ],
        {
          profileId: selection.profileId,
          model: selection.model,
          purpose: 'route',
          signal: controller.signal,
          conversationKey: `companion-route:${selection.character}:${selection.locale}`,
          format: COMPANION_ROUTE_FORMAT as unknown as Record<string, unknown>,
        }
      )
      const decision = parseCompanionRoute(reply.content, prompt)
      if (decision.target === 'companion_chat') return { kind: 'chat', stamp }
      if (decision.target === 'clarification') return { kind: 'clarification', text: decision.question, stamp }
      const ticketId = `ticket-${message.requestId}`
      const ticket: ControlTicket = {
        ticketId,
        requestId: message.requestId,
        prompt,
        goal: decision.goal,
        action: decision.action,
        shape: decision.shape,
        lifetime: decision.lifetime,
        stamp,
        selection,
        conversationId: message.conversationId,
        expiresAt: now() + CONTROL_TICKET_TTL_MS,
        createdAt: now(),
      }
      ledger.putTicket(ticket)
      return { kind: 'control', ticketId, goal: ticket.goal, shape: ticket.shape, lifetime: ticket.lifetime, expiresAt: ticket.expiresAt, stamp }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      routeJobs.delete(message.requestId)
      settleRoute()
    }
  }

  async function startControlFromTicket(
    message: Extract<CompanionHostRequest, { type: 'agent.companion.control.start' }>,
    remote: boolean,
    signal?: AbortSignal
  ): Promise<AgentTask> {
    const stamp = deps.facts.current().stamp
    const ticket = ledger.getTicket(message.ticketId)
    if (!ticket || ticket.expiresAt <= now()) {
      ledger.takeTicket(message.ticketId)
      throw Object.assign(new Error('Control ticket missing or expired'), { code: 'STALE_CARD' })
    }
    if (ticket.stamp.contextEpoch !== stamp.contextEpoch || ticket.stamp.scope.segmentId !== stamp.scope.segmentId) {
      ledger.takeTicket(message.ticketId)
      throw Object.assign(new Error('Control ticket stamp is stale'), { code: 'STALE_CONTEXT' })
    }
    const consumed = ledger.takeTicket(message.ticketId)
    if (!consumed) throw Object.assign(new Error('Control ticket already used'), { code: 'STALE_CARD' })
    const task = await deps.startControl(
      {
        requestId: message.requestId,
        goal: consumed.goal,
        shape: consumed.shape,
        lifetime: consumed.lifetime,
        profileId: consumed.selection.profileId,
        model: consumed.selection.model,
        locale: consumed.selection.locale,
        companionCharacter: consumed.selection.character,
        conversationId: consumed.conversationId,
      },
      remote,
      signal
    )
    return task
  }

  function writePref(key: string, value: unknown) {
    prefsGeneration += 1
    deps.memory.setPreference({
      key,
      value,
      revision: now(),
      updatedAt: now(),
      scope: deps.libraryGameId,
      libraryGameId: deps.libraryGameId,
    })
  }

  async function applySettings(message: Extract<CompanionHostRequest, { type: 'agent.memory.settings' }>): Promise<CompanionHostStatus> {
    if (typeof message.recording === 'boolean') {
      await deps.memory.setRecording(message.recording)
      settings.recording = message.recording
    }
    if (typeof message.naturalEnhancement === 'boolean') {
      settings.naturalEnhancement = message.naturalEnhancement
      writePref('naturalEnhancement', message.naturalEnhancement)
    }
    const prefs = message.preferences
    if (prefs?.verbosity === 'quiet' || prefs?.verbosity === 'normal' || prefs?.verbosity === 'chatty') {
      settings.verbosity = prefs.verbosity
      writePref('verbosity', prefs.verbosity)
    }
    if (prefs?.spoilers === 'avoid' || prefs?.spoilers === 'allow') {
      settings.spoilers = prefs.spoilers
      writePref('spoilers', prefs.spoilers)
    }
    if (typeof prefs?.muteUntil === 'number' && Number.isFinite(prefs.muteUntil)) {
      settings.muteUntil = prefs.muteUntil
      writePref('muteUntil', prefs.muteUntil)
    }
    return statusOf()
  }

  async function dispatch(message: CompanionHostRequest, remote: boolean, signal?: AbortSignal): Promise<unknown> {
    if (disposed) throw Object.assign(new Error('Companion host disposed'), { code: 'CANCELLED' })
    if (!isCompanionHostRequest(message)) throw Object.assign(new Error('Invalid companion request'), { code: 'REQUEST_CONFLICT' })

    const cached = ledger.peekIdempotent(message)
    if ('conflict' in cached && cached.conflict) throw Object.assign(new Error(cached.error.message), { code: cached.error.code, retryable: false })
    if ('hit' in cached && cached.hit) {
      return 'inflight' in cached ? cached.inflight : cached.result
    }

    const run = async (): Promise<unknown> => {
      let result: unknown
      switch (message.type) {
        case 'agent.companion.status':
          result = statusOf()
          break
        case 'agent.companion.events': {
          const visible = ledger.registerConsumer({
            consumerId: message.consumerId,
            visible: message.visible,
            locale: message.locale,
            character: message.character,
          })
          reflex = react({
            state: reflex,
            visibleConsumers: visible,
            now: now(),
            deferConsume: true,
            scope: deps.facts.current().stamp.scope,
            contextEpoch: deps.facts.current().stamp.contextEpoch,
          }).state
          if (visible === 0) void stopPrepare()
          const batch = ledger.readEvents(message.afterSeq, message.consumerId, message.conversationId)
          const payload: CompanionEventBatch = { ...batch, status: statusOf() }
          result = payload
          break
        }
        case 'agent.companion.route':
          result = await routeMessage(message, signal)
          break
        case 'agent.companion.chat': {
          const selection = selectionOf(message)!
          rememberSelection(selection, message.conversationId)
          const accepted = chat.acceptChat({
            requestId: message.requestId,
            prompt: message.prompt,
            conversationId: message.conversationId,
            stamp: message.stamp,
            selection,
            signal,
          })
          if (!accepted.accepted) throw Object.assign(new Error(accepted.error.message), { code: accepted.error.code, retryable: accepted.error.retryable })
          result = { accepted: true, messageId: accepted.messageId, stamp: message.stamp }
          break
        }
        case 'agent.companion.cancel': {
          const chatCancelled = await chat.cancel(message.targetRequestId)
          const routeJob = routeJobs.get(message.targetRequestId)
          if (routeJob && !routeJob.controller.signal.aborted) routeJob.controller.abort()
          if (routeJob) await routeJob.done.catch(() => undefined)
          result = { cancelled: chatCancelled.cancelled || !!routeJob }
          break
        }
        case 'agent.companion.control.start':
          result = await startControlFromTicket(message, remote, signal)
          break
        case 'agent.memory.query': {
          const view = deps.facts.current()
          if (view.stamp.scope.libraryGameId !== deps.libraryGameId) throw Object.assign(new Error('Memory query outside host game'), { code: 'REQUEST_CONFLICT' })
          result = mapMemoryEpisodes(deps.memory.queryDetailed(view.stamp.scope, message.filter ?? { limit: 3 }))
          break
        }
        case 'agent.memory.settings':
          result = await applySettings(message)
          break
        case 'agent.memory.clear': {
          prefsGeneration += 1
          chat.bumpGeneration('clear')
          await stopPrepare()
          ledger.clearGenerationScoped()
          ledger.clearConversation()
          await deps.memory.clearMemory({ libraryGameId: deps.libraryGameId, preferences: false })
          // Keep in-memory settings; do not resurrect preferences cleared or raced from ready().
          publish({ kind: 'context.changed', messageId: `clear-${deps.memory.getEpoch()}`, stamp: deps.facts.current().stamp })
          result = statusOf()
          break
        }
        default:
          throw Object.assign(new Error('Unsupported companion request'), { code: 'CAPABILITY_UNSUPPORTED' })
      }

      if (message.type !== 'agent.companion.events' && message.type !== 'agent.companion.status') {
        ledger.rememberIdempotent(message, result)
      }
      return result
    }

    const skipLedger = message.type === 'agent.companion.events' || message.type === 'agent.companion.status'
    let resolveInflight!: (value: unknown) => void
    let rejectInflight!: (reason: unknown) => void
    const inflight = skipLedger
      ? null
      : new Promise<unknown>((resolve, reject) => {
          resolveInflight = resolve
          rejectInflight = reject
        })
    if (inflight) ledger.beginIdempotent(message, inflight)
    const pending = run().then(
      (value) => {
        if (inflight) resolveInflight(value)
        return value
      },
      (error) => {
        if (inflight) {
          ledger.failIdempotent(message)
          rejectInflight(error)
          return undefined
        }
        throw error
      }
    )
    return inflight ?? pending
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    prefsGeneration += 1
    unsubscribe()
    for (const job of routeJobs.values()) {
      if (!job.controller.signal.aborted) job.controller.abort()
    }
    chat.bumpGeneration('dispose')
    void stopPrepare()
    deps.stopExternalControl()
    void chat.waitForIdle()
  }

  return { dispatch, dispose }
}
