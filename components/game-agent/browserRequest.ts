import type { WebMcpToolDefinition } from '@/initializer/webmcp/model-context'
import { browserAgentTraceArchive } from '@/lib/browser/agent-trace-store'
import { gameAgentProfileToolSpecs } from '@/lib/game-agent/profile-tool-specs'
import { isCliProvider } from '@/lib/game-agent/providers'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import { type AgentTimeoutSettings, normalizeAgentTimeouts } from '@/lib/game-agent/timeouts'
import { cacheToolSettings, normalizeToolSettings, readCachedToolSettings } from '@/lib/game-agent/tool-settings'
import { functionToolDefinition } from '@/lib/webmcp/mcp-mirror'
import { pickAvailableModel, streamOllamaChat, uniqueOllamaModels } from '@/services/game-agent/ollama-client'

import { createBrowserAgentRuntime } from './browserTurn'
import type { GameAgentRequest } from './GameAgentWorkspace'

export type BrowserAgentProfile = AgentTimeoutSettings & {
  id: string
  label: string
  provider: 'ollama'
  endpoint: string
  defaultModel: string
  temperature: number
  keepAlive: string
}

type Settings = { version: 1; defaultProfileId: string; profiles: BrowserAgentProfile[] }
type Model = { name: string }
type ModelCacheEntry = { endpoint: string; models: Model[] }

const SETTINGS_KEY = 'chaya.gameAgent.settings'
const MODELS_KEY = 'chaya.gameAgent.models'
const CLI_LOCAL_ONLY = 'Cursor、Codex、Claude、Gemini 类型需要 Chaya App 或本机服务'

function defaultSettings(): Settings {
  const profile: BrowserAgentProfile = {
    id: 'ollama-local',
    label: 'Local Ollama',
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    defaultModel: '',
    temperature: 0.2,
    keepAlive: '10m',
    modelRequestTimeoutMs: 10_000,
    modelTimeoutMs: 120_000,
    gameCallTimeoutMs: 15_000,
  }
  return { version: 1, defaultProfileId: profile.id, profiles: [profile] }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function settings() {
  const value = readJson<Settings>(SETTINGS_KEY, defaultSettings())
  if (!Array.isArray(value.profiles) || value.profiles.length === 0) return defaultSettings()
  return {
    ...value,
    version: 1 as const,
    defaultProfileId: value.profiles[0].id,
    profiles: value.profiles.map((profile) => ({ ...profile, ...normalizeAgentTimeouts(profile) })),
  }
}

/** 流读完或被取消时调用 `release`，让按游戏登记的 Turn 只含仍在运行的 */
function releaseOnEnd(source: Response, release: () => void) {
  if (!source.body) {
    release()
    return source
  }
  const reader = source.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        release()
        controller.close()
      } else controller.enqueue(value)
    },
    cancel(reason) {
      release()
      return reader.cancel(reason)
    },
  })
  return new Response(body, { status: source.status, headers: source.headers })
}

function saveSettings(value: Settings) {
  const next = { ...value, version: 1 as const, defaultProfileId: value.profiles[0]?.id || '' }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  return next
}

function target(args: Record<string, unknown>) {
  const value = typeof args.target === 'string' ? args.target.trim() : ''
  if (!value) throw new Error('缺少参数 target')
  return value
}

function resolveProfile(current: Settings, value: string) {
  const byId = current.profiles.find((profile) => profile.id === value)
  if (byId) return byId
  const matches = current.profiles.filter((profile) => profile.label.localeCompare(value, undefined, { sensitivity: 'accent' }) === 0)
  if (matches.length > 1) throw new Error(`名称 ${value} 对应多个 Agent，请使用 id`)
  if (!matches.length) throw new Error(`找不到 Agent：${value}`)
  return matches[0]
}

function profilePatch(args: Record<string, unknown>) {
  const patch: Partial<BrowserAgentProfile> = {}
  for (const key of ['id', 'label', 'endpoint', 'defaultModel', 'keepAlive'] as const) {
    if (typeof args[key] === 'string') patch[key] = args[key].trim()
  }
  if (typeof args.temperature === 'number' && Number.isFinite(args.temperature)) patch.temperature = Math.min(2, Math.max(0, args.temperature))
  for (const key of ['modelRequestTimeoutMs', 'modelTimeoutMs', 'gameCallTimeoutMs'] as const) {
    if (typeof args[key] === 'number' && Number.isFinite(args[key])) patch[key] = Math.round(args[key])
  }
  return patch
}

/** Cloud Agent CRUD uses the same names and intent descriptions as the local Agent runtime. */
export function buildBrowserAgentProfileTools(): WebMcpToolDefinition[] {
  return gameAgentProfileToolSpecs({ credentials: false }).map((spec) =>
    functionToolDefinition(spec, async (args) => {
      const current = settings()
      if (spec.name === 'chaya_agent_profiles') return { defaultProfileId: current.profiles[0]?.id || '', profiles: current.profiles }
      if (spec.name === 'chaya_agent_profile_create') {
        const patch = profilePatch(args)
        if (!patch.label) throw new Error('创建 Agent 时必须提供名称')
        const id = patch.id || globalThis.crypto?.randomUUID?.() || `ollama-${Date.now().toString(36)}`
        if (current.profiles.some((profile) => profile.id === id)) throw new Error(`Agent id 已存在：${id}`)
        const profile: BrowserAgentProfile = {
          id,
          label: patch.label,
          provider: 'ollama',
          endpoint: patch.endpoint || 'http://127.0.0.1:11434',
          defaultModel: patch.defaultModel || '',
          temperature: patch.temperature ?? 0.2,
          keepAlive: patch.keepAlive || '10m',
          modelRequestTimeoutMs: patch.modelRequestTimeoutMs || 10_000,
          modelTimeoutMs: patch.modelTimeoutMs || 120_000,
          gameCallTimeoutMs: patch.gameCallTimeoutMs || 15_000,
        }
        saveSettings({ ...current, profiles: [...current.profiles, profile] })
        return profile
      }
      const existing = resolveProfile(current, target(args))
      if (spec.name === 'chaya_agent_profile_update') {
        const updated = { ...existing, ...profilePatch(args), id: existing.id, provider: 'ollama' as const }
        saveSettings({ ...current, profiles: current.profiles.map((profile) => (profile.id === existing.id ? updated : profile)) })
        return updated
      }
      if (current.profiles.length <= 1) throw new Error('至少需要保留一个 Agent')
      const saved = saveSettings({ ...current, profiles: current.profiles.filter((profile) => profile.id !== existing.id) })
      const cache = modelCache()
      delete cache[existing.id]
      localStorage.setItem(MODELS_KEY, JSON.stringify(cache))
      return { deleted: { id: existing.id, label: existing.label }, defaultProfileId: saved.defaultProfileId, count: saved.profiles.length }
    })
  )
}

function modelCache() {
  return readJson<Record<string, ModelCacheEntry>>(MODELS_KEY, {})
}

function cachedModels(profiles: BrowserAgentProfile[]): Record<string, Model[]> {
  const cache = modelCache()
  return Object.fromEntries(profiles.flatMap((profile) => (cache[profile.id]?.endpoint === profile.endpoint ? [[profile.id, uniqueOllamaModels(cache[profile.id].models)]] : [])))
}

async function testOllama(profile: BrowserAgentProfile): Promise<Model[]> {
  const endpoint = profile.endpoint.replace(/\/+$/, '')
  const result = await fetch(`${endpoint}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) })
  if (!result.ok) throw new Error(`Ollama HTTP ${result.status}`)
  const body = (await result.json()) as { models?: Array<{ name?: unknown }> }
  return uniqueOllamaModels((body.models || []).flatMap((item) => (typeof item.name === 'string' && item.name ? [{ name: item.name }] : [])))
}

/** Cloud 没有本机 Node API；同一套 Agent UI 通过浏览器存储维护接入配置。 */
type AgentTaskCall = (message: Exclude<import('@/lib/runtime/game-link-protocol').AgentTaskMessage, { type: 'agent.task.result' }>, signal?: AbortSignal) => Promise<unknown>

export function createBrowserGameAgentRequest(input: { connected: boolean; agentTask?: AgentTaskCall }, runtime = createBrowserAgentRuntime()): GameAgentRequest {
  const gameTurns = new Map<string, Set<AbortController>>()
  const remoteTurns = new Map<string, { taskId: string; sessionId: string; gameId: string }>()

  const taskCall = (message: Parameters<AgentTaskCall>[0], signal?: AbortSignal) => {
    if (!input.agentTask) return Promise.reject(new Error('当前环境没有 Agent 游戏通道'))
    return input.agentTask(message, signal)
  }

  const classifyPlay = async (profile: BrowserAgentProfile, model: string, prompt: string, signal?: AbortSignal) => {
    if (!input.connected) return { operate: false as const }
    try {
      const answer = await streamOllamaChat(
        {
          endpoint: profile.endpoint,
          model,
          keepAlive: profile.keepAlive,
          timeoutMs: profile.modelTimeoutMs,
          temperature: 0,
          format: {
            type: 'object',
            properties: {
              operate: { type: 'boolean' },
              shape: { type: 'string', enum: ['single', 'batch', 'open'] },
            },
            required: ['operate'],
            additionalProperties: false,
          },
          messages: [
            {
              role: 'system',
              content:
                'Return JSON only: {"operate":boolean,"shape"?: "single"|"batch"|"open"}. operate=true only when the user asks you to control the running game with ordinary player input, such as moving, interacting, advancing dialogue, or fighting. When operate=true, shape=batch for several or all matching map targets, single for one concrete action, open for story/travel/combat. Questions and game-data edits are false.',
            },
            { role: 'user', content: prompt },
          ],
          signal,
        },
        () => undefined
      )
      const value = JSON.parse(answer.content) as { operate?: unknown; shape?: unknown }
      if (value.operate !== true) return { operate: false as const }
      const shape = value.shape === 'single' || value.shape === 'batch' || value.shape === 'open' ? value.shape : ('open' as const)
      return { operate: true as const, shape }
    } catch {
      return { operate: false as const }
    }
  }

  const taskEventStream = (taskId: string, sessionId: string, signal?: AbortSignal, initialSeq = 0) => {
    const encoder = new TextEncoder()
    const subscription = new AbortController()
    const pollingSignal = signal ? AbortSignal.any([signal, subscription.signal]) : subscription.signal
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          let seq = initialSeq
          const emit = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`))
          emit({ type: 'turn.started', turnId: taskId, sessionId })
          try {
            for (;;) {
              if (pollingSignal.aborted) throw pollingSignal.reason
              const result = (await taskCall({ type: 'agent.task.events', requestId: crypto.randomUUID(), taskId, afterSeq: seq }, pollingSignal)) as {
                gap?: boolean
                task?: AgentTask
                events?: AgentTaskEvent[]
              }
              if (result.gap) emit({ type: 'history.gap' })
              for (const event of result.events || []) {
                seq = Math.max(seq, event.seq)
                if (result.task) await browserAgentTraceArchive.append({ ...result.task, events: [], messages: [] }, event)
                if (event.type === 'assistant.completed')
                  emit({
                    type: 'assistant.delta',
                    seq: event.seq,
                    text: typeof event.data === 'object' && event.data && 'text' in event.data ? String((event.data as { text?: unknown }).text || '') : '',
                  })
                else emit({ type: event.type, seq: event.seq, ...(event.data || {}) })
              }
              const state = result.task?.state
              if (state && ['completed', 'stopped', 'failed', 'interrupted'].includes(state)) {
                if (state === 'completed') emit({ type: 'turn.completed', reason: 'answered' })
                else if (state === 'stopped') emit({ type: 'turn.stopped' })
                else emit({ type: 'turn.failed', message: result.task?.error || (state === 'interrupted' ? '游戏重载，任务已中断' : 'Agent 任务失败') })
                remoteTurns.delete(taskId)
                controller.close()
                return
              }
              await new Promise((resolve) => window.setTimeout(resolve, 500))
            }
          } catch (error) {
            if (!pollingSignal.aborted) emit({ type: 'turn.failed', message: error instanceof Error ? error.message : String(error) })
            try {
              controller.close()
            } catch {
              /* The reader already cancelled; the ext task intentionally keeps running. */
            }
          }
        },
        cancel() {
          subscription.abort(new DOMException('订阅已关闭', 'AbortError'))
        },
      }),
      { headers: { 'Cache-Control': 'no-cache, no-transform', 'Content-Type': 'text/event-stream; charset=utf-8' } }
    )
  }

  const remoteTaskStream = async (
    body: {
      gameId: string
      prompt: string
      sessionId?: string
      profileId: string
      model: string
      locale?: string
      capability?: 'play' | 'companion'
      shape?: 'single' | 'batch' | 'open'
      surface?: 'companion'
      companionCharacter?: string
    },
    signal?: AbortSignal
  ) => {
    const taskId = crypto.randomUUID()
    const sessionId = body.sessionId || crypto.randomUUID()
    const profile = resolveProfile(settings(), body.profileId)
    await taskCall(
      {
        type: 'agent.task.start',
        requestId: crypto.randomUUID(),
        deadlineAt: Date.now() + profile.modelTimeoutMs,
        taskId,
        gameId: body.gameId,
        conversationId: sessionId,
        capability: body.capability || 'play',
        profileId: body.profileId,
        model: body.model,
        locale: body.locale,
        surface: body.surface || 'sidebar',
        companionCharacter: body.companionCharacter,
        ...(body.shape ? { shape: body.shape } : {}),
        goal: body.prompt,
      },
      signal
    )
    remoteTurns.set(taskId, { taskId, sessionId, gameId: body.gameId })
    return taskEventStream(taskId, sessionId, signal)
  }
  return async (path, init) => {
    const url = new URL(path, location.origin)
    const method = (init?.method || 'GET').toUpperCase()

    if (url.pathname === '/api/game-agent/auth' || url.pathname.startsWith('/api/game-agent/auth/') || url.pathname === '/api/game-agent/processes') {
      return response({ error: { code: 'LOCAL_ONLY', message: CLI_LOCAL_ONLY } }, 404)
    }
    if (url.pathname === '/api/integration/game-agent') {
      if (method === 'GET') {
        const current = settings()
        return response({ ok: true, settings: current, models: cachedModels(current.profiles) })
      }
      const body = JSON.parse(String(init?.body || '{}')) as { action?: string; profile?: BrowserAgentProfile; settings?: Settings }
      if (body.settings?.profiles?.some((profile) => isCliProvider(profile.provider)) || (body.profile && isCliProvider(body.profile.provider))) {
        return response({ error: { code: 'LOCAL_ONLY', message: CLI_LOCAL_ONLY } }, 400)
      }
      if (method === 'PUT' && body.settings?.profiles?.length) {
        const next = saveSettings(body.settings)
        return response({ ok: true, settings: next })
      }
      if (method === 'POST' && (body.action === 'test' || body.action === 'models') && body.profile) {
        try {
          const models = await testOllama(body.profile)
          const cached = modelCache()
          cached[body.profile.id] = { endpoint: body.profile.endpoint, models }
          localStorage.setItem(MODELS_KEY, JSON.stringify(cached))
          const defaultModel = models.some((model) => model.name === body.profile!.defaultModel) ? body.profile.defaultModel : models[0]?.name || ''
          return response({ ok: true, profileId: body.profile.id, models, defaultModel })
        } catch (error) {
          return response({ error: { code: 'AGENT_CONNECTION_FAILED', message: error instanceof Error ? error.message : String(error) } }, 400)
        }
      }
      return response({ error: { code: 'INVALID_AGENT_ACTION', message: '不支持的 Agent 配置操作' } }, 400)
    }

    if (url.pathname === '/api/game-agent/status') {
      const current = settings()
      const models = cachedModels(current.profiles)
      const tasks =
        input.agentTask && input.connected
          ? ((await taskCall({ type: 'agent.task.status', requestId: crypto.randomUUID() }).catch(() => [])) as Array<{
              id: string
              conversationId: string
              capability: string
              state: string
              goal: string
              lastSeq: number
              updatedAt: number
            }>)
          : []
      const latest = tasks.at(-1)
      const active = [...tasks].reverse().find((task) => !['completed', 'stopped', 'failed', 'interrupted'].includes(task.state))
      return response({
        ok: true,
        available: Object.values(models).some((items) => items.length > 0),
        gameOnline: input.connected,
        profiles: current.profiles.map((profile) => ({
          id: profile.id,
          label: profile.label,
          provider: profile.provider,
          online: Boolean(models[profile.id]?.length),
          models: models[profile.id] || [],
          defaultModel: pickAvailableModel(models[profile.id] || [], profile.defaultModel),
          reason: models[profile.id]?.length ? null : '未读取到可用模型，请检查服务地址',
        })),
        defaultProfileId: current.profiles[0]?.id || '',
        session: active
          ? {
              id: active.conversationId,
              profileId: '',
              activeTurnId: active.id,
              activeTurn: { id: active.id, state: active.state, capability: active.capability, goal: active.goal, lastSeq: active.lastSeq },
            }
          : latest
            ? { id: latest.conversationId, profileId: '', activeTurnId: null, recentTurnId: latest.id }
            : runtime.latestSession()
              ? { id: runtime.latestSession()!.id, profileId: '', activeTurnId: null }
              : null,
        reason: Object.values(models).some((items) => items.length > 0) ? null : '未读取到可用模型，请检查服务地址',
      })
    }

    if (url.pathname === '/api/game-agent/activity') {
      const taskId = url.searchParams.get('taskId')?.trim()
      const gameId = url.searchParams.get('gameId')?.trim()
      if (method === 'DELETE') {
        if (taskId) {
          const task = await browserAgentTraceArchive.read(taskId)
          if (!task || (gameId && task.gameId !== gameId)) return response({ removed: 0 })
        }
        return response({ removed: await browserAgentTraceArchive.remove(taskId || undefined) })
      }
      if (method === 'GET' && !taskId) {
        const tasks = await browserAgentTraceArchive.list()
        return response({ tasks: gameId ? tasks.filter((task) => task.gameId === gameId) : tasks })
      }
      if (method === 'GET' && taskId) {
        const task = await browserAgentTraceArchive.read(taskId)
        if (!task || (gameId && task.gameId !== gameId)) return response({ error: { message: 'Agent 轨迹不存在' } }, 404)
        if (url.searchParams.get('format') === 'jsonl') {
          const exported = await browserAgentTraceArchive.export(taskId)
          return new Response(exported?.content || '', {
            status: exported ? 200 : 404,
            headers: exported ? { 'Content-Type': exported.mimeType, 'Content-Disposition': `attachment; filename="${exported.filename}"` } : undefined,
          })
        }
        return response({ task })
      }
    }

    if (url.pathname === '/api/game-agent/turn' && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as {
        gameId?: string
        profileId?: string
        model?: string
        prompt?: string
        locale?: string
        surface?: 'companion'
        companionCharacter?: import('@/lib/game-agent/companion').CompanionCharacter
        sessionId?: string
        newSession?: boolean
      }
      const profile = settings().profiles.find((item) => item.id === body.profileId)
      if (!profile || !body.model?.trim() || !body.prompt?.trim()) {
        return response({ error: { code: 'INVALID_AGENT_TURN', message: '平台、模型和消息不能为空' } }, 400)
      }
      if (input.connected && input.agentTask) {
        const tasks = (await taskCall({ type: 'agent.task.status', requestId: crypto.randomUUID() }, init?.signal || undefined).catch(() => [])) as Array<{ state?: string }>
        if (tasks.some((task) => task.state && !['completed', 'stopped', 'failed', 'interrupted'].includes(task.state))) {
          return response({ error: { code: 'AGENT_TURN_RUNNING', message: '当前游戏已有 Agent 任务在运行，请先停止' } }, 409)
        }
      }
      const intent = await classifyPlay(profile, body.model.trim(), body.prompt.trim(), init?.signal || undefined)
      if (intent.operate || (body.surface === 'companion' && input.connected && input.agentTask)) {
        if (!input.connected) return response({ error: { code: 'GAME_OFFLINE', message: '托管需要先连接游戏' } }, 409)
        return remoteTaskStream(
          {
            gameId: body.gameId || '',
            prompt: body.prompt.trim(),
            sessionId: body.sessionId,
            profileId: profile.id,
            model: body.model.trim(),
            locale: body.locale,
            capability: intent.operate ? 'play' : 'companion',
            ...(intent.operate && intent.shape ? { shape: intent.shape as 'single' | 'batch' | 'open' } : {}),
            surface: body.surface,
            companionCharacter: body.companionCharacter,
          },
          init?.signal || undefined
        )
      }
      const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : ''
      const abort = new AbortController()
      init?.signal?.addEventListener('abort', () => abort.abort(init.signal?.reason), { once: true })
      const turns = gameTurns.get(gameId) ?? new Set<AbortController>()
      gameTurns.set(gameId, turns)
      turns.add(abort)
      const release = () => {
        turns.delete(abort)
        if (!turns.size && gameTurns.get(gameId) === turns) gameTurns.delete(gameId)
      }
      return releaseOnEnd(
        runtime.start({
          profile,
          gameId: input.connected ? body.gameId || '' : '',
          model: body.model.trim(),
          prompt: body.prompt.trim(),
          locale: body.locale || 'zh-CN',
          surface: body.surface,
          companionCharacter: body.companionCharacter,
          sessionId: body.sessionId,
          newSession: body.newSession,
          signal: abort.signal,
        }),
        release
      )
    }

    if (url.pathname === '/api/integration/game-agent/tools') {
      if (method === 'GET') return response({ ok: true, settings: readCachedToolSettings() })
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body || '{}')) as { settings?: unknown; patch?: Record<string, unknown> }
        const next = normalizeToolSettings(body.patch ? { ...readCachedToolSettings(), ...body.patch } : body.settings)
        cacheToolSettings(next)
        return response({ ok: true, settings: next })
      }
    }

    if (url.pathname === '/api/game-agent/turn' && method === 'DELETE') {
      const gameId = url.searchParams.get('gameId')?.trim() || ''
      if (!gameId) return response({ error: { code: 'GAME_ID_REQUIRED', message: '缺少 gameId' } }, 400)
      const turns = [...(gameTurns.get(gameId) ?? [])]
      gameTurns.delete(gameId)
      for (const turn of turns) turn.abort(new DOMException('Stopped', 'AbortError'))
      let cleared = turns.length
      if (input.agentTask && input.connected) {
        const result = (await taskCall({ type: 'agent.task.clear', requestId: crypto.randomUUID() }).catch(() => null)) as { cleared?: number } | null
        cleared += result?.cleared || 0
        remoteTurns.clear()
      }
      return response({ ok: true, cleared })
    }

    const eventsMatch = url.pathname.match(/^\/api\/game-agent\/turn\/([^/]+)\/events$/)
    if (eventsMatch && method === 'GET' && input.agentTask) {
      const taskId = decodeURIComponent(eventsMatch[1])
      const known = remoteTurns.get(taskId)
      const status =
        known ||
        ((await taskCall({ type: 'agent.task.status', requestId: crypto.randomUUID(), taskId }, init?.signal || undefined)) as { conversationId?: string; gameId?: string } | null)
      if (!status) return response({ error: { message: 'Agent 任务不存在' } }, 404)
      const conversationId = 'sessionId' in status ? status.sessionId : status.conversationId || ''
      return taskEventStream(taskId, conversationId, init?.signal || undefined, Number(url.searchParams.get('after')) || 0)
    }

    const replyMatch = url.pathname.match(/^\/api\/game-agent\/turn\/([^/]+)\/reply$/)
    if (replyMatch && method === 'POST' && input.agentTask) {
      const body = JSON.parse(String(init?.body || '{}')) as { reply?: string; replyId?: string }
      if (!body.reply?.trim()) return response({ error: { message: '回复不能为空' } }, 400)
      const data = await taskCall(
        { type: 'agent.task.reply', requestId: body.replyId || crypto.randomUUID(), taskId: decodeURIComponent(replyMatch[1]), text: body.reply.trim() },
        init?.signal || undefined
      )
      return response({ ok: true, task: data })
    }

    const stopMatch = url.pathname.match(/^\/api\/game-agent\/turn\/([^/]+)$/)
    if (stopMatch && method === 'DELETE') {
      const taskId = decodeURIComponent(stopMatch[1])
      if (remoteTurns.has(taskId)) {
        await taskCall({ type: 'agent.task.stop', requestId: crypto.randomUUID(), taskId }, init?.signal || undefined)
        remoteTurns.delete(taskId)
        return response({ ok: true })
      }
      return response({ ok: runtime.stop(taskId) })
    }

    return response({ error: { code: 'NOT_FOUND', message: '不支持的 Agent 请求' } }, 404)
  }
}
