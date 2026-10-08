import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import type { AgentTask, AgentTaskEvent } from '@/lib/game-agent/runtime'
import type { AgentSyncSettings } from '@/lib/game-agent/settings-sync'
import type { AgentTaskMessage } from '@/lib/runtime/game-link-protocol'

type TaskCall = (message: Exclude<AgentTaskMessage, { type: 'agent.task.result' }>, signal?: AbortSignal) => Promise<unknown>

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

function profileStatus(settings: AgentSyncSettings | null) {
  return (settings?.profiles || []).map((profile) => ({
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    online: Boolean(profile.defaultModel),
    models: profile.defaultModel ? [{ name: profile.defaultModel }] : [],
    defaultModel: profile.defaultModel,
    reason: profile.defaultModel ? null : '尚未选择模型',
  }))
}

async function startTask(
  call: TaskCall,
  body: { gameId: string; profileId: string; model: string; prompt: string; sessionId?: string; locale?: string; surface?: 'companion'; companionCharacter?: string },
  signal?: AbortSignal | null
) {
  const taskId = crypto.randomUUID()
  const conversationId = body.sessionId || crypto.randomUUID()
  const capability =
    body.surface === 'companion'
      ? 'companion'
      : (
          (await call(
            { type: 'agent.task.classify', requestId: crypto.randomUUID(), gameId: body.gameId, profileId: body.profileId, model: body.model, prompt: body.prompt },
            signal || undefined
          )) as { capability?: 'play' | 'ask' }
        ).capability || 'ask'
  await call(
    {
      type: 'agent.task.start',
      requestId: crypto.randomUUID(),
      deadlineAt: Date.now() + 60_000,
      taskId,
      gameId: body.gameId,
      conversationId,
      capability,
      profileId: body.profileId,
      model: body.model,
      locale: body.locale,
      companionCharacter: body.companionCharacter,
      goal: body.prompt,
    },
    signal || undefined
  )
  return { taskId, conversationId }
}

/** Fetch-shaped adapter used by the in-game React panels. Agent task traffic never leaves the game process. */
export function createDirectGameAgentRequest(readSettings: () => AgentSyncSettings | null): GameAgentRequest {
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
      const profiles = profileStatus(settings)
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

    if (url.pathname === '/api/game-agent/turn' && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as Parameters<typeof startTask>[1]
      if (!body.gameId || !body.profileId || !body.model || !body.prompt?.trim()) return json({ error: { message: 'gameId、profileId、model 和 prompt 不能为空' } }, 400)
      const started = await startTask(call, { ...body, prompt: body.prompt.trim() }, init?.signal)
      return taskStream(call, started.taskId, started.conversationId, init?.signal)
    }

    if (url.pathname === '/api/game-agent/companion' && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as {
        gameId?: string
        text?: string
        cue?: string
        locale?: string
        character?: string
        profileId?: string
        model?: string
      }
      const settings = readSettings()
      const profile = settings?.profiles.find((item) => item.id === body.profileId) || settings?.profiles[0]
      const model = body.model || profile?.defaultModel
      if (!profile || !model) return json({ error: { message: '没有可用的 Agent 模型' } }, 503)
      const prompt = body.text?.trim() || `根据当前游戏状态，对 ${body.cue || '刚刚发生的变化'} 给玩家一句简短自然的陪伴回应。`
      const started = await startTask(
        call,
        { gameId: body.gameId || location.pathname, profileId: profile.id, model, prompt, locale: body.locale, surface: 'companion', companionCharacter: body.character },
        init?.signal
      )
      let seq = 0
      try {
        for (;;) {
          const result = (await call({ type: 'agent.task.events', requestId: crypto.randomUUID(), taskId: started.taskId, afterSeq: seq }, init?.signal || undefined)) as {
            task: AgentTask
            events: AgentTaskEvent[]
          }
          for (const event of result.events || []) {
            seq = Math.max(seq, event.seq)
            if (event.type === 'assistant.completed') return json({ ok: true, text: String((event.data as { text?: unknown })?.text || '') })
          }
          if (terminal(result.task.state)) throw new Error(result.task.error || '旅伴没有返回内容')
          await wait(300, init?.signal)
        }
      } catch (error) {
        void call({ type: 'agent.task.stop', requestId: crypto.randomUUID(), taskId: started.taskId }).catch(() => undefined)
        return json({ error: { message: error instanceof Error ? error.message : String(error) } }, 502)
      }
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
