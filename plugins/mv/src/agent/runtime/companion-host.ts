/**
 * Companion host orchestration (T5). Parent wires createCompanionHost into the game host.
 */

import type { SourceGameEvent } from '@/lib/game-agent/audit'
import { canClaimDisarmUseful, hasGuardAction } from '@/lib/game-agent/companion/advice'
import type { GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import { createReactState, react, type ReactState } from '@/lib/game-agent/companion/reflex-engine'
import { COMPANION_ROUTE_FORMAT, COMPANION_ROUTE_SYSTEM, parseCompanionRoute } from '@/lib/game-agent/companion/router'
import type { SpeechMemoryOrigin } from '@/lib/game-agent/companion/speech-lines'
import type { CompanionDomainEvent, ContextStamp, Cue, FactView, MemoryEpisode, UserPreference } from '@/lib/game-agent/companion/types'
import type { AgentTask } from '@/lib/game-agent/runtime'
import {
  COMPANION_LOCAL_EVENT,
  COMPANION_PROTOCOL_VERSION,
  type CompanionEventBatch,
  type CompanionHostRequest,
  type CompanionHostStatus,
  type CompanionMessageEvent,
  type CompanionRouteResult,
  type CompanionSelection,
} from '@/lib/runtime/companion-protocol'
import { isCompanionHostRequest } from '@/lib/runtime/companion-validation'

import { buildCandidateMessages, CompanionCandidateCache, parseCandidatePayload, PREPARE_FORMAT, renderCandidateTemplate } from './companion-candidates'
import { type CompanionChatHostDeps, CompanionChatSlot, type CompanionComplete, type CompanionControlStart } from './companion-chat'
import { BATTLE_INTENT_FORMAT, BATTLE_INTENT_SYSTEM, type BattleIntentReceipt } from './companion-core/battle-intents'
import { isStoryCustodyRequest } from './companion-core/story-guidance'
import type { CompanionStoryRuntime } from './companion-core/story-runtime'
import { CompanionRequestLedger, CONTROL_TICKET_TTL_MS, type ControlTicket } from './companion-requests'
import { battleOutcomeOf, eventKindFromDomain, mapMemoryEpisodes, memoryOriginOf, toSpeechEpisodes } from './companion-speech-context'

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
  onMemoryChanged?: () => Promise<void>
  getBattleContext?: () => unknown
  beginBattleIntent?: (sourceId: string, prompt: string) => BattleIntentReceipt | null
  getCustodyRuntime?: () => CompanionStoryRuntime | null
  now?: () => number
  random?: () => number
}

export type CompanionHost = {
  dispatch(message: CompanionHostRequest, remote: boolean, signal?: AbortSignal): Promise<unknown>
  dispose(): void
  invalidateControl(): void
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
  let routeGeneration = 0
  function invalidateRoutes(): void {
    routeGeneration += 1
    for (const job of routeJobs.values()) job.controller.abort()
    ledger.clearGenerationScoped()
  }

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
    getBattleContext: deps.getBattleContext,
    getCustodyContext: () => {
      const runtime = deps.getCustodyRuntime?.()
      return runtime && runtime.isActive() ? runtime.getChatContext() : null
    },
  }
  const chat = new CompanionChatSlot(chatDeps)
  let memoryVersion = `${deps.memory.getEpoch()}:${deps.memory.getRecordingRevision()}`
  function refreshMemoryContext(): void {
    const current = `${deps.memory.getEpoch()}:${deps.memory.getRecordingRevision()}`
    if (memoryVersion === current) return
    memoryVersion = current
    invalidateRoutes()
    chat.bumpGeneration('clear')
    ledger.clearConversation()
    void stopPrepare()
  }

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
    const changed = lastSelection && JSON.stringify(lastSelection) !== JSON.stringify(selection)
    const newConversation = conversationId && lastConversationId && conversationId !== lastConversationId
    if (changed || newConversation) {
      const modelChanged = lastSelection && (lastSelection.model !== selection.model || lastSelection.profileId !== selection.profileId)
      chat.bumpGeneration(newConversation ? 'conversation' : modelChanged ? 'model' : lastSelection?.character !== selection.character ? 'role' : 'locale')
      invalidateRoutes()
      void stopPrepare()
    }
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
    refreshMemoryContext()
    const view = deps.facts.current()
    if (domainEvent?.kind === 'load' && domainEvent.phase === 'begin') {
      invalidateRoutes()
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
        conversationKey: JSON.stringify(['prepare', view.stamp.scope.runtimeInstanceId, selection.profileId, selection.model, selection.character, selection.locale]),
        format: PREPARE_FORMAT as unknown as Record<string, unknown>,
      })
      .then((message) => {
        refreshMemoryContext()
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
    // A newer routing request supersedes any unconsumed control authorization.
    invalidateRoutes()
    const generation = routeGeneration
    const stamp = deps.facts.current().stamp
    const prompt = message.prompt.trim()
    if (!prompt) return { kind: 'clarification', text: '我还没确定你的意思，请说明是想聊聊，还是让我操作游戏。', stamp }

    const custody = deps.getCustodyRuntime?.()
    if (custody && custody.isActive()) {
      if (/^(停止|取消|关掉|退出|暂停|不要|别再?)\s*(托管|全托管|自律推进|剧情推进|代打)/i.test(prompt)) {
        deps.stopExternalControl?.()
        return { kind: 'clarification', text: '好的，已为你停止托管。随时可以让我继续或聊聊天！', stamp }
      }
      custody.applyPlayerGuidance(prompt)
      return { kind: 'chat', stamp }
    }

    if (/^(停止|取消|关掉|退出|暂停|不要|别再?)\s*(托管|全托管|自律推进|剧情推进|代打)/i.test(prompt)) {
      deps.stopExternalControl?.()
      return { kind: 'clarification', text: '当前没有在托管中哦。有什么想聊的或者需要我帮忙的吗？', stamp }
    }

    if (isStoryCustodyRequest(prompt)) {
      const ticketId = `ticket-${message.requestId}`
      const ticket: ControlTicket = {
        ticketId,
        requestId: message.requestId,
        prompt,
        goal: prompt,
        action: 'custody',
        shape: 'open',
        lifetime: 'until_stopped',
        stamp,
        selection,
        conversationId: message.conversationId,
        expiresAt: now() + CONTROL_TICKET_TTL_MS,
        createdAt: now(),
      }
      ledger.putTicket(ticket)
      return { kind: 'control', ticketId, goal: ticket.goal, shape: ticket.shape, lifetime: ticket.lifetime, expiresAt: ticket.expiresAt, stamp }
    }
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
      const onModelStatus: NonNullable<Parameters<CompanionComplete>[1]['onModelStatus']> = (modelStatus) => {
        if (disposed || generation !== routeGeneration || controller.signal.aborted) return
        publish({ kind: 'model.status', requestId: message.requestId, messageId: `route-${message.requestId}`, conversationId: message.conversationId, stamp, modelStatus })
      }
      if (deps.complete.ensureReady) {
        await deps.complete.ensureReady({
          profileId: selection.profileId,
          model: selection.model,
          signal: controller.signal,
          onModelStatus,
          conversationKey: JSON.stringify(['warmup', stamp.scope.runtimeInstanceId, message.conversationId]),
        })
      }
      controller.signal.throwIfAborted()
      const readyStamp = deps.facts.current().stamp
      if (disposed || generation !== routeGeneration || readyStamp.contextEpoch !== stamp.contextEpoch || JSON.stringify(readyStamp.scope) !== JSON.stringify(stamp.scope)) {
        throw Object.assign(new Error('Routing context changed during model loading'), { code: 'STALE_CONTEXT' })
      }
      const battleIntent = deps.beginBattleIntent?.(message.requestId, prompt)
      const format = battleIntent
        ? {
            ...COMPANION_ROUTE_FORMAT,
            properties: { ...COMPANION_ROUTE_FORMAT.properties, battleIntent: BATTLE_INTENT_FORMAT },
            required: [...COMPANION_ROUTE_FORMAT.required, 'battleIntent'],
          }
        : COMPANION_ROUTE_FORMAT
      const reply = await deps.complete(
        [
          { role: 'system', content: [COMPANION_ROUTE_SYSTEM, battleIntent ? BATTLE_INTENT_SYSTEM : ''].join('\n') },
          {
            role: 'user',
            content: JSON.stringify({ prompt, stamp, scene: deps.facts.current().current.scene.value, locale: selection.locale, battleIntentContext: battleIntent?.context }),
          },
        ],
        {
          profileId: selection.profileId,
          model: selection.model,
          purpose: 'route',
          signal: controller.signal,
          onModelStatus,
          conversationKey: JSON.stringify([
            'route',
            stamp.scope.runtimeInstanceId,
            selection.profileId,
            selection.model,
            selection.character,
            selection.locale,
            message.conversationId,
          ]),
          format: format as unknown as Record<string, unknown>,
        }
      )
      refreshMemoryContext()
      controller.signal.throwIfAborted()
      const current = deps.facts.current().stamp
      if (disposed || generation !== routeGeneration || current.contextEpoch !== stamp.contextEpoch || JSON.stringify(current.scope) !== JSON.stringify(stamp.scope)) {
        throw Object.assign(new Error('Routing context changed'), { code: 'STALE_CONTEXT' })
      }
      const decision = parseCompanionRoute(reply.content, prompt)
      if (battleIntent) {
        let candidate: unknown
        try {
          candidate = JSON.parse(
            reply.content
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/, '')
          ).battleIntent
        } catch {
          /* Invalid output asks for clarification. */
        }
        const result = battleIntent.accept(candidate)
        if (result === 'stale') throw Object.assign(new Error('Battle intent expired'), { code: 'STALE_CONTEXT' })
        if (result === 'clarify') return { kind: 'clarification', text: '这项战斗要求暂时无法准确应用，请明确技能、敌人或保留的 MP 数量。', stamp }
        if (result === 'applied') return { kind: 'clarification', text: '已更新当前战斗约束，接下来的行动会按新要求执行。', stamp }
      }
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
    if (ticket.stamp.contextEpoch !== stamp.contextEpoch || JSON.stringify(ticket.stamp.scope) !== JSON.stringify(stamp.scope)) {
      ledger.takeTicket(message.ticketId)
      throw Object.assign(new Error('Control ticket stamp is stale'), { code: 'STALE_CONTEXT' })
    }
    const consumed = ledger.takeTicket(message.ticketId)
    if (!consumed) throw Object.assign(new Error('Control ticket already used'), { code: 'STALE_CARD' })
    const task = await deps.startControl(
      {
        requestId: message.requestId,
        goal: consumed.goal,
        action: consumed.action,
        shape: consumed.shape,
        lifetime: consumed.lifetime,
        profileId: consumed.selection.profileId,
        model: consumed.selection.model,
        locale: consumed.selection.locale,
        companionCharacter: consumed.selection.character,
        conversationId: consumed.conversationId,
      },
      false,
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
      await deps.onMemoryChanged?.()
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
    refreshMemoryContext()

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
          invalidateRoutes()
          prefsGeneration += 1
          chat.bumpGeneration('clear')
          await stopPrepare()
          ledger.clearGenerationScoped()
          ledger.clearConversation()
          await deps.memory.clearMemory({ libraryGameId: deps.libraryGameId, preferences: false })
          await deps.onMemoryChanged?.()
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
    invalidateRoutes()
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

  return { dispatch, dispose, invalidateControl: invalidateRoutes }
}
