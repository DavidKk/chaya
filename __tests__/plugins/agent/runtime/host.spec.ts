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

beforeAll(() => {
  Object.assign(globalThis, {
    window: globalThis,
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
  })
})

beforeEach(() => {
  values.clear()
  values.set('chaya.agent.runtimeConfig.v1', JSON.stringify(config))
  chayaFetch.mockReset()
})

afterEach(() => jest.useRealTimers())

it('classifies with a structured schema so the model names the action before deciding', async () => {
  chayaFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: 'assistant', content: '{"action":"interact","operate":true}' } }), { status: 200 }))
  await expect(createGameAgentRuntime().request({ ...classify, prompt: '帮我跟页面中可交互的物品交互一下' })).resolves.toEqual({ capability: 'play' })
  const body = JSON.parse(String(chayaFetch.mock.calls[0][1]?.body))
  expect(body.format).toMatchObject({ required: ['action', 'operate'] })
  expect(body.messages[1].content).toContain('"request":"帮我跟页面中可交互的物品交互一下"')

  chayaFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: 'assistant', content: 'operate=true' } }), { status: 200 }))
  await expect(createGameAgentRuntime().request({ ...classify, requestId: 'r2' })).resolves.toEqual({ capability: 'ask' })
})

it('fails at once when the Chaya service reports a model error instead of retrying', async () => {
  chayaFetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'AGENT_MODEL_FAILED', message: '无法连接 Ollama' } }), { status: 502 }))
  await expect(createGameAgentRuntime().request(classify)).rejects.toThrow('无法连接 Ollama')
  expect(chayaFetch).toHaveBeenCalledTimes(1)
})

it('sends only one model request when several callers hit a failing model at once, then cools down', async () => {
  jest.useFakeTimers()
  chayaFetch.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'AGENT_MODEL_FAILED', message: '无法连接 Ollama' } }), { status: 502 }))
  const runtime = createGameAgentRuntime()
  const results = await Promise.allSettled(Array.from({ length: 7 }, (_, index) => runtime.request({ ...classify, requestId: `r${index}` })))
  expect(results.every((result) => result.status === 'rejected' && String(result.reason).includes('无法连接 Ollama'))).toBe(true)
  expect(chayaFetch).toHaveBeenCalledTimes(1)

  await expect(runtime.request({ ...classify, requestId: 'again' })).rejects.toThrow('无法连接 Ollama')
  expect(chayaFetch).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(15_000)
  await expect(runtime.request({ ...classify, requestId: 'later' })).rejects.toThrow('无法连接 Ollama')
  expect(chayaFetch).toHaveBeenCalledTimes(2)
})

describe('chaya_player_card tool', () => {
  const start = { type: 'agent.task.start' as const, requestId: 's1', deadlineAt: Date.now() + 60_000, gameId: 'game-a', conversationId: 'c1', profileId: 'local', model: 'qwen' }
  const modelReplies = (...messages: unknown[]) => {
    for (const message of messages) chayaFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message }), { status: 200 }))
  }
  const cardCall = (args: Record<string, unknown>) => ({ role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'chaya_player_card', arguments: args } }] })
  const waitFor = async (check: () => boolean) => {
    for (let index = 0; index < 50 && !check(); index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(check()).toBe(true)
  }
  const toolResultSentToModel = () => {
    const body = JSON.parse(String((chayaFetch.mock.calls.at(-1)![1] as RequestInit).body)) as { messages: { role: string; content: string }[] }
    return JSON.parse(body.messages.find((message) => message.role === 'tool')!.content)
  }

  it('waits for the player to pick on a confirm card and hands the choice back to the model', async () => {
    modelReplies(cardCall({ kind: 'confirm', text: '要我帮你去拿宝箱吗？' }), { role: 'assistant', content: '那我们走吧' })
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
    modelReplies(cardCall({ kind: 'notice', text: '前面有陷阱', tone: 'warn' }), { role: 'assistant', content: '小心哦' })
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
  const reply = (message: unknown) => chayaFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message }), { status: 200 }))
  const sent = (index: number) => (JSON.parse(String((chayaFetch.mock.calls[index][1] as RequestInit).body)) as { messages: { role: string; content: string }[] }).messages
  const waitDone = async (runtime: ReturnType<typeof createGameAgentRuntime>, taskId: string) => {
    for (let index = 0; index < 50 && runtime.controller.get(taskId)?.state !== 'completed'; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.controller.get(taskId)?.state).toBe('completed')
  }
  const runtime = createGameAgentRuntime()

  reply({ role: 'assistant', content: '宝箱打开了，拿到 30 金币。' })
  await runtime.request({ ...start, requestId: 's1', taskId: 'task-1', goal: '帮我开宝箱' })
  await waitDone(runtime, 'task-1')

  reply({ role: 'assistant', content: '', tool_calls: [{ id: 'r1', function: { name: 'chaya_agent_recall', arguments: {} } }] })
  reply({ role: 'assistant', content: '刚才拿到了 30 金币。' })
  await runtime.request({ ...start, requestId: 's2', taskId: 'task-2', goal: '刚才拿到了什么？' })
  await waitDone(runtime, 'task-2')

  expect(JSON.stringify(sent(1))).not.toContain('30 金币')
  const recalled = JSON.parse(sent(2).find((message) => message.role === 'tool')!.content)
  expect(recalled).toMatchObject({ count: 1, turns: [{ id: 'task-1', request: '帮我开宝箱', reply: '宝箱打开了，拿到 30 金币。' }] })
  await expect(runtime.request({ type: 'agent.task.recall', requestId: 'q1', query: '金币', limit: 8 })).resolves.toMatchObject({
    count: 2,
    turns: [{ request: '刚才拿到了什么？' }, { request: '帮我开宝箱' }],
  })
})

it('backs off between retries while the Chaya service is unreachable', async () => {
  jest.useFakeTimers()
  chayaFetch
    .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { role: 'assistant', content: '{"operate":false}' } }), { status: 200 }))
  const result = createGameAgentRuntime().request(classify)
  await jest.advanceTimersByTimeAsync(0)
  expect(chayaFetch).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(2_000)
  expect(chayaFetch).toHaveBeenCalledTimes(2)
  await jest.advanceTimersByTimeAsync(2_000)
  expect(chayaFetch).toHaveBeenCalledTimes(2)
  await jest.advanceTimersByTimeAsync(2_000)
  expect(chayaFetch).toHaveBeenCalledTimes(3)
  await expect(result).resolves.toEqual({ capability: 'ask' })
})
