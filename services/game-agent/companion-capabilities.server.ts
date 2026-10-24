import { isCliProvider, isOpenApiProvider } from '@/lib/game-agent/providers'

import { companionResourceKey } from './companion-resource.server'
import type { CompanionProviderCapabilities, CompanionThinkingControl } from './companion-types.server'
import type { GameAgentProfile } from './settings'

/** Honest capability table for companion short generation. Never claim streaming/thinking control we cannot enforce. */
export function inspectCompanionCapabilities(profile: GameAgentProfile, model?: string): CompanionProviderCapabilities {
  const resourceKey = companionResourceKey(profile, model)
  if (profile.provider === 'ollama') {
    return {
      provider: profile.provider,
      resourceKey,
      streaming: true,
      thinkingControl: 'supported',
      structuredOutput: 'native',
      cancellation: true,
      notes: [
        'Ollama NDJSON chat streaming is the accepted real-delta path.',
        'thinking=false is sent to Ollama; a rejected parameter fails the request instead of silently enabling reasoning.',
        'responseSchema maps to Ollama `format`.',
      ],
    }
  }
  if (isCliProvider(profile.provider)) {
    return {
      provider: profile.provider,
      resourceKey,
      streaming: false,
      thinkingControl: 'unsupported',
      structuredOutput: 'prompt_json',
      cancellation: true,
      notes: [
        'CLI adapters return a whole reply; UI must show waiting then completed (no fake deltas).',
        'Thinking cannot be forcibly disabled for CLI providers in this adapter.',
        'Each companion purpose uses an isolated once-style completion; do not reuse tool-bearing companion CLI sessions.',
        'CLI output token limits are prompt hints only; request deadlines and returned-content validation still apply.',
      ],
    }
  }
  if (profile.provider === 'cc') {
    // Native Anthropic host is whole-response today; OpenAI-compatible gateways share the OpenAPI path.
    const nativeAnthropic = (() => {
      try {
        return new URL(profile.endpoint).hostname === 'api.anthropic.com'
      } catch {
        return false
      }
    })()
    return {
      provider: profile.provider,
      resourceKey,
      streaming: false,
      thinkingControl: nativeAnthropic ? 'unsupported' : 'prompt_hint_only',
      structuredOutput: 'prompt_json',
      cancellation: true,
      notes: nativeAnthropic
        ? ['Anthropic Messages API path is whole-response; no thinking-off switch is applied.']
        : ['OpenAI-compatible Claude gateway is whole-response; only a /no_think prompt hint may be added.'],
    }
  }
  if (profile.provider === 'gemini-api') {
    const openAiCompat = /\/openai\/?$/i.test(profile.endpoint.replace(/\/+$/, ''))
    return {
      provider: profile.provider,
      resourceKey,
      streaming: false,
      thinkingControl: openAiCompat ? 'prompt_hint_only' : 'unsupported',
      structuredOutput: 'prompt_json',
      cancellation: true,
      notes: [
        'Gemini companion path is whole-response in T3 (existing client has no stream helper).',
        openAiCompat ? 'OpenAI-compat endpoint may receive a /no_think prompt hint only.' : 'Native generateContent has no thinking-off control here.',
      ],
    }
  }
  if (isOpenApiProvider(profile.provider) || profile.provider === 'codex-api') {
    return {
      provider: profile.provider,
      resourceKey,
      streaming: false,
      thinkingControl: 'prompt_hint_only',
      structuredOutput: 'prompt_json',
      cancellation: true,
      notes: ['OpenAI-compatible chat completion is whole-response via existing client (no SSE adapter yet).', 'Only a /no_think prompt hint is applied; providers may ignore it.'],
    }
  }
  return {
    provider: profile.provider,
    resourceKey,
    streaming: false,
    thinkingControl: 'unsupported',
    structuredOutput: 'unsupported',
    cancellation: true,
    notes: ['Unknown provider treated as whole-response without thinking control.'],
  }
}

export function resolveCompanionThinking(capabilities: CompanionProviderCapabilities, disableThinking: boolean | undefined): CompanionThinkingControl {
  const requested = disableThinking !== false
  if (!requested) {
    if (capabilities.thinkingControl === 'supported') return { mode: 'supported', requested: false, applied: false }
    if (capabilities.thinkingControl === 'prompt_hint_only') {
      return { mode: 'prompt_hint_only', requested: false, applied: false, reason: 'Thinking disable not requested' }
    }
    return { mode: 'unsupported', requested: false, applied: false, reason: 'Provider cannot control thinking' }
  }
  if (capabilities.thinkingControl === 'supported') return { mode: 'supported', requested: true, applied: true }
  if (capabilities.thinkingControl === 'prompt_hint_only') {
    return {
      mode: 'prompt_hint_only',
      requested: true,
      applied: false,
      reason: 'Provider has no thinking-off API; only a prompt hint is sent',
    }
  }
  return {
    mode: 'unsupported',
    requested: true,
    applied: false,
    reason: 'Provider cannot disable thinking; keep the fast model or accept default behavior',
  }
}
