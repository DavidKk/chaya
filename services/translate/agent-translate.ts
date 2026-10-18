/** Translate Japanese to Chinese through the selected agent instance, endpoint, model and token. Read credentials only on the server; plugins call /api/translate with mode:ai. */
import { OLLAMA_TRANSLATE_RETRY_SYSTEM, requestOllama, translationNeedsReasoning } from '@/lib/translate/engine-http'
import type { TranslateAiConfig } from '@/lib/translate/engines'
import { loadAgentModelCache } from '@/services/game-agent/model-cache'
import { listOllamaModels, pickAvailableModel } from '@/services/game-agent/ollama-client'
import { ollamaFetch } from '@/services/game-agent/proxy/agent-proxy'
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { loadGameAgentSettings, ollamaProfiles, profileById } from '@/services/game-agent/settings'

import { scheduleOllama } from './ollama-queue'

export type AgentTranslateOptions = { interactive?: boolean; signal?: AbortSignal }

export async function agentJaToZh(text: string, config: TranslateAiConfig, options: AgentTranslateOptions = {}): Promise<string> {
  const settings = loadGameAgentSettings()
  const profile = (config.profileId && profileById(settings, config.profileId)) || ollamaProfiles(settings)[0]
  if (!profile) throw new Error('No available Ollama agent profile found')
  if (config.profileId && profile.id !== config.profileId) throw new Error('Selected agent profile no longer exists, please reselect')
  if (profile.provider !== 'ollama') throw new Error('AI translation only supports Ollama agent profiles')
  const signal = options.signal ?? AbortSignal.timeout(5 * 60 * 1000)
  const token = readGameAgentToken(profile.id)
  const http = ollamaFetch(profile)
  let model = config.model || profile.defaultModel
  if (!model) model = pickAvailableModel(await listOllamaModels(profile.endpoint, http, signal, token))
  if (!model) throw new Error(`Agent profile "${profile.label}" has no available models`)
  return scheduleOllama(
    async () => {
      const request = {
        host: profile.endpoint,
        model,
        text,
        temperature: profile.temperature,
        keepAlive: profile.keepAlive,
        token,
        interactive: options.interactive,
        signal,
      }
      const translated = await requestOllama(http, { ...request, think: !options.interactive && translationNeedsReasoning(text) })
      if (translated && translated.normalize('NFKC').trim() !== text.normalize('NFKC').trim()) return translated
      return requestOllama(http, { ...request, text: `译文：\n${text}`, system: OLLAMA_TRANSLATE_RETRY_SYSTEM, think: true })
    },
    !!options.interactive,
    signal
  )
}

export type TranslateAgentListing = {
  profiles: Array<{ id: string; label: string; defaultModel: string }>
  models: Record<string, Array<{ name: string }>>
}

/** Expose instance names and models to the translation page, excluding endpoints and tokens. */
export function listTranslateAgents(): TranslateAgentListing {
  const profiles = ollamaProfiles(loadGameAgentSettings())
  const cache = loadAgentModelCache(profiles)
  return {
    profiles: profiles.map((p) => ({ id: p.id, label: p.label || p.id, defaultModel: p.defaultModel })),
    models: Object.fromEntries(Object.entries(cache).map(([id, list]) => [id, list.map((m) => ({ name: m.name }))])),
  }
}
