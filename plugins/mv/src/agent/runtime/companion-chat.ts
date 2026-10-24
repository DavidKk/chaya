/**
 * Independent companion chat slot: one tool-free generation, real deltas,
 * cancel waits for model exit, generation identity for role/locale/conversation (T5).
 */

import {
  buildAdviceContext,
  canClaimDisarmUseful,
  conditionalDefenseText,
  conditionalDisarmText,
  episodeEvidenceSummary,
  hasGuardAction,
  looksLikeStructuredPayload,
  plainTextLooksGrounded,
  renderValidatedChatText,
  validateStructuredChatOutput,
} from '@/lib/game-agent/companion/advice'
import { toLegacyEpisodes } from '@/lib/game-agent/companion/memory-reduce'
import type { GameplayMemoryStore } from '@/lib/game-agent/companion/memory-store'
import type { ContextStamp, FactView, MemoryEpisode, UserPreference } from '@/lib/game-agent/companion/types'
import type { AgentTask, RuntimeMessage } from '@/lib/game-agent/runtime'
import type { CompanionMessageEvent, CompanionSelection } from '@/lib/runtime/companion-protocol'

import { companionError, type CompanionRequestLedger } from './companion-requests'

export type CompanionComplete = (
  messages: RuntimeMessage[],
  options: {
    profileId: string
    model: string
    purpose: 'chat' | 'route' | 'prepare'
    signal: AbortSignal
    onDelta?: (text: string) => void
    onQueued?: () => void
    conversationKey?: string
    format?: Record<string, unknown>
  }
) => Promise<RuntimeMessage>

export type ChatSlotStatus = {
  activeRequestId: string | null
  generation: number
}

type ActiveChat = {
  requestId: string
  messageId: string
  conversationId: string
  selection: CompanionSelection
  stamp: ContextStamp
  controller: AbortController
  generation: number
  startedAt: number
  done: Promise<void>
}

export type CompanionChatHostDeps = {
  complete: CompanionComplete
  memory: GameplayMemoryStore
  ledger: CompanionRequestLedger
  now?: () => number
  publish: (event: Omit<CompanionMessageEvent, 'seq' | 'at'> & { at?: number }) => CompanionMessageEvent
  currentFacts: () => FactView
  getPreferences: () => UserPreference[]
}

function conversationKeyOf(selection: CompanionSelection, conversationId: string): string {
  return `companion:${selection.character}:${selection.locale}:${conversationId}`
}

function buildChatMessages(input: {
  prompt: string
  selection: CompanionSelection
  facts: FactView
  episodes: MemoryEpisode[]
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  preferences: UserPreference[]
}): RuntimeMessage[] {
  const advice = buildAdviceContext({ facts: input.facts, episodes: input.episodes })
  const guardAvailable = hasGuardAction(advice.legalActions)
  const disarmSkill = Object.values(advice.knownMechanics.skills).find((skill) => skill.isDisarmable.known && skill.isDisarmable.value === true)
  const disarm = disarmSkill ? canClaimDisarmUseful(advice.legalActions, advice.knownMechanics, disarmSkill.skillId) : false
  return [
    {
      role: 'system',
      content: [
        `You are ${input.selection.character}, a game companion. Locale=${input.selection.locale}.`,
        'One short reply. No tools. Do not invent mechanics.',
        'If citing memory or skills, return ONE JSON object {"text","blocks":[...]} and nothing else. Do not stream partial JSON.',
        'evidence_ref.episodeId must exist below; skill_advice.skillId must be legal now.',
        'Never claim disarm or shielding will work. Use conditional wording only.',
        `guardAvailable=${guardAvailable}; disarmKnownUseful=${disarm}.`,
        guardAvailable ? conditionalDefenseText(input.selection.locale) : '',
        disarm ? conditionalDisarmText(input.selection.locale) : '',
        'Pure social chat may be plain text without JSON. Mentions of memories/skills require JSON blocks.',
      ]
        .filter(Boolean)
        .join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt: input.prompt,
        preferences: input.preferences.slice(0, 8),
        stamp: input.facts.stamp,
        scene: input.facts.current.scene.value,
        party: (input.facts.current.party.value ?? []).slice(0, 4).map((member) => ({
          id: member.actorId,
          name: member.name,
          hp: member.hp,
          hpMax: member.hpMax,
        })),
        enemies: (input.facts.current.enemies.value ?? []).slice(0, 4).map((enemy) => ({
          id: enemy.enemyId,
          name: enemy.name,
          instance: enemy.instanceId,
        })),
        legalActions: (input.facts.current.legalActions.value ?? []).slice(0, 12).map((action) => ({
          kind: action.kind,
          id: action.id,
          name: action.name,
        })),
        episodes: input.episodes.slice(0, 3).map((episode) => ({
          episodeId: episode.episodeId,
          kind: episode.kind,
          summary: episode.summary.slice(0, 180),
          completeness: episode.completeness,
          evidence: episode.evidence.slice(0, 3).map((item) => ({
            actionId: item.actionId,
            ability: item.ability,
            source: item.source,
            target: item.target,
          })),
        })),
        recentHistory: input.history.slice(-8),
        gaps: advice.knownGaps.slice(0, 8),
      }),
    },
  ]
}

export class CompanionChatSlot {
  private active: ActiveChat | null = null
  private generation = 1
  private readonly now: () => number

  constructor(private readonly deps: CompanionChatHostDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  status(): ChatSlotStatus {
    return { activeRequestId: this.active?.requestId ?? null, generation: this.generation }
  }

  bumpGeneration(reason: 'role' | 'locale' | 'conversation' | 'load' | 'clear' | 'dispose'): void {
    this.generation += 1
    if (this.active && !this.active.controller.signal.aborted) {
      const current = this.active
      const error = companionError('CANCELLED', `Chat cancelled: ${reason}`, { retryable: false, requestId: current.requestId })
      current.controller.abort(error)
      this.deps.publish({
        kind: 'cancelled',
        requestId: current.requestId,
        messageId: current.messageId,
        conversationId: current.conversationId,
        stamp: current.stamp,
        error,
      })
    }
  }

  async cancel(targetRequestId: string): Promise<{ cancelled: boolean }> {
    if (!this.active || this.active.requestId !== targetRequestId) return { cancelled: false }
    const current = this.active
    current.controller.abort(companionError('CANCELLED', 'Chat cancelled by user', { retryable: false, requestId: targetRequestId }))
    await current.done.catch(() => undefined)
    return { cancelled: true }
  }

  async waitForIdle(): Promise<void> {
    const current = this.active
    if (current) await current.done.catch(() => undefined)
  }

  acceptChat(input: {
    requestId: string
    prompt: string
    conversationId: string
    stamp: ContextStamp
    selection: CompanionSelection
    signal?: AbortSignal
  }): { accepted: true; messageId: string } | { accepted: false; error: ReturnType<typeof companionError> } {
    if (this.active) {
      return {
        accepted: false,
        error: companionError('MODEL_BUSY', 'Companion chat slot is busy', {
          retryable: true,
          requestId: input.requestId,
          currentStamp: this.deps.currentFacts().stamp,
        }),
      }
    }

    const facts = this.deps.currentFacts()
    if (input.stamp.contextEpoch !== facts.stamp.contextEpoch || input.stamp.scope.segmentId !== facts.stamp.scope.segmentId) {
      return {
        accepted: false,
        error: companionError('STALE_CONTEXT', 'Chat stamp is stale', {
          retryable: true,
          requestId: input.requestId,
          currentStamp: facts.stamp,
        }),
      }
    }

    const messageId = `msg-${input.requestId}`
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(input.signal?.reason)
    if (input.signal?.aborted) controller.abort(input.signal.reason)
    else input.signal?.addEventListener('abort', forwardAbort, { once: true })
    const generation = this.generation
    let resolveDone!: () => void
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    this.active = {
      requestId: input.requestId,
      messageId,
      conversationId: input.conversationId,
      selection: input.selection,
      stamp: input.stamp,
      controller,
      generation,
      startedAt: this.now(),
      done,
    }

    this.deps.publish({
      kind: 'accepted',
      requestId: input.requestId,
      messageId,
      conversationId: input.conversationId,
      stamp: input.stamp,
    })

    this.deps.ledger.appendChat(input.conversationId, {
      role: 'user',
      content: input.prompt,
      at: this.now(),
    })

    void this.run(input, messageId, controller, generation).finally(() => {
      input.signal?.removeEventListener('abort', forwardAbort)
      if (this.active?.requestId === input.requestId) this.active = null
      resolveDone()
    })

    return { accepted: true, messageId }
  }

  private async run(
    input: {
      requestId: string
      prompt: string
      conversationId: string
      stamp: ContextStamp
      selection: CompanionSelection
    },
    messageId: string,
    controller: AbortController,
    generation: number
  ): Promise<void> {
    const publish = (kind: CompanionMessageEvent['kind'], extra?: Partial<CompanionMessageEvent>) =>
      this.deps.publish({
        kind,
        requestId: input.requestId,
        messageId,
        conversationId: input.conversationId,
        stamp: input.stamp,
        ...extra,
      })

    try {
      const facts = this.deps.currentFacts()
      const enemyIds = (facts.current.enemies.value ?? []).map((enemy) => enemy.enemyId)
      const episodes = toLegacyEpisodes(
        this.deps.memory.queryDetailed(facts.stamp.scope, {
          intent: enemyIds.length ? 'rematch' : 'recent_death',
          enemyIds: enemyIds.length ? enemyIds : undefined,
          limit: 3,
        }).episodes
      )
      const history = this.deps.ledger.recentChat(input.conversationId).map((turn) => ({ role: turn.role, content: turn.content }))
      const messages = buildChatMessages({
        prompt: input.prompt,
        selection: input.selection,
        facts,
        episodes,
        history,
        preferences: this.deps.getPreferences(),
      })

      let streamed = ''
      let mode: 'unknown' | 'plain' | 'structured' = 'unknown'
      let plainPublished = ''
      const message = await this.deps.complete(messages, {
        profileId: input.selection.profileId,
        model: input.selection.model,
        purpose: 'chat',
        signal: controller.signal,
        conversationKey: conversationKeyOf(input.selection, input.conversationId),
        // Do not force JSON format for every turn; grounded replies self-describe as JSON.
        onDelta: (chunk) => {
          if (generation !== this.generation || !chunk) return
          streamed += chunk
          const trimmed = streamed.trimStart()
          if (mode === 'unknown') {
            if (!trimmed) return
            mode = looksLikeStructuredPayload(trimmed) ? 'structured' : 'plain'
          }
          if (mode === 'structured') return
          if (plainTextLooksGrounded(streamed) || looksLikeStructuredPayload(streamed)) {
            mode = 'structured'
            return
          }
          plainPublished += chunk
          publish('delta', { text: chunk })
        },
        onQueued: () => {
          if (generation !== this.generation) return
          publish('queued')
        },
      })

      if (generation !== this.generation) {
        return
      }

      const advice = buildAdviceContext({ facts: this.deps.currentFacts(), episodes })
      const raw = (message.content || streamed).trim()
      if (mode === 'unknown') {
        mode = looksLikeStructuredPayload(raw) || plainTextLooksGrounded(raw) ? 'structured' : 'plain'
      }
      let text: string
      if (mode === 'plain' && !plainTextLooksGrounded(raw) && !looksLikeStructuredPayload(raw)) {
        text = raw.slice(0, 1_200) || plainPublished
      } else {
        const validated = validateStructuredChatOutput(raw, advice, input.selection.locale)
        text = renderValidatedChatText(validated) || episodeEvidenceSummary(episodes, input.selection.locale)
        if (!plainPublished) publish('delta', { text })
      }

      this.deps.ledger.appendChat(input.conversationId, { role: 'assistant', content: text, at: this.now() })
      publish('completed', { text })
    } catch (error) {
      if (generation !== this.generation) return
      const aborted = controller.signal.aborted
      if (aborted) {
        publish('cancelled', {
          error: companionError('CANCELLED', 'Chat cancelled', { requestId: input.requestId, currentStamp: this.deps.currentFacts().stamp }),
        })
        return
      }
      const failure = error as { code?: string; retryable?: boolean; name?: string; message?: string }
      const code =
        failure?.code === 'MODEL_BUSY'
          ? 'MODEL_BUSY'
          : failure?.code === 'CAPABILITY_UNSUPPORTED'
            ? 'CAPABILITY_UNSUPPORTED'
            : failure?.code === 'MODEL_TIMEOUT' || failure?.name === 'TimeoutError'
              ? 'MODEL_TIMEOUT'
              : 'MODEL_UNAVAILABLE'
      publish('failed', {
        error: companionError(code, error instanceof Error ? error.message : String(error), {
          retryable: failure?.retryable ?? code !== 'CAPABILITY_UNSUPPORTED',
          requestId: input.requestId,
          currentStamp: this.deps.currentFacts().stamp,
        }),
      })
    }
  }
}

export type CompanionControlStart = (
  input: {
    requestId: string
    goal: string
    shape: 'single' | 'batch' | 'open'
    lifetime: 'goal' | 'until_stopped'
    profileId: string
    model: string
    locale: string
    companionCharacter: string
    conversationId: string
  },
  remote: boolean,
  signal?: AbortSignal
) => Promise<AgentTask>
