import { withBrowserModelResource } from '@/lib/browser/companion-model-resource'
import { trimCompanionContext } from '@/lib/game-agent/companion/model-context'
import { COMPANION_MODEL_STARTUP_MS, type CompanionModelMetrics, type CompanionModelStatus } from '@/lib/game-agent/companion/model-diagnostics'
import type { RuntimeMessage } from '@/lib/game-agent/runtime'
import type { AgentSyncSettings } from '@/lib/game-agent/settings-sync'
import { COMPANION_KEEP_ALIVE, prepareCompanionOllama } from '@/services/game-agent/companion-ollama'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'

import { chayaFetch } from '../../helpers'
import { createLogger } from '../../helpers/net/logger'
import type { CompanionComplete } from './companion-chat'

/** Same-origin browser lease key for a loopback or remote Ollama endpoint. */
export function ollamaBrowserResourceKey(endpoint: string): string {
  const url = new URL(endpoint)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  return local ? 'local-inference' : `ollama:${url.origin}`
}

/** Remote gateway play/classify completion; awaits upstream settle under the shared lease. */
export async function completeRemoteOllama(input: {
  endpoint: string
  model: string
  messages: RuntimeMessage[]
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
  temperature?: number
  keepAlive?: string | number
  timeoutMs: number
  think?: boolean
  format?: Record<string, unknown>
  signal: AbortSignal
  priority: 'control' | 'foreground'
  instanceId?: string
}): Promise<RuntimeMessage> {
  return withBrowserModelResource({
    resourceKey: ollamaBrowserResourceKey(input.endpoint),
    priority: input.priority,
    instanceId: input.instanceId,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    run: (leaseSignal) =>
      streamOllamaChat(
        {
          endpoint: input.endpoint,
          model: input.model,
          messages: input.messages as import('@/services/game-agent/types').GameAgentMessage[],
          tools: input.tools.map((tool) => ({
            type: 'function' as const,
            function: { name: tool.name, description: tool.description || '', parameters: tool.inputSchema || { type: 'object', properties: {} } },
          })),
          temperature: input.temperature,
          keepAlive: input.keepAlive == null ? undefined : String(input.keepAlive),
          timeoutMs: input.timeoutMs,
          think: input.think === true,
          ...(input.format ? { format: input.format } : {}),
          signal: leaseSignal,
        },
        () => undefined
      ) as Promise<RuntimeMessage>,
  })
}

export type CompanionModelOptions = Parameters<CompanionComplete>[1]

type ModelPacket = {
  type: string
  text?: string
  message?: RuntimeMessage
  metrics?: CompanionModelMetrics
  error?: { code?: string; message?: string; retryable?: boolean }
  phase?: CompanionModelStatus['phase']
  residency?: CompanionModelStatus['residency']
  startupMs?: number
  startupLoadMs?: number
}

/** Whole-response adapters emit no deltas. The service keeps the shared inference queue. */
export function createCompanionModel(readConfig: () => AgentSyncSettings | null) {
  const complete: CompanionComplete = async (messages: RuntimeMessage[], options: CompanionModelOptions): ReturnType<CompanionComplete> => {
    const config = readConfig()
    const profile = config?.profiles.find((item) => item.id === options.profileId)
    if (!profile) throw Object.assign(new Error('请先配置陪玩模型'), { code: 'MODEL_UNAVAILABLE', retryable: true })
    const tactic = options.purpose === 'tactic-quick' || options.purpose === 'tactic-deep'
    const timeoutMs =
      options.purpose === 'warmup'
        ? 5_000
        : options.purpose === 'route'
          ? 15_000
        : options.purpose === 'prepare'
          ? 10_000
          : options.purpose === 'tactic-quick'
            ? 6_000
            : options.purpose === 'tactic-deep'
              ? 25_000
              : 15_000
    const startedAt = Date.now()
    const startupAllowance = profile.provider === 'ollama' && !tactic ? COMPANION_MODEL_STARTUP_MS : 0
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs + startupAllowance)])
    const cloud = (window as Window & { CHAYA_MCP_GATEWAY?: boolean }).CHAYA_MCP_GATEWAY === true
    if (cloud) {
      if (profile.provider !== 'ollama') throw Object.assign(new Error('浏览器宿主当前仅支持 Ollama 陪玩模型'), { code: 'CAPABILITY_UNSUPPORTED', retryable: false })
      const requestId = crypto.randomUUID()
      const resourceKey = ollamaBrowserResourceKey(profile.endpoint)
      const logger = createLogger('companion-model')
      const diagnostic = (phase: string, meta?: Record<string, unknown>) => {
        if (phase !== 'completed' && phase !== 'failed') return
        logger[phase === 'failed' ? 'warn' : 'info'](`Model ${phase}`, { requestId, resourceKey, model: options.model, purpose: `companion-${options.purpose}`, ...meta })
      }
      let startupStarted: number | undefined
      let startupMs: number | undefined
      let queueMs: number | undefined
      let generationStarted: number | undefined
      let firstTokenMs: number | undefined
      let residency: CompanionModelStatus['residency'] | undefined
      diagnostic('accepted')
      try {
        const result = await withBrowserModelResource<Awaited<ReturnType<CompanionComplete>>>({
          resourceKey,
          instanceId: (() => {
            try {
              const key: unknown = JSON.parse(options.conversationKey ?? '')
              return Array.isArray(key) && typeof key[1] === 'string' ? key[1] : undefined
            } catch {
              return undefined
            }
          })(),
          priority: options.purpose === 'prepare' ? 'background' : tactic ? 'control' : 'foreground',
          timeoutMs: timeoutMs + startupAllowance,
          queueTimeoutMs: timeoutMs,
          signal,
          run: async (leaseSignal) => {
            queueMs = Date.now() - startedAt
            startupStarted = Date.now()
            const startup = await prepareCompanionOllama({
              endpoint: profile.endpoint,
              model: options.model,
              signal: leaseSignal,
              onStatus: (status) => {
                residency = status.residency
                diagnostic(status.phase, { ...status, queueMs })
                options.onModelStatus?.(status)
              },
            }).finally(() => {
              startupMs = Date.now() - startupStarted!
            })
            const remaining = Math.max(1, timeoutMs - queueMs - (startupAllowance ? 0 : startup.startupMs))
            if (options.purpose === 'warmup') {
              return { role: 'assistant', content: '', companionMetrics: { totalMs: Date.now() - startedAt, queueMs, ...startup, generationMs: 0 } }
            }
            const contextStarted = performance.now()
            const trimmed = trimCompanionContext(messages, 12_000)
            const contextMs = performance.now() - contextStarted
            generationStarted = Date.now()
            const firstToken = new AbortController()
            let first = true
            const timer =
              options.purpose === 'chat'
                ? setTimeout(
                    () => firstToken.abort(new DOMException('Model first token timed out', 'TimeoutError')),
                    Math.max(1, 5_000 - queueMs - (startupAllowance ? 0 : startup.startupMs))
                  )
                : undefined
            try {
              const message = await streamOllamaChat(
                {
                  endpoint: profile.endpoint,
                  model: options.model,
                  messages: trimmed,
                  tools: [],
                  think: options.purpose === 'tactic-deep',
                  maxTokens: options.purpose === 'route' ? 512 : tactic ? 768 : options.purpose === 'prepare' ? 384 : 256,
                  temperature: options.purpose === 'chat' ? profile.temperature : 0,
                  keepAlive: COMPANION_KEEP_ALIVE,
                  timeoutMs: remaining,
                  format: options.format,
                  signal: AbortSignal.any([leaseSignal, firstToken.signal]),
                },
                (text) => {
                  if (!text) return
                  if (first) {
                    first = false
                    firstTokenMs = Date.now() - startedAt
                    if (timer) clearTimeout(timer)
                  }
                  options.onDelta?.(text)
                }
              )
              return {
                ...message,
                companionMetrics: {
                  totalMs: Date.now() - startedAt,
                  queueMs,
                  contextMs,
                  ...startup,
                  generationMs: Date.now() - generationStarted,
                  firstTokenMs,
                  loadMs: message.timing?.loadDurationNs === undefined ? undefined : message.timing.loadDurationNs / 1_000_000,
                },
              }
            } finally {
              if (timer) clearTimeout(timer)
            }
          },
        })
        diagnostic('completed', { ...result.companionMetrics, usage: result.usage, timing: result.timing })
        return result
      } catch (error) {
        diagnostic('failed', {
          totalMs: Date.now() - startedAt,
          queueMs: queueMs ?? Date.now() - startedAt,
          residency,
          startupMs,
          generationMs: generationStarted === undefined ? undefined : Date.now() - generationStarted,
          firstTokenMs,
          code: signal.aborted ? 'CANCELLED_OR_TIMEOUT' : 'MODEL_UNAVAILABLE',
        })
        throw error
      }
    }
    const response = await chayaFetch('/api/game-agent/companion-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        profileId: options.profileId,
        model: options.model,
        purpose: `companion-${options.purpose}`,
        conversationKey: options.conversationKey,
        messages,
        format: options.format,
      }),
      signal,
    })
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      throw Object.assign(new Error(body?.error?.message || `陪玩模型请求失败：HTTP ${response.status}`), { code: body?.error?.code || 'MODEL_UNAVAILABLE' })
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: Awaited<ReturnType<CompanionComplete>> | undefined
    let firstTokenMs: number | undefined
    const consume = (line: string) => {
      if (!line.trim()) return
      const packet = JSON.parse(line) as ModelPacket
      if (packet.type === 'delta' && typeof packet.text === 'string' && packet.text) {
        firstTokenMs ??= Date.now() - startedAt
        options.onDelta?.(packet.text)
      }
      if (packet.type === 'queued') options.onQueued?.()
      if (packet.type === 'model.status' && packet.phase && packet.residency)
        options.onModelStatus?.({ phase: packet.phase, residency: packet.residency, startupMs: packet.startupMs, startupLoadMs: packet.startupLoadMs })
      if (packet.type === 'failed') throw Object.assign(new Error(packet.error?.message || '陪玩模型不可用'), packet.error)
      if (packet.type === 'completed' && packet.message) {
        result = { ...packet.message, companionMetrics: { ...packet.metrics, totalMs: Date.now() - startedAt, firstTokenMs } }
      }
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 64 * 1024) throw new Error('Companion model stream exceeded packet budget')
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) consume(line)
      }
      buffer += decoder.decode()
      consume(buffer)
      if (signal.aborted) throw signal.reason
      if (!result) throw new Error('Companion model stream ended before completion')
      if (result.companionMetrics) result.companionMetrics.totalMs = Date.now() - startedAt
      return result
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
  complete.ensureReady = async (options) => {
    const profile = readConfig()?.profiles.find((item) => item.id === options.profileId)
    if (profile?.provider === 'ollama') await complete([], { ...options, purpose: 'warmup' })
  }
  return complete
}
