import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { cliModelChoices, isCliProvider } from '@/lib/game-agent/providers'
import type { AgentRoutine, AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentSyncSettings } from '@/lib/game-agent/settings-sync'
import type { AgentTaskMessage } from '@/lib/runtime/game-link-protocol'

type TaskCall = (message: Exclude<AgentTaskMessage, { type: 'agent.task.result' }>, signal?: AbortSignal) => Promise<unknown>
type AgentModels = Record<string, Array<{ name: string; label?: string }>>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function taskCall(): TaskCall | null {
  return (window as Window & { ChayaAgent?: { taskRequest?: TaskCall } }).ChayaAgent?.taskRequest ?? null
}

function wait(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = window.setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function terminal(state: string) {
  return ['completed', 'stopped', 'failed', 'interrupted'].includes(state)
}

function eventPayload(event: AgentTaskEvent) {
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  if (event.type === 'assistant.completed') return { type: 'assistant.delta', seq: event.seq, text: (data as { text?: unknown }).text || '' }
  return { type: event.type, seq: event.seq, ...data }
}

function taskStream(call: TaskCall, taskId: string, sessionId: string, signal?: AbortSignal | null, initialSeq = 0) {
  const encoder = new TextEncoder()
  const subscription = new AbortController()
  const pollingSignal = signal ? AbortSignal.any([signal, subscription.signal]) : subscription.signal
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let seq = initialSeq
        let closed = false
        const emit = (event: Record<string, unknown>) => {
          if (!closed) controller.enqueue(encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`))
        }
        emit({ type: 'turn.started', turnId: taskId, sessionId })
        try {
          while (!pollingSignal.aborted) {
            const result = (await call({ type: 'agent.task.events', requestId: crypto.randomUUID(), taskId, afterSeq: seq }, pollingSignal)) as {
              gap: boolean
              task: AgentTask
              events: AgentTaskEvent[]
            }
            if (result.gap) emit({ type: 'history.gap', fromSeq: seq + 1 })
            for (const event of result.events || []) {
              seq = Math.max(seq, event.seq)
              emit(eventPayload(event))
            }
            if (terminal(result.task.state)) {
              if (result.task.state === 'completed') emit({ type: 'turn.completed', reason: 'answered' })
              else if (result.task.state === 'stopped') emit({ type: 'turn.stopped' })
              else emit({ type: 'turn.failed', message: result.task.error || (result.task.state === 'interrupted' ? '游戏重载，任务已中断' : 'Agent 任务失败') })
              break
            }
            await wait(300, pollingSignal)
          }
        } catch (error) {
          if (!pollingSignal.aborted) emit({ type: 'turn.failed', message: error instanceof Error ? error.message : String(error) })
        } finally {
          closed = true
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

function profileStatus(settings: AgentSyncSettings | null, cached: AgentModels = {}) {
  return (settings?.profiles || []).map((profile) => {
    if (isCliProvider(profile.provider)) {
      return { id: profile.id, label: profile.label, provider: profile.provider, online: true, ...cliModelChoices(profile.defaultModel, cached[profile.id]), reason: null }
    }
    const models = cached[profile.id]?.length ? cached[profile.id] : profile.defaultModel ? [{ name: profile.defaultModel }] : []
    const defaultModel = models.some((model) => model.name === profile.defaultModel) ? profile.defaultModel : models[0]?.name || ''
    return {
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      online: models.length > 0,
      models,
      defaultModel,
      reason: models.length ? null : '尚未读取到可用模型',
    }
  })
}

type TurnBody = {
  gameId: string
  profileId: string
  model: string
  prompt: string
  sessionId?: string
  locale?: string
  surface?: 'companion'
  companionCharacter?: string
  thinking?: boolean
  routine?: AgentRoutine
}

/** The model decides whether free text operates the game; only explicit UI routines skip it. */
async function classify(call: TaskCall, body: TurnBody, signal?: AbortSignal | null) {
  const classified = (await call(
    { type: 'agent.task.classify', requestId: crypto.randomUUID(), gameId: body.gameId, profileId: body.profileId, model: body.model, prompt: body.prompt },
    signal || undefined
  )) as { capability?: 'play' | 'ask'; shape?: 'single' | 'batch' | 'open' }
  const capability = classified.capability === 'play' ? ('play' as const) : body.surface === 'companion' ? ('companion' as const) : ('ask' as const)
  return { capability, shape: classified.capability === 'play' ? classified.shape : undefined }
}

async function startTask(call: TaskCall, body: TurnBody, signal?: AbortSignal | null) {
  const taskId = crypto.randomUUID()
  const conversationId = body.sessionId || crypto.randomUUID()
  const routine = body.routine
  const classified = routine ? { capability: 'play' as const, shape: undefined } : await classify(call, body, signal)
  await call(
    {
      type: 'agent.task.start',
      requestId: crypto.randomUUID(),
      deadlineAt: Date.now() + 60_000,
      taskId,
      gameId: body.gameId,
      conversationId,
      capability: classified.capability,
      profileId: body.profileId,
      model: body.model,
      locale: body.locale,
      companionCharacter: body.companionCharacter,
      surface: body.surface || 'sidebar',
      thinking: body.thinking === true,
      ...(classified.shape ? { shape: classified.shape } : {}),
      ...(routine ? { routine } : {}),
      goal: body.prompt,
    },
    signal || undefined
  )
  return { taskId, conversationId }
}

/** Fetch-shaped adapter used by the in-game React panels. Agent task traffic never leaves the game process. */
export function createDirectGameAgentRequest(readSettings: () => AgentSyncSettings | null, readModels: () => AgentModels = () => ({})): GameAgentRequest {
  return async (path, init) => {
    const call = taskCall()
    if (!call) return json({ error: { code: 'AGENT_RUNTIME_UNAVAILABLE', message: '游戏内 Agent 任务宿主未就绪' } }, 503)
    const url = new URL(path, location.origin)
    const method = (init?.method || 'GET').toUpperCase()

    if (url.pathname === '/api/game-agent/status') {
      const tasks = (await call({ type: 'agent.task.status', requestId: crypto.randomUUID() }, init?.signal || undefined)) as AgentTask[]
      const latest = tasks.at(-1)
      const active = [...tasks].reverse().find((task) => !terminal(task.state))
      const settings = readSettings()
      const profiles = profileStatus(settings, readModels())
      const available = profiles.some((profile) => profile.online)
      return json({
        ok: true,
        available,
        gameOnline: true,
        profiles,
        defaultProfileId: settings?.defaultProfileId || profiles[0]?.id || '',
        session: active
          ? {
              id: active.conversationId,
              profileId: active.profileId,
              activeTurnId: active.id,
              recentTurnId: active.id,
              activeTurn: { id: active.id, state: active.state, capability: active.capability, goal: active.goal, lastSeq: active.lastSeq },
            }
          : latest
            ? { id: latest.conversationId, profileId: latest.profileId, activeTurnId: null, recentTurnId: latest.id, activeTurn: null }
            : null,
        reason: available ? null : '请先配置 Agent 并选择模型',
      })
    }

    if (url.pathname === '/api/game-agent/activity' && method === 'GET') {
      const taskId = url.searchParams.get('taskId')?.trim()
      if (taskId && url.searchParams.get('format') === 'jsonl') {
        const exported = (await call({ type: 'agent.trace.export', requestId: crypto.randomUUID(), taskId }, init?.signal || undefined)) as {
          filename: string
          mimeType: string
          content: string
        } | null
        return exported
          ? new Response(exported.content, { headers: { 'Content-Type': exported.mimeType, 'Content-Disposition': `attachment; filename="${exported.filename}"` } })
          : json({ error: { message: 'Agent 轨迹不存在' } }, 404)
      }
      if (taskId) {
        const task = (await call({ type: 'agent.trace.read', requestId: crypto.randomUUID(), taskId }, init?.signal || undefined)) as AgentTask | null
        return task ? json({ task }) : json({ error: { message: 'Agent 轨迹不存在' } }, 404)
      }
      const tasks = await call({ type: 'agent.trace.list', requestId: crypto.randomUUID() }, init?.signal || undefined)
      return json({ tasks })
    }

    if (url.pathname === '/api/game-agent/activity' && method === 'DELETE') {
      const taskId = url.searchParams.get('taskId')?.trim()
      const result = await call({ type: 'agent.trace.remove', requestId: crypto.randomUUID(), taskId: taskId || undefined }, init?.signal || undefined)
      return json({ ok: true, ...(result as object) })
    }

    if (url.pathname === '/api/game-agent/turn' && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as TurnBody
      if (body.routine) {
        if (!body.gameId || !body.prompt?.trim()) return json({ error: { message: 'gameId 和 prompt 不能为空' } }, 400)
      } else if (!body.gameId || !body.profileId || !body.model || !body.prompt?.trim()) {
        return json({ error: { message: 'gameId、profileId、model 和 prompt 不能为空' } }, 400)
      }
      const started = await startTask(call, { ...body, profileId: body.profileId || '', model: body.model || '', prompt: body.prompt.trim() }, init?.signal)
      return taskStream(call, started.taskId, started.conversationId, init?.signal)
    }

    if (url.pathname === '/api/game-agent/turn' && method === 'DELETE') {
      const result = await call({ type: 'agent.task.clear', requestId: crypto.randomUUID() }, init?.signal || undefined)
      return json({ ok: true, ...(result as object) })
    }

    const events = url.pathname.match(/^\/api\/game-agent\/turn\/([^/]+)\/events$/)
    if (events && method === 'GET') {
      const taskId = decodeURIComponent(events[1])
      const task = (await call({ type: 'agent.task.status', requestId: crypto.randomUUID(), taskId }, init?.signal || undefined)) as AgentTask | null
      if (!task) return json({ error: { message: 'Agent 任务不存在' } }, 404)
      return taskStream(call, taskId, task.conversationId, init?.signal, Number(url.searchParams.get('after')) || 0)
    }

    const reply = url.pathname.match(/^\/api\/game-agent\/turn\/([^/]+)\/reply$/)
    if (reply && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as { reply?: string; replyId?: string }
      if (!body.reply?.trim()) return json({ error: { message: '回复不能为空' } }, 400)
      const task = await call(
        { type: 'agent.task.reply', requestId: body.replyId || crypto.randomUUID(), taskId: decodeURIComponent(reply[1]), text: body.reply.trim() },
        init?.signal || undefined
      )
      return json({ ok: true, task })
    }

    const stop = url.pathname.match(/^\/api\/game-agent\/turn\/([^/]+)$/)
    if (stop && method === 'DELETE') {
      const task = await call({ type: 'agent.task.stop', requestId: crypto.randomUUID(), taskId: decodeURIComponent(stop[1]) }, init?.signal || undefined)
      return json({ ok: true, task })
    }

    return json({ error: { code: 'NOT_FOUND', message: '不支持的游戏内 Agent 请求' } }, 404)
  }
}
