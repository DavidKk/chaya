const chayaFetch = jest.fn()

jest.mock('@/plugins/src/helpers', () => ({
  chayaFetch: (...args: unknown[]) => chayaFetch(...args),
  createLogger: () => ({ info: jest.fn(), ok: jest.fn(), warn: jest.fn(), fail: jest.fn() }),
  detectGameIdentity: () => null,
  gameRoomId: () => 'game-a',
}))
jest.mock('@/plugins/src/agent/handlers', () => ({ readAgentGameState: () => ({}), runAgentCommand: jest.fn() }))
jest.mock('@/plugins/src/agent/runtime/store', () => ({ createGameAgentTaskStore: () => ({ load: async () => [], save: async () => undefined }) }))

import { createGameAgentRuntime } from '@/plugins/src/agent/runtime/host'

const values = new Map<string, string>()
const config = {
  version: 1,
  defaultProfileId: 'local',
  profiles: [{ id: 'local', label: 'Local', provider: 'ollama', endpoint: 'http://127.0.0.1:11434', defaultModel: 'qwen', temperature: 0.2, keepAlive: '10m' }],
}
const classify = { type: 'agent.task.classify' as const, requestId: 'r1', gameId: 'game-a', profileId: 'local', model: 'qwen', prompt: '在吗' }
const modelQueue: unknown[] = []

function installFetchRouter() {
  chayaFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/game-agent/activity')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    if (String(url).includes('/api/game-agent/model')) {
      const next = modelQueue.shift()
      if (next instanceof Error) throw next
      if (next && typeof next === 'object' && 'status' in next) {
        const payload = next as { status: number; body: unknown }
        return new Response(JSON.stringify(payload.body), { status: payload.status })
      }
      return new Response(JSON.stringify({ message: next }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: { message: `unexpected fetch ${url}` } }), { status: 500 })
  })
}

function enqueueModel(...messages: unknown[]) {
  modelQueue.push(...messages)
}

function modelCalls() {
  return chayaFetch.mock.calls.filter(([url]) => String(url).includes('/api/game-agent/model'))
}

beforeAll(() => {
  Object.assign(globalThis, {
    window: globalThis,
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
  })
})

beforeEach(() => {
  values.clear()
  values.set('chaya.agent.runtimeConfig.v1', JSON.stringify(config))
  modelQueue.length = 0
  chayaFetch.mockReset()
  installFetchRouter()
})

afterEach(() => jest.useRealTimers())

it('classifies with a structured schema so the model names the action before deciding', async () => {
  enqueueModel({ role: 'assistant', content: '{"action":"interact","operate":true}' })
  await expect(createGameAgentRuntime().request({ ...classify, prompt: '帮我跟页面中可交互的物品交互一下' })).resolves.toEqual({
    capability: 'play',
    shape: 'open',
    action: 'interact',
  })
  const body = JSON.parse(String(modelCalls()[0][1]?.body))
  expect(body.format).toMatchObject({ required: ['action', 'operate'] })
  expect(body.messages[1].content).toContain('"request":"帮我跟页面中可交互的物品交互一下"')

  enqueueModel({ role: 'assistant', content: 'operate=true' })
  await expect(createGameAgentRuntime().request({ ...classify, requestId: 'r2' })).resolves.toEqual({ capability: 'ask', shape: undefined, action: null })
})

it('fails at once when the Chaya service reports a model error instead of retrying', async () => {
  enqueueModel({ status: 502, body: { error: { code: 'AGENT_MODEL_FAILED', message: '无法连接 Ollama' } } })
  await expect(createGameAgentRuntime().request(classify)).rejects.toThrow('无法连接 Ollama')
  expect(modelCalls()).toHaveLength(1)
})

it('waits for slow Ollama generation without restarting it at the short request timeout', async () => {
  jest.useFakeTimers()
  chayaFetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (!String(url).includes('/api/game-agent/model')) return new Response('{}')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 35_000)
      options?.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(options.signal?.reason)
        },
        { once: true }
      )
    })
    return new Response(JSON.stringify({ message: { role: 'assistant', content: '{"operate":false}' } }))
  })
  const result = createGameAgentRuntime().request(classify)
  const assertion = expect(result).resolves.toMatchObject({ capability: 'ask' })
  await jest.advanceTimersByTimeAsync(35_000)
  await assertion
  expect(modelCalls()).toHaveLength(1)
})

it('sends only one model request when several callers hit a failing model at once, then cools down', async () => {
  jest.useFakeTimers()
  chayaFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/game-agent/activity')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response(JSON.stringify({ error: { code: 'AGENT_MODEL_FAILED', message: '无法连接 Ollama' } }), { status: 502 })
  })
  const runtime = createGameAgentRuntime()
  const results = await Promise.allSettled(Array.from({ length: 7 }, (_, index) => runtime.request({ ...classify, requestId: `r${index}` })))
  expect(results.every((result) => result.status === 'rejected' && String(result.reason).includes('无法连接 Ollama'))).toBe(true)
  expect(modelCalls()).toHaveLength(1)

  await expect(runtime.request({ ...classify, requestId: 'again' })).rejects.toThrow('无法连接 Ollama')
  expect(modelCalls()).toHaveLength(1)
  await jest.advanceTimersByTimeAsync(15_000)
  await expect(runtime.request({ ...classify, requestId: 'later' })).rejects.toThrow('无法连接 Ollama')
  expect(modelCalls()).toHaveLength(2)
})

describe('chaya_player_card tool', () => {
  const start = { type: 'agent.task.start' as const, requestId: 's1', deadlineAt: Date.now() + 60_000, gameId: 'game-a', conversationId: 'c1', profileId: 'local', model: 'qwen' }
  const cardCall = (args: Record<string, unknown>) => ({ role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'chaya_player_card', arguments: args } }] })
  const waitFor = async (check: () => boolean) => {
    for (let index = 0; index < 50 && !check(); index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(check()).toBe(true)
  }
  const toolResultSentToModel = () => {
    const body = JSON.parse(String(modelCalls().at(-1)![1]?.body)) as { messages: { role: string; tool_name?: string; content: string }[] }
    return JSON.parse(body.messages.find((message) => message.role === 'tool' && message.tool_name === 'chaya_player_card')!.content)
  }

  it('waits for the player to pick on a confirm card and hands the choice back to the model', async () => {
    enqueueModel(cardCall({ kind: 'confirm', text: '要我帮你去拿宝箱吗？' }), { role: 'assistant', content: '那我们走吧' })
    const runtime = createGameAgentRuntime()
    await runtime.request({ ...start, taskId: 'task-confirm', capability: 'companion', goal: '附近有宝箱' })
    await waitFor(() => runtime.controller.get('task-confirm')?.state === 'waiting_user')
    const approval = runtime.controller.get('task-confirm')!.events.find((event) => event.type === 'approval.required')
    expect(approval?.data).toEqual({
      question: '要我帮你去拿宝箱吗？',
      card: {
        kind: 'confirm',
        text: '要我帮你去拿宝箱吗？',
        options: [
          { id: 'yes', label: '' },
          { id: 'no', label: '' },
        ],
      },
    })

    await runtime.request({ type: 'agent.task.reply', requestId: 'reply-1', taskId: 'task-confirm', text: 'yes' })
    await waitFor(() => runtime.controller.get('task-confirm')?.state === 'completed')
    expect(toolResultSentToModel()).toMatchObject({ answered: true, choice: 'yes' })
  })

  it('shows a notice card without waiting for the player', async () => {
    enqueueModel(cardCall({ kind: 'notice', text: '前面有陷阱', tone: 'warn' }), { role: 'assistant', content: '小心哦' })
    const runtime = createGameAgentRuntime()
    await runtime.request({ ...start, taskId: 'task-notice', capability: 'ask', goal: '前面有什么' })
    await waitFor(() => runtime.controller.get('task-notice')?.state === 'completed')
    const shown = runtime.controller.get('task-notice')!.events.find((event) => event.type === 'card.shown')
    expect(shown?.data).toEqual({ card: { kind: 'notice', text: '前面有陷阱', tone: 'warn', options: [] } })
    expect(runtime.controller.get('task-notice')!.events.some((event) => event.type === 'approval.required')).toBe(false)
  })
})

it('keeps earlier turns out of the prompt and serves them through chaya_agent_recall', async () => {
  const start = {
    type: 'agent.task.start' as const,
    deadlineAt: Date.now() + 60_000,
    gameId: 'game-a',
    conversationId: 'c1',
    profileId: 'local',
    model: 'qwen',
    capability: 'companion' as const,
  }
  const sent = (index: number) => (JSON.parse(String(modelCalls()[index][1]?.body)) as { messages: { role: string; content: string }[] }).messages
  const waitDone = async (runtime: ReturnType<typeof createGameAgentRuntime>, taskId: string) => {
    for (let index = 0; index < 50 && runtime.controller.get(taskId)?.state !== 'completed'; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.controller.get(taskId)?.state).toBe('completed')
  }
  const runtime = createGameAgentRuntime()

  enqueueModel({ role: 'assistant', content: '宝箱打开了，拿到 30 金币。' })
  await runtime.request({ ...start, requestId: 's1', taskId: 'task-1', goal: '帮我开宝箱' })
  await waitDone(runtime, 'task-1')

  enqueueModel(
    { role: 'assistant', content: '', tool_calls: [{ id: 'r1', function: { name: 'chaya_agent_recall', arguments: {} } }] },
    { role: 'assistant', content: '刚才拿到了 30 金币。' }
  )
  await runtime.request({ ...start, requestId: 's2', taskId: 'task-2', goal: '刚才拿到了什么？' })
  await waitDone(runtime, 'task-2')

  expect(JSON.stringify(sent(1))).not.toContain('30 金币')
  const recalled = JSON.parse(sent(2).find((message) => message.role === 'tool' && message.content.includes('"turns"'))!.content)
  expect(recalled).toMatchObject({ count: 1, turns: [{ id: 'task-1', request: '帮我开宝箱', reply: '宝箱打开了，拿到 30 金币。' }] })
  await expect(runtime.request({ type: 'agent.task.recall', requestId: 'q1', query: '金币', limit: 8 })).resolves.toMatchObject({
    count: 2,
    turns: [{ request: '刚才拿到了什么？' }, { request: '帮我开宝箱' }],
  })
})

it('backs off between retries while the Chaya service is unreachable', async () => {
  jest.useFakeTimers()
  let modelAttempts = 0
  chayaFetch.mockImplementation(async (url: string) => {
    if (String(url).includes('/api/game-agent/activity')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    modelAttempts += 1
    if (modelAttempts < 3) throw new Error('ECONNREFUSED')
    return new Response(JSON.stringify({ message: { role: 'assistant', content: '{"operate":false}' } }), { status: 200 })
  })
  const result = createGameAgentRuntime().request(classify)
  await jest.advanceTimersByTimeAsync(0)
  expect(modelAttempts).toBe(1)
  await jest.advanceTimersByTimeAsync(2_000)
  expect(modelAttempts).toBe(2)
  await jest.advanceTimersByTimeAsync(2_000)
  expect(modelAttempts).toBe(2)
  await jest.advanceTimersByTimeAsync(2_000)
  expect(modelAttempts).toBe(3)
  await expect(result).resolves.toEqual({ capability: 'ask', shape: undefined, action: null })
})
