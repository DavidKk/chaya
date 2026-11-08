import { resetCompanionResourcesForTests, scheduleCompanionResource } from '@/services/game-agent/companion-resource.server'
import { readCompanionResourcePolicy } from '@/services/game-agent/companion-resource-settings.server'
import { completeAgentModel } from '@/services/game-agent/model-complete.server'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'
import { completeOpenAiChat } from '@/services/game-agent/openai-client'
import type { GameAgentProfile } from '@/services/game-agent/settings'

jest.mock('@/services/game-agent/companion-resource-settings.server', () => ({ readCompanionResourcePolicy: jest.fn() }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/openai-client', () => ({ completeOpenAiChat: jest.fn(), openApiGatewayRequestHeaders: jest.fn() }))
jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn(() => '') }))

beforeEach(() => {
  jest.clearAllMocks()
  resetCompanionResourcesForTests()
  jest.mocked(readCompanionResourcePolicy).mockReturnValue({ capacity: 1, maxRunningPerInstance: 1, maxQueuedPerInstance: 4 })
})

test('waits for the shared companion resource and preserves decision options', async () => {
  let release!: (value: string) => void
  const held = scheduleCompanionResource({
    resourceKey: 'local-inference',
    requestId: 'chat',
    priority: 'foreground',
    run: () => new Promise<string>((resolve) => (release = resolve)),
  })
  const profile = { id: 'test', provider: 'ollama', endpoint: 'http://localhost:11434', modelTimeoutMs: 10_000 } as GameAgentProfile
  jest.mocked(streamOllamaChat).mockResolvedValue({ role: 'assistant', content: '{"index":1}' })
  const input = {
    model: 'test',
    messages: [{ role: 'user' as const, content: 'Choose' }],
    tools: [],
    signal: new AbortController().signal,
    think: true,
    format: { type: 'object' },
    temperature: 0,
    maxTokens: 120,
    timeoutMs: 3_500,
  }

  const decision = completeAgentModel(profile, input)
  expect(streamOllamaChat).not.toHaveBeenCalled()
  release('done')
  await held
  await expect(decision).resolves.toMatchObject({ content: '{"index":1}' })
  expect(streamOllamaChat).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'test', think: true, format: input.format, temperature: 0, maxTokens: 120, timeoutMs: 3_500 }),
    expect.any(Function),
    expect.any(Function)
  )
})

test('dispatches API profiles through their configured provider', async () => {
  const profile = { id: 'test-api', provider: 'codex-api', endpoint: 'https://model.example/v1', temperature: 0.5 } as GameAgentProfile
  jest.mocked(completeOpenAiChat).mockResolvedValue({ role: 'assistant', content: '{"index":0}' })

  await completeAgentModel(profile, { model: 'test-api-model', messages: [], tools: [], signal: new AbortController().signal, format: { type: 'object' }, maxTokens: 96 })

  expect(completeOpenAiChat).toHaveBeenCalledWith(
    expect.objectContaining({ endpoint: profile.endpoint, model: 'test-api-model', temperature: 0.5, maxTokens: 96, format: { type: 'object' } }),
    expect.any(Function)
  )
  expect(streamOllamaChat).not.toHaveBeenCalled()
})
