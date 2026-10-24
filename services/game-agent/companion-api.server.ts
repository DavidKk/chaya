/**
 * Stable T3 exports for parent host / `/api/game-agent/companion-model` wiring.
 *
 * Example — companion chat (Ollama may stream via onDelta; others complete whole):
 * ```ts
 * import { completeCompanionModel, getCompanionModelCapabilities } from '@/services/game-agent/companion-api.server'
 *
 * const caps = getCompanionModelCapabilities(profile, model)
 * const message = await completeCompanionModel(profile, {
 *   model,
 *   messages: [{ role: 'system', content: '...' }, { role: 'user', content: prompt }],
 *   think: false,
 *   signal,
 *   purpose: 'companion-chat',
 *   requestId,
 *   conversationKey: `companion:${gameId}:${conversationId}`,
 *   onDelta: caps.streaming ? (text) => pushDelta(text) : undefined,
 * })
 * ```
 *
 * Example — semantic route (reuses `lib/game-agent/companion/router` prompt/schema/parse):
 * ```ts
 * const routed = await runCompanionRoute(profile, { requestId, model, text: prompt, context, signal })
 * // routed.decision.kind: chat | control | clarification
 * ```
 *
 * Example — managed/control sharing the same queue:
 * ```ts
 * await completeAgentModel(profile, { model, messages, tools, signal, requestId })
 * // priority=control via shared scheduleCompanionResource; do not nest inside an owned slot
 * ```
 *
 * Limits / honesty:
 * - No tools on companion path.
 * - Queue: 16 pending / resourceKey, ≤1 background; default capacity 1; totalTimeout includes queue wait.
 * - Slot releases only after upstream settles (cancel confirmed); parent abort listeners are removed on settle.
 * - Idle lanes reaped after 10m; at most 64 lanes retained.
 * - resourceKey: local CLI + local Ollama → `local-inference`; remote Ollama by host; OpenAPI by host (not model/profile).
 * - Streaming=true only for Ollama today; never fake-stream whole replies.
 * - thinkingControl: supported | prompt_hint_only | unsupported (declared, never over-claimed).
 * - Budgets default: route 5s/128tok, chat 15s (first 5s from send)/256tok, prepare 10s/384tok.
 * - conversationKey is host tracing / logical session id. Existing `completeWithCli` still opens a fresh tool-less
 *   once-style round and does not accept conversationKey into the CLI session API; T3 records it on events only.
 */

export { inspectCompanionCapabilities, resolveCompanionThinking } from './companion-capabilities.server'
export type { CompleteCompanionModelInput } from './companion-model.server'
export { completeCompanionModel, getCompanionModelCapabilities, runCompanionChat, runCompanionRoute } from './companion-model.server'
export { companionResourceKey, peekCompanionResource, scheduleCompanionResource } from './companion-resource.server'
export type {
  CompanionChatRequest,
  CompanionChatResult,
  CompanionGenerationMode,
  CompanionModelBudgets,
  CompanionModelEvent,
  CompanionModelPriority,
  CompanionModelPurpose,
  CompanionPrepareRequest,
  CompanionProviderCapabilities,
  CompanionRouteDecision,
  CompanionRouteRequest,
  CompanionRouteResult,
  CompanionThinkingControl,
} from './companion-types.server'
export { COMPANION_DEFAULT_BUDGETS, COMPANION_RESOURCE_LIMITS, CompanionModelFailure } from './companion-types.server'
