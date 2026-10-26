/** Translate Japanese to Chinese through the selected agent instance, endpoint, model and token. Read credentials only on the server; plugins call /api/translate with mode:ai. */
import { OLLAMA_TRANSLATE_RETRY_SYSTEM, requestOllama, translationNeedsReasoning } from '@/lib/translate/engine-http'
import type { TranslateAiConfig } from '@/lib/translate/engines'
import { loadAgentModelCache } from '@/services/game-agent/model-cache'
import { listOllamaModels, pickAvailableModel } from '@/services/game-agent/ollama-client'
import { ollamaFetch } from '@/services/game-agent/proxy/agent-proxy'
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { loadGameAgentSettings, ollamaProfiles, profileById } from '@/services/game-agent/settings'

import { scheduleOllama } from './ollama-queue'
import { isUsefulTranslation } from './text-classify'

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
}

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
      const translated = await requestOllama(http, { ...request, think: !options.interactive && translationNeedsReasoning(text) })
      if (translated && translated.normalize('NFKC').trim() !== text.normalize('NFKC').trim()) return translated
      return requestOllama(http, { ...request, text: `译文：\n${text}`, system: OLLAMA_TRANSLATE_RETRY_SYSTEM, think: true })
    },
    {
      interactive: options.interactive,
      concurrency: options.concurrency,
      lane,
      signal,
    }
  )
}

function hasAllControlTokens(src: string, zh: string): boolean {
  const tokens = src.match(/__C\d+__/g) || []
  return tokens.every((token) => zh.includes(token))
}

/** Split a long text into natural sentence/clause chunks under maxChars without cutting mid-sentence or mid-control code. */
export function splitSentenceByNaturalBoundaries(text: string, maxChars: number): string[] {
  if (Array.from(text).length <= maxChars) return [text]

  const protectedRanges: Array<{ start: number; end: number }> = []
  const tokenRegex = /(__C\d+__|\\(?:[A-Za-z]+)\[[^\]]*\])/g
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(text)) !== null) {
    protectedRanges.push({ start: match.index, end: match.index + match[0].length })
  }

  const isProtected = (pos: number) => protectedRanges.some((r) => pos > r.start && pos < r.end)

  const patterns = [/\r?\n+/g, /[。！？!?……]+|\.{3,}/g, /[；;，,、]+/g, /\s+/g]

  const chunks: string[] = []
  let remaining = text

  while (Array.from(remaining).length > maxChars) {
    let splitIndex = -1

    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      let bestPos = -1

      while ((m = pattern.exec(remaining)) !== null) {
        const candidate = m.index + m[0].length
        if (candidate > 0 && Array.from(remaining.slice(0, candidate)).length <= maxChars && !isProtected(candidate)) {
          bestPos = candidate
        } else if (Array.from(remaining.slice(0, candidate)).length > maxChars) {
          break
        }
      }

      if (bestPos > 0) {
        splitIndex = bestPos
        break
      }
    }

    if (splitIndex <= 0) {
      const chars = Array.from(remaining)
      const target = Math.min(chars.length, maxChars)
      const sliceStr = chars.slice(0, target).join('')
      let candidate = sliceStr.length

      while (candidate > 0 && isProtected(candidate)) {
        candidate--
      }
      if (candidate <= 0) {
        const nextRange = protectedRanges.find((r) => r.start < maxChars && r.end > maxChars)
        candidate = nextRange ? nextRange.end : Math.max(1, sliceStr.length)
      }
      splitIndex = candidate
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex)
  }

  if (remaining.length > 0) {
    chunks.push(remaining)
  }

  return chunks.filter((c) => c.length > 0)
}

export function packBatches<T extends { text: string }>(items: T[], maxChars: number): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let currentChars = 0

  for (const item of items) {
    const chars = Array.from(item.text).length
    if (current.length && currentChars + chars > maxChars) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(item)
    currentChars += chars
  }
  if (current.length) batches.push(current)
  return batches
}

export function buildBatchTranslatePrompt(texts: string[]): { system: string; user: string } {
  const system = [
    '你是专精游戏本地化的翻译器，将日文或英文原文逐行翻译为简体中文。',
    '必须严格遵循以下规则：',
    '1. 占位符（例如 __C0__、__C1__ 等）必须完全原样保留，不得修改、遗漏或移动。',
    '2. 严格按 [序号] 格式逐条输出对应的简体中文译文，序号必须与输入一一对应。',
    '3. 保持与输入相同的条目数量，绝不能合并、遗漏或跳过任何一条。',
    '4. 仅输出翻译结果，不要输出任何前言、总结、思考过程或解释说明。',
  ].join('\n')

  const lines = texts.map((text, i) => `[${i + 1}] ${text}`)
  const user = `请按 [序号] 格式将以下每条文本翻译为简体中文：\n${lines.join('\n')}`

  return { system, user }
}

export function parseBatchResponse(raw: string, count: number): Array<string | null> {
  const cleaned = raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim()
  const lines = cleaned.split(/\r?\n/)
  const result: Array<string | null> = new Array(count).fill(null)

  let currentIndex = -1
  const linePattern = /^\s*(?:\[(\d+)\]|(\d+)[\.、：:]|\((\d+)\))\s*(.*)$/

  for (const line of lines) {
    const match = linePattern.exec(line)
    if (match) {
      const idxStr = match[1] || match[2] || match[3]
      const idx = parseInt(idxStr, 10)
      if (idx >= 1 && idx <= count) {
        currentIndex = idx - 1
        result[currentIndex] = match[4].trim()
        continue
      }
    }
    if (currentIndex >= 0 && result[currentIndex] !== null) {
      result[currentIndex] += '\n' + line
    }
  }

  for (let i = 0; i < count; i++) {
    if (result[i] !== null) {
      result[i] = result[i]!.replace(/^["「『]+|["」』]+$/g, '').trim()
    }
  }

  return result
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
  scheduled: boolean
  totalChars: number
}

const buckets = new Map<string, AgentLaneBucket>()

async function processAgentBatch(batch: QueuedAgentItem[]) {
  if (batch.length === 1) {
    const single = batch[0]
    agentSingleJaToZh(single.text, single.config, single.options).then(single.resolve, single.reject)
    return
  }

  const { system, user } = buildBatchTranslatePrompt(batch.map((b) => b.text))
  const sample = batch[0]
  const config = sample.config
  const options = sample.options

  try {
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

    const raw = await scheduleOllama(
      async () => {
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
        return requestOllama(http, request)
      },
      {
        interactive: false,
        concurrency: options.concurrency,
        lane,
        signal,
      }
    )

    const parsed = parseBatchResponse(raw, batch.length)
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]
      const zh = parsed[i]
      if (zh && hasAllControlTokens(item.text, zh) && isUsefulTranslation(item.text, item.text, zh, zh, 'zh')) {
        item.resolve(zh)
      } else {
        agentSingleJaToZh(item.text, item.config, item.options).then(item.resolve, item.reject)
      }
    }
  } catch {
    for (const item of batch) {
      agentSingleJaToZh(item.text, item.config, item.options).then(item.resolve, item.reject)
    }
  }
}

function flushBucket(key: string) {
  const bucket = buckets.get(key)
  if (!bucket || !bucket.queue.length) return
  bucket.scheduled = false
  const items = bucket.queue.splice(0, bucket.queue.length)
  bucket.totalChars = 0
  const maxChars = items[0]?.maxChars ?? 3000
  const batches = packBatches(items, maxChars)
  for (const batch of batches) {
    void processAgentBatch(batch)
  }
}

function enqueueAgentRequest(item: QueuedAgentItem, bucketKey: string) {
  let bucket = buckets.get(bucketKey)
  if (!bucket) {
    bucket = { queue: [], scheduled: false, totalChars: 0 }
    buckets.set(bucketKey, bucket)
  }
  bucket.queue.push(item)
  bucket.totalChars += Array.from(item.text).length

  if (bucket.totalChars >= item.maxChars) {
    flushBucket(bucketKey)
  } else if (!bucket.scheduled) {
    bucket.scheduled = true
    queueMicrotask(() => flushBucket(bucketKey))
  }
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
      return agentSingleJaToZh(text, config, options)
    }
  }

  const bucketKey = `${config.profileId || 'default'}:${config.model || 'default'}`
  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason)
      return
    }
    const item: QueuedAgentItem = {
      text,
      config,
      options,
      maxChars,
      resolve,
      reject,
    }
    const onAbort = () => {
      const bucket = buckets.get(bucketKey)
      if (bucket) {
        const idx = bucket.queue.indexOf(item)
        if (idx >= 0) {
          bucket.queue.splice(idx, 1)
          bucket.totalChars = Math.max(0, bucket.totalChars - Array.from(item.text).length)
        }
      }
      reject(options.signal?.reason)
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
