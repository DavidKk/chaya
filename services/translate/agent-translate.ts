/** Translate Japanese to Chinese through the selected agent instance, endpoint, model and token. Read credentials only on the server; plugins call /api/translate with mode:ai. */
import { OLLAMA_TRANSLATE_RETRY_SYSTEM, requestOllama, translationNeedsReasoning } from '@/lib/translate/engine-http'
import type { TranslateAiConfig } from '@/lib/translate/engines'
import { loadAgentModelCache } from '@/services/game-agent/model-cache'
import { listOllamaModels, pickAvailableModel } from '@/services/game-agent/ollama-client'
import { ollamaFetch } from '@/services/game-agent/proxy/agent-proxy'
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { loadGameAgentSettings, ollamaProfiles, profileById } from '@/services/game-agent/settings'
import { measureOperation, runtimeEvent, startOperation } from '@/services/log/operation'

import { buildBatchTranslatePrompt, hasAllControlTokens, packBatches, parseBatchResponse, splitSentenceByNaturalBoundaries } from './agent-batching'
export { buildBatchTranslatePrompt, packBatches, parseBatchResponse, splitSentenceByNaturalBoundaries } from './agent-batching'

import { scheduleOllama } from './ollama-queue'
import { isUsefulTranslation } from './text-classify'

function timedAgentRequest(http: Parameters<typeof requestOllama>[0], request: Parameters<typeof requestOllama>[1], meta: Record<string, unknown>) {
  return measureOperation('translate', 'agent.request', { ...meta, model: request.model, think: request.think }, () => requestOllama(http, request))
}

export type AgentTranslateOptions = {
  interactive?: boolean
  signal?: AbortSignal
  category?: string
  speaker?: string
  context?: string
  /** Maximum concurrent inferences on this instance's Ollama lane. */
  concurrency?: number
  /** Maximum packed characters per single request batch. Default 3000. */
  maxChars?: number
  /** Concurrency is scoped per lane; distinct endpoints/models should use distinct lanes. */
  lane?: string
  /** Seed jobs may keep a partial request open while their independent cache scan supplies more misses. */
  batchScope?: AgentBatchScope
  onTrace?: (message: string) => void
}

export type AgentBatchScope = { waitForMore: () => boolean }

export async function agentSingleJaToZh(text: string, config: TranslateAiConfig, options: AgentTranslateOptions = {}): Promise<string> {
  const settings = loadGameAgentSettings()
  const profile = (config.profileId && profileById(settings, config.profileId)) || ollamaProfiles(settings)[0]
  if (!profile) throw new Error('No available Ollama agent profile found')
  if (config.profileId && profile.id !== config.profileId) throw new Error('Selected agent profile no longer exists, please reselect')
  if (profile.provider !== 'ollama') throw new Error('AI translation only supports Ollama agent profiles')
  const signal = options.signal ?? AbortSignal.timeout(5 * 60 * 1000)
  const token = readGameAgentToken(profile.id)
  const http = ollamaFetch(profile)
  const lane = options.lane || `agent:${profile.id}`
  let model = config.model || profile.defaultModel
  if (!model) model = pickAvailableModel(await listOllamaModels(profile.endpoint, http, signal, token))
  if (!model) throw new Error(`Agent profile "${profile.label}" has no available models`)
  return scheduleOllama(
    async () => {
      options.onTrace?.(`Agent request submitted: items=1, sourceChars=${Array.from(text).length}`)
      const request = {
        host: profile.endpoint,
        model,
        text,
        category: options.category,
        speaker: options.speaker,
        context: options.context,
        temperature: profile.temperature,
        keepAlive: profile.keepAlive,
        token,
        interactive: options.interactive,
        signal,
      }
      const requestMeta = { lane, items: 1, sourceChars: Array.from(text).length }
      const translated = await timedAgentRequest(http, { ...request, think: !options.interactive && translationNeedsReasoning(text) }, { ...requestMeta, attempt: 1 })
      if (translated && translated.normalize('NFKC').trim() !== text.normalize('NFKC').trim()) return translated
      options.onTrace?.(`Agent request submitted: items=1, sourceChars=${Array.from(text).length}`)
      return timedAgentRequest(http, { ...request, text: `译文：\n${text}`, system: OLLAMA_TRANSLATE_RETRY_SYSTEM, think: true }, { ...requestMeta, attempt: 2 })
    },
    {
      interactive: options.interactive,
      concurrency: options.concurrency,
      startTiming: (meta) => startOperation('translate', 'agent.inference', meta),
      lane,
      signal,
    }
  )
}

type QueuedAgentItem = {
  text: string
  config: TranslateAiConfig
  options: AgentTranslateOptions
  maxChars: number
  resolve: (zh: string) => void
  reject: (err: unknown) => void
}

type AgentLaneBucket = {
  queue: QueuedAgentItem[]
  totalChars: number
  startedAt: number
  timer?: ReturnType<typeof setTimeout>
}

const buckets = new Map<string, AgentLaneBucket>()
const scopeIds = new WeakMap<AgentBatchScope, number>()
let scopeSequence = 0

function batchSignal(batch: QueuedAgentItem[]) {
  const controller = new AbortController()
  const cancel = () => {
    if (batch.every((item) => item.options.signal?.aborted)) controller.abort(new Error('All Agent request items cancelled'))
  }
  for (const item of batch) item.options.signal?.addEventListener('abort', cancel, { once: true })
  cancel()
  return {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5 * 60 * 1000)]),
    dispose: () => {
      for (const item of batch) item.options.signal?.removeEventListener('abort', cancel)
    },
  }
}

async function processAgentBatch(batch: QueuedAgentItem[]) {
  batch = batch.filter((item) => !item.options.signal?.aborted)
  if (!batch.length) return
  if (batch.length === 1) {
    const single = batch[0]
    agentSingleJaToZh(single.text, single.config, single.options).then(single.resolve, single.reject)
    return
  }

  const { system, user } = buildBatchTranslatePrompt(batch.map((b) => b.text))
  const sample = batch[0]
  const config = sample.config
  const options = sample.options
  const transport = batchSignal(batch)
  const retry = (item: QueuedAgentItem) => {
    if (!item.options.signal?.aborted) agentSingleJaToZh(item.text, item.config, item.options).then(item.resolve, item.reject)
  }

  try {
    const settings = loadGameAgentSettings()
    const profile = (config.profileId && profileById(settings, config.profileId)) || ollamaProfiles(settings)[0]
    if (!profile) throw new Error('No available Ollama agent profile found')
    if (config.profileId && profile.id !== config.profileId) throw new Error('Selected agent profile no longer exists, please reselect')
    if (profile.provider !== 'ollama') throw new Error('AI translation only supports Ollama agent profiles')

    const signal = transport.signal
    const token = readGameAgentToken(profile.id)
    const http = ollamaFetch(profile)
    const lane = options.lane || `agent:${profile.id}`
    let model = config.model || profile.defaultModel
    if (!model) model = pickAvailableModel(await listOllamaModels(profile.endpoint, http, signal, token))
    if (!model) throw new Error(`Agent profile "${profile.label}" has no available models`)

    const raw = await scheduleOllama(
      async () => {
        options.onTrace?.(`Agent request submitted: items=${batch.length}, sourceChars=${batch.reduce((sum, item) => sum + Array.from(item.text).length, 0)}`)
        const request = {
          host: profile.endpoint,
          model,
          text: user,
          system,
          category: options.category,
          speaker: options.speaker,
          context: options.context,
          temperature: profile.temperature,
          keepAlive: profile.keepAlive,
          token,
          interactive: false,
          signal,
        }
        return timedAgentRequest(http, request, { lane, items: batch.length, sourceChars: batch.reduce((sum, item) => sum + Array.from(item.text).length, 0) })
      },
      {
        interactive: false,
        concurrency: options.concurrency,
        startTiming: (meta) => startOperation('translate', 'agent.inference', meta),
        lane,
        signal,
      }
    )

    const parsed = parseBatchResponse(raw, batch.length)
    let retries = 0
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]
      if (item.options.signal?.aborted) continue
      const zh = parsed[i]
      if (zh && hasAllControlTokens(item.text, zh) && isUsefulTranslation(item.text, item.text, zh, zh, 'zh')) {
        item.resolve(zh)
      } else {
        retries++
        retry(item)
      }
    }
    if (retries) runtimeEvent('warn', 'translate', 'agent.batch: retrying invalid results', { items: batch.length, retries })
  } catch (error) {
    runtimeEvent('warn', 'translate', 'agent.batch: retrying individual requests', { items: batch.length, errorName: error instanceof Error ? error.name : 'UnknownError' })
    for (const item of batch) retry(item)
  } finally {
    transport.dispose()
  }
}

function flushBucket(key: string, reason: string) {
  const bucket = buckets.get(key)
  if (!bucket) return
  buckets.delete(key)
  if (bucket.timer) clearTimeout(bucket.timer)
  if (!bucket.queue.length) return
  const items = bucket.queue.splice(0, bucket.queue.length)
  bucket.totalChars = 0
  const maxChars = items[0]?.maxChars ?? 3000
  const batches = packBatches(items, maxChars)
  runtimeEvent('debug', 'translate', 'agent.batch: packed', {
    reason,
    items: items.length,
    sourceChars: items.reduce((sum, item) => sum + Array.from(item.text).length, 0),
    batchWaitMs: Math.round(performance.now() - bucket.startedAt),
    batches: batches.length,
    maxChars,
    lane: items[0].options.lane,
  })
  items[0].options.onTrace?.(`Agent queue flushed: reason=${reason}, items=${items.length}, sourceChars=${items.reduce((sum, item) => sum + Array.from(item.text).length, 0)}`)
  for (const batch of batches) {
    void processAgentBatch(batch)
  }
}

function scheduleBucket(key: string, bucket: AgentLaneBucket) {
  if (bucket.timer) clearTimeout(bucket.timer)
  bucket.timer = setTimeout(
    () => {
      if (buckets.get(key) !== bucket) return
      const waiting = bucket.queue[0]?.options.batchScope?.waitForMore()
      if (waiting && performance.now() - bucket.startedAt < 5000) scheduleBucket(key, bucket)
      else flushBucket(key, waiting ? 'timeout' : 'drained')
    },
    Math.max(0, Math.min(250, 5000 - (performance.now() - bucket.startedAt)))
  )
}

function enqueueAgentRequest(item: QueuedAgentItem, bucketKey: string) {
  let bucket = buckets.get(bucketKey)
  const chars = Array.from(item.text).length
  if (bucket?.queue.length && bucket.totalChars + chars > item.maxChars) {
    flushBucket(bucketKey, 'capacity')
    bucket = undefined
  }
  if (!bucket) {
    bucket = { queue: [], totalChars: 0, startedAt: performance.now() }
    buckets.set(bucketKey, bucket)
  }
  bucket.queue.push(item)
  bucket.totalChars += chars

  if (bucket.totalChars >= item.maxChars) {
    flushBucket(bucketKey, 'capacity')
  } else scheduleBucket(bucketKey, bucket)
}

export async function agentJaToZh(text: string, config: TranslateAiConfig, options: AgentTranslateOptions = {}): Promise<string> {
  if (options.interactive) {
    return agentSingleJaToZh(text, config, options)
  }

  const maxChars = typeof options.maxChars === 'number' && Number.isFinite(options.maxChars) ? Math.max(1, Math.min(40000, Math.floor(options.maxChars))) : 3000
  const chars = Array.from(text).length
  if (chars > maxChars) {
    const parts = splitSentenceByNaturalBoundaries(text, maxChars)
    if (parts.length > 1) {
      const translatedParts = await Promise.all(parts.map((part) => agentJaToZh(part, config, options)))
      const combined = translatedParts.join('')
      if (hasAllControlTokens(text, combined)) {
        return combined
      }
      throw new Error('Translation control tokens missing after sentence reassembly')
    }
  }

  if (options.batchScope && !scopeIds.has(options.batchScope)) scopeIds.set(options.batchScope, ++scopeSequence)
  const bucketKey = JSON.stringify([
    config.profileId,
    config.model,
    options.lane,
    maxChars,
    options.concurrency,
    options.category,
    options.speaker,
    options.context,
    options.batchScope ? scopeIds.get(options.batchScope) : null,
  ])
  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason)
      return
    }
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    const item: QueuedAgentItem = {
      text,
      config,
      options,
      maxChars,
      resolve: (zh) => {
        cleanup()
        resolve(zh)
      },
      reject: (err) => {
        cleanup()
        reject(err)
      },
    }
    const onAbort = () => {
      const bucket = buckets.get(bucketKey)
      if (bucket) {
        const idx = bucket.queue.indexOf(item)
        if (idx >= 0) {
          bucket.queue.splice(idx, 1)
          bucket.totalChars = Math.max(0, bucket.totalChars - Array.from(item.text).length)
          if (!bucket.queue.length) flushBucket(bucketKey, 'cancelled')
        }
      }
      item.reject(options.signal?.reason)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    enqueueAgentRequest(item, bucketKey)
  })
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
