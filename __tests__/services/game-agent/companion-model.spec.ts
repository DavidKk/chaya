import { completeCompanionModel } from '@/services/game-agent/companion-model.server'
import { prepareCompanionOllama } from '@/services/game-agent/companion-ollama'
import { resetCompanionResourcesForTests } from '@/services/game-agent/companion-resource.server'
import type { CompanionModelEvent, CompanionModelPurpose } from '@/services/game-agent/companion-types.server'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { completeOpenAiChat } from '@/services/game-agent/openai-client'
import type { GameAgentProfile } from '@/services/game-agent/settings'
import { appendLog } from '@/services/log'

jest.mock('@/services/game-agent/anthropic-client', () => ({ completeAnthropicChat: jest.fn(), usesAnthropicApi: () => false }))
jest.mock('@/services/game-agent/gemini-client', () => ({ completeGeminiChat: jest.fn(), usesGeminiOpenAiCompat: () => false }))
jest.mock('@/services/game-agent/cli/complete.server', () => ({ completeWithCli: jest.fn() }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/companion-ollama', () => ({ COMPANION_KEEP_ALIVE: -1, prepareCompanionOllama: jest.fn() }))
jest.mock('@/services/log', () => ({ appendLog: jest.fn() }))
jest.mock('@/services/game-agent/openai-client', () => ({ completeOpenAiChat: jest.fn(), openApiGatewayRequestHeaders: () => ({}) }))
jest.mock('@/services/game-agent/proxy/agent-proxy', () => ({ ollamaFetch: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: () => '' }))
jest.mock('@/services/game-agent/companion-resource-settings.server', () => ({
  readCompanionResourcePolicy: () => ({ capacity: 1, maxRunningPerInstance: 1, maxQueuedPerInstance: 4 }),
}))

const profile = { id: 'p1', provider: 'ollama', endpoint: 'http://localhost:11434', temperature: 0.5 } as GameAgentProfile
beforeEach(() => {
  resetCompanionResourcesForTests()
  jest.mocked(prepareCompanionOllama).mockResolvedValue({ residency: 'warm', startupMs: 0 })
  jest.mocked(streamOllamaChat).mockResolvedValue({ role: 'assistant', content: 'ok' })
  jest.mocked(completeOpenAiChat).mockResolvedValue({ role: 'assistant', content: 'ok' })
})

test.each<[CompanionModelPurpose, number, number, boolean]>([
  ['companion-route', 128, 5_000, false],
  ['companion-chat', 256, 15_000, false],
  ['companion-prepare', 384, 10_000, false],
  ['companion-tactic-quick', 768, 6_000, false],
  ['companion-tactic-deep', 768, 25_000, true],
])('%s uses its own inference budget and thinking policy', async (purpose, tokens, timeout, think) => {
  const events: CompanionModelEvent[] = []
  await completeCompanionModel(profile, {
    model: 'small',
    purpose,
    requestId: purpose,
    think,
    messages: [{ role: 'user', content: 'bounded task' }],
    conversationKey: JSON.stringify(['battle', 'inst-1', purpose]),
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  })
  const upstream = jest.mocked(streamOllamaChat).mock.calls[0][0]
  expect(upstream).toMatchObject({ maxTokens: tokens, think, keepAlive: -1 })
  expect(upstream.timeoutMs).toBeLessThanOrEqual(timeout)
  expect(upstream.timeoutMs).toBeGreaterThan(timeout - 1_000)
  expect(events).toContainEqual(expect.objectContaining({ type: 'started', thinking: expect.objectContaining({ requested: !think }) }))
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'completed',
      text: 'ok',
      contextMs: expect.any(Number),
      waitedMs: expect.any(Number),
      generationMs: expect.any(Number),
    })
  )
})

test('cold startup has a separate allowance, reports progress and leaves the short generation budget intact', async () => {
  let clock = 1_000
  jest.spyOn(Date, 'now').mockImplementation(() => clock)
  jest.mocked(prepareCompanionOllama).mockImplementation(async (input) => {
    input.onStatus?.({ phase: 'loading', residency: 'cold' })
    clock += 12_000
    input.onStatus?.({ phase: 'ready', residency: 'cold', startupMs: 12_000 })
    return { residency: 'cold', startupMs: 12_000 }
  })
  const events: CompanionModelEvent[] = []
  await completeCompanionModel(profile, {
    model: 'small',
    purpose: 'companion-route',
    requestId: 'cold',
    messages: [{ role: 'user', content: 'go' }],
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
  })
  expect(jest.mocked(streamOllamaChat).mock.calls[0][0].timeoutMs).toBe(5_000)
  expect(events).toContainEqual(expect.objectContaining({ type: 'model.status', phase: 'loading', residency: 'cold' }))
  expect(events).toContainEqual(expect.objectContaining({ type: 'completed', startupMs: 12_000, generationMs: 0, residency: 'cold' }))
  expect(appendLog).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Model completed',
      meta: expect.objectContaining({ requestId: 'cold', startupMs: 12_000, queueMs: 0, generationMs: 0 }),
    })
  )
  expect(JSON.stringify(jest.mocked(appendLog).mock.calls)).not.toContain('"messages"')
})

test('explicit readiness waits under the resource lease without generating a model reply', async () => {
  await completeCompanionModel(profile, { model: 'small', purpose: 'companion-warmup', requestId: 'warm', messages: [], signal: new AbortController().signal })
  expect(prepareCompanionOllama).toHaveBeenCalledTimes(1)
  expect(streamOllamaChat).not.toHaveBeenCalled()
})

test('an interrupted cold load reports elapsed startup time and releases its slot after settlement', async () => {
  let clock = 1_000
  jest.spyOn(Date, 'now').mockImplementation(() => clock)
  jest.mocked(prepareCompanionOllama).mockImplementation(async (input) => {
    input.onStatus?.({ phase: 'loading', residency: 'cold' })
    clock += 7_000
    throw new DOMException('Request cancelled', 'AbortError')
  })
  await expect(
    completeCompanionModel(profile, {
      model: 'small',
      purpose: 'companion-chat',
      requestId: 'interrupted-load',
      messages: [],
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({ error: { code: 'CANCELLED' } })
  expect(appendLog).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Model failed',
      meta: expect.objectContaining({ startupMs: 7_000, residency: 'cold', totalMs: 7_000 }),
    })
  )
  expect(streamOllamaChat).not.toHaveBeenCalled()
  jest.mocked(prepareCompanionOllama).mockResolvedValue({ residency: 'warm', startupMs: 0 })
  await expect(
    completeCompanionModel(profile, {
      model: 'small',
      purpose: 'companion-chat',
      requestId: 'after-cancel',
      messages: [],
      signal: new AbortController().signal,
    })
  ).resolves.toMatchObject({ content: 'ok' })
})

test('overflow rejects before scheduling or contacting the model', async () => {
  await expect(
    completeCompanionModel(profile, {
      model: 'small',
      purpose: 'companion-tactic-quick',
      requestId: 'oversized',
      messages: [
        { role: 'system', content: 'must preserve' },
        { role: 'user', content: 'x'.repeat(12_000) },
      ],
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({ error: { code: 'REQUEST_CONFLICT', retryable: false } })
  expect(streamOllamaChat).not.toHaveBeenCalled()
})

test('failed generation retains queue, startup and first-token timings without logging partial text', async () => {
  let clock = 1_000
  jest.spyOn(Date, 'now').mockImplementation(() => clock)
  jest.mocked(prepareCompanionOllama).mockImplementation(async () => {
    clock += 100
    return { residency: 'warm', startupMs: 100 }
  })
  jest.mocked(streamOllamaChat).mockImplementation(async (_input, onDelta) => {
    clock += 200
    onDelta('private partial reply')
    clock += 300
    throw new Error('Generation disconnected')
  })
  await expect(
    completeCompanionModel(profile, {
      model: 'small',
      purpose: 'companion-chat',
      requestId: 'generation-failed',
      messages: [],
      signal: new AbortController().signal,
    })
  ).rejects.toMatchObject({ error: { code: 'MODEL_UNAVAILABLE' } })
  expect(appendLog).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Model failed',
      meta: expect.objectContaining({ queueMs: 0, startupMs: 100, generationMs: 500, firstTokenMs: 300, totalMs: 600 }),
    })
  )
  expect(JSON.stringify(jest.mocked(appendLog).mock.calls)).not.toContain('private partial reply')
})

test('prompt-only thinking hint counts toward the same context budget', async () => {
  const api = { ...profile, provider: 'codex-api', endpoint: 'https://example.test' } as GameAgentProfile
  const generate = (length: number) =>
    completeCompanionModel(api, {
      model: 'small',
      purpose: 'companion-chat',
      requestId: String(length),
      messages: [{ role: 'user', content: 'x'.repeat(length) }],
      signal: new AbortController().signal,
    })
  await generate(12_000 - '/no_think\n'.length)
  const messages = jest.mocked(completeOpenAiChat).mock.calls[0][0].messages
  expect(messages.reduce((sum, message) => sum + message.content.length, 0)).toBe(12_000)
  await expect(generate(12_000)).rejects.toMatchObject({ error: { code: 'REQUEST_CONFLICT' } })
  expect(completeOpenAiChat).toHaveBeenCalledTimes(1)
})
