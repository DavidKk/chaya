/**
 * Companion T3 model-adapter contracts.
 * Named locally so T0 can evolve `lib/game-agent/companion/types.ts` without write conflicts.
 */

import type { CompanionModelStatus } from '@/lib/game-agent/companion/model-diagnostics'
import type { CompanionErrorCode } from '@/lib/game-agent/companion/types'

import type { GameAgentProfile } from './settings'
import type { GameAgentMessage } from './types'

/** Interactive chat / semantic route share foreground; managed decisions use control; prepare is background. */
export type CompanionModelPriority = 'foreground' | 'control' | 'background'

/** Host /api/game-agent/model purpose values (parent wiring). */
export type CompanionModelPurpose = 'companion-chat' | 'companion-route' | 'companion-warmup' | 'companion-prepare' | 'companion-tactic-quick' | 'companion-tactic-deep' | 'control'

export type CompanionThinkingControl =
  | { mode: 'supported'; requested: boolean; applied: boolean }
  | { mode: 'unsupported'; requested: boolean; applied: false; reason: string }
  | { mode: 'prompt_hint_only'; requested: boolean; applied: false; reason: string }

export type CompanionProviderCapabilities = {
  provider: GameAgentProfile['provider']
  resourceKey: string
  /** True only when the adapter can emit real upstream deltas (never fake-stream). */
  streaming: boolean
  /** Whether the adapter can actually disable thinking for this profile/provider. */
  thinkingControl: 'supported' | 'unsupported' | 'prompt_hint_only'
  /** Native structured/json schema support (else prompt+parse degradation). */
  structuredOutput: 'native' | 'prompt_json' | 'unsupported'
  /** AbortSignal reaches the upstream request. */
  cancellation: boolean
  /** Optional notes for UI / parent wiring. */
  notes: string[]
}

export type CompanionModelBudgets = {
  /** Total prompt budget in characters (recent chat + facts + memory). */
  contextChars: number
  maxOutputTokens: number
  /** Includes queue wait. */
  totalTimeoutMs: number
  /** Streaming only; non-stream adapters ignore this and use totalTimeoutMs. */
  firstTokenTimeoutMs?: number
}

export const COMPANION_DEFAULT_BUDGETS = {
  contextChars: 12_000,
  route: { maxOutputTokens: 128, totalTimeoutMs: 5_000 } satisfies Omit<CompanionModelBudgets, 'contextChars'>,
  chat: { maxOutputTokens: 256, totalTimeoutMs: 15_000, firstTokenTimeoutMs: 5_000 } satisfies Omit<CompanionModelBudgets, 'contextChars'>,
  prepare: { maxOutputTokens: 384, totalTimeoutMs: 10_000 } satisfies Omit<CompanionModelBudgets, 'contextChars'>,
  tacticQuick: { maxOutputTokens: 768, totalTimeoutMs: 6_000 } satisfies Omit<CompanionModelBudgets, 'contextChars'>,
  tacticDeep: { maxOutputTokens: 768, totalTimeoutMs: 25_000 } satisfies Omit<CompanionModelBudgets, 'contextChars'>,
} as const

export const COMPANION_RESOURCE_LIMITS = {
  /** Pending items per resourceKey (not including the running slot). */
  maxQueued: 16,
  /** At most one background item may sit in that queue. */
  maxBackgroundQueued: 1,
  /** Default concurrent upstream calls per resourceKey. */
  defaultCapacity: 1,
} as const

export type CompanionModelError = {
  code: Extract<CompanionErrorCode, 'MODEL_BUSY' | 'MODEL_UNAVAILABLE' | 'MODEL_TIMEOUT' | 'CAPABILITY_UNSUPPORTED' | 'CANCELLED' | 'REQUEST_CONFLICT'>
  message: string
  retryable: boolean
  requestId?: string
  resourceKey?: string
}

export class CompanionModelFailure extends Error {
  readonly error: CompanionModelError
  constructor(error: CompanionModelError) {
    super(error.message)
    this.name = 'CompanionModelFailure'
    this.error = error
  }
}

export type CompanionChatMessage = Pick<GameAgentMessage, 'role' | 'content'> & { role: 'system' | 'user' | 'assistant' }

export type CompanionModelRequestBase = {
  requestId: string
  profile: GameAgentProfile
  model: string
  /** Purpose drives default priority, budgets, and CLI session isolation tag. */
  purpose: CompanionModelPurpose
  priority?: CompanionModelPriority
  messages: CompanionChatMessage[]
  /** Prefer thinking off for short companion turns when the provider can honor it. */
  disableThinking?: boolean
  budgets?: Partial<CompanionModelBudgets>
  signal?: AbortSignal
  /** Optional JSON schema for native structured providers (Ollama `format`). */
  responseSchema?: Record<string, unknown>
  temperature?: number
}

export type CompanionGenerationMode = 'streaming' | 'whole'

export type CompanionModelEvent =
  | {
      type: 'accepted'
      requestId: string
      resourceKey: string
      capabilities: CompanionProviderCapabilities
      conversationKey?: string
    }
  | { type: 'queued'; requestId: string; resourceKey: string; position: number; priority: CompanionModelPriority }
  | {
      type: 'started'
      requestId: string
      resourceKey: string
      mode: CompanionGenerationMode
      thinking: CompanionThinkingControl
      waitedMs: number
    }
  | { type: 'delta'; requestId: string; seq: number; text: string }
  | ({ type: 'model.status'; requestId: string } & CompanionModelStatus)
  | {
      type: 'completed'
      requestId: string
      mode: CompanionGenerationMode
      text: string
      thought?: string
      usage?: GameAgentMessage['usage']
      timing?: GameAgentMessage['timing']
      durationMs: number
      firstTokenMs?: number
      contextMs?: number
      waitedMs?: number
      generationMs?: number
      startupMs?: number
      startupLoadMs?: number
      residency?: CompanionModelStatus['residency']
      loadMs?: number
      thinking: CompanionThinkingControl
    }
  | { type: 'cancelled'; requestId: string; partialText?: string; cancelConfirmed: boolean }
  | { type: 'failed'; requestId: string; error: CompanionModelError; partialText?: string }

export type CompanionRouteKind = 'chat' | 'control' | 'clarification'

export type CompanionRouteDecision =
  | { kind: 'chat'; prompt: string }
  | {
      kind: 'control'
      goal: string
      action: string
      shape: 'single' | 'batch' | 'open'
      lifetime: 'goal' | 'until_stopped'
    }
  | { kind: 'clarification'; question: string }

export type CompanionRouteRequest = {
  requestId: string
  profile: GameAgentProfile
  model: string
  /** Player free text. */
  text: string
  /** Compact trusted context JSON/string (facts / nearby events); truncated by budgets. */
  context?: string
  signal?: AbortSignal
  budgets?: Partial<CompanionModelBudgets>
  disableThinking?: boolean
  onEvent?: (event: CompanionModelEvent) => void
}

export type CompanionRouteResult = {
  requestId: string
  decision: CompanionRouteDecision
  rawText: string
  structured: boolean
  capabilities: CompanionProviderCapabilities
  thinking: CompanionThinkingControl
  durationMs: number
  waitedMs: number
}

export type CompanionChatRequest = CompanionModelRequestBase & {
  purpose?: 'companion-chat'
  onEvent?: (event: CompanionModelEvent) => void
}

export type CompanionChatResult = {
  requestId: string
  text: string
  thought?: string
  mode: CompanionGenerationMode
  capabilities: CompanionProviderCapabilities
  thinking: CompanionThinkingControl
  usage?: GameAgentMessage['usage']
  timing?: GameAgentMessage['timing']
  durationMs: number
  firstTokenMs?: number
  waitedMs: number
}

export type CompanionPrepareRequest = CompanionModelRequestBase & {
  purpose?: 'companion-prepare'
  onEvent?: (event: CompanionModelEvent) => void
}
