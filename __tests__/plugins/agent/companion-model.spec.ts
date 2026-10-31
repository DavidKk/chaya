import { withBrowserModelResource } from '@/lib/browser/companion-model-resource'
import type { AgentSyncSettings } from '@/lib/game-agent/settings-sync'
import { createCompanionModel } from '@/plugins/mv/src/agent/runtime/companion-model'
import { chayaFetch } from '@/plugins/mv/src/helpers'
import { createLogger } from '@/plugins/mv/src/helpers/net/logger'
import { prepareCompanionOllama } from '@/services/game-agent/companion-ollama'
import { streamOllamaChat } from '@/services/game-agent/ollama-client'

jest.mock('@/lib/browser/companion-model-resource', () => ({ withBrowserModelResource: jest.fn() }))
jest.mock('@/plugins/mv/src/helpers', () => ({ chayaFetch: jest.fn() }))
jest.mock('@/plugins/mv/src/helpers/net/logger', () => ({ createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn() })) }))
jest.mock('@/services/game-agent/ollama-client', () => ({ streamOllamaChat: jest.fn() }))
jest.mock('@/services/game-agent/companion-ollama', () => ({ COMPANION_KEEP_ALIVE: -1, prepareCompanionOllama: jest.fn() }))

const config = { profiles: [{ id: 'p1', provider: 'ollama', endpoint: 'http://localhost:11434' }] } as AgentSyncSettings
let now = 0
beforeEach(() => {
  now = 0
  jest.mocked(prepareCompanionOllama).mockResolvedValue({ residency: 'warm', startupMs: 0 })
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { CHAYA_MCP_GATEWAY: false } })
})
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

const options = () => ({ profileId: 'p1', model: 'small', purpose: 'chat' as const, signal: new AbortController().signal })

test('desktop completion carries server queue/generation timings and measures the actual first chunk at the host', async () => {
  jest.mocked(chayaFetch).mockImplementation(async () => {
    now = 500
    return new Response(
      [
        { type: 'delta', text: 'hello' },
        { type: 'completed', message: { role: 'assistant', content: 'hello' }, metrics: { totalMs: 450, queueMs: 200, generationMs: 250, contextMs: 1, firstTokenMs: 350 } },
      ]
        .map((packet) => JSON.stringify(packet))
        .join('\n')
    )
  })
  const delta = jest.fn()
  const reply = await createCompanionModel(() => config)([{ role: 'user', content: 'hello' }], { ...options(), onDelta: delta })
  expect(reply.companionMetrics).toEqual({ totalMs: 500, queueMs: 200, generationMs: 250, contextMs: 1, firstTokenMs: 500 })
  expect(delta).toHaveBeenCalledWith('hello')
})

test('whole responses do not invent a first-token measurement', async () => {
  jest.mocked(chayaFetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        type: 'completed',
        message: { role: 'assistant', content: 'whole' },
        metrics: { totalMs: 100, queueMs: 20, generationMs: 80 },
      })
    )
  )
  const reply = await createCompanionModel(() => config)([{ role: 'user', content: 'hello' }], options())
  expect(reply.companionMetrics).toMatchObject({ queueMs: 20, generationMs: 80 })
  expect(reply.companionMetrics?.firstTokenMs).toBeUndefined()
})

test('loading packets report progress separately from reply text and preserve startup metrics', async () => {
  jest.mocked(chayaFetch).mockResolvedValue(
    new Response(
      [
        { type: 'model.status', phase: 'loading', residency: 'cold' },
        { type: 'model.status', phase: 'ready', residency: 'cold', startupMs: 20_000 },
        { type: 'completed', message: { role: 'assistant', content: 'hello' }, metrics: { startupMs: 20_000, residency: 'cold', loadMs: 15 } },
      ]
        .map((packet) => JSON.stringify(packet))
        .join('\n')
    )
  )
  const onModelStatus = jest.fn()
  const onDelta = jest.fn()
  const result = await createCompanionModel(() => config)([], { ...options(), onModelStatus, onDelta })
  expect(onModelStatus.mock.calls.map(([status]) => status.phase)).toEqual(['loading', 'ready'])
  expect(onDelta).not.toHaveBeenCalled()
  expect(result.companionMetrics).toMatchObject({ startupMs: 20_000, residency: 'cold', loadMs: 15 })
})

test('browser inference keeps queue, generation and first chunk durations separate', async () => {
  ;(window as unknown as { CHAYA_MCP_GATEWAY: boolean }).CHAYA_MCP_GATEWAY = true
  jest.mocked(withBrowserModelResource).mockImplementation(async (request) => {
    now = 100
    return request.run(new AbortController().signal)
  })
  jest.mocked(streamOllamaChat).mockImplementation(async (_request, onDelta) => {
    now = 250
    onDelta('')
    onDelta('hello')
    now = 500
    return { role: 'assistant', content: 'hello' }
  })
  const reply = await createCompanionModel(() => config)([{ role: 'user', content: 'hello' }], options())
  expect(reply.companionMetrics).toMatchObject({ totalMs: 500, queueMs: 100, generationMs: 400, firstTokenMs: 250, contextMs: expect.any(Number) })
  expect(chayaFetch).not.toHaveBeenCalled()
  expect(jest.mocked(streamOllamaChat).mock.calls[0][0].keepAlive).toBe(-1)
  expect(jest.mocked(createLogger).mock.results[0].value.info).toHaveBeenCalledWith('Model completed', expect.objectContaining({ queueMs: 100, generationMs: 400 }))
})

test('browser failure logs elapsed generation separately from startup and queue time', async () => {
  ;(window as unknown as { CHAYA_MCP_GATEWAY: boolean }).CHAYA_MCP_GATEWAY = true
  jest.mocked(withBrowserModelResource).mockImplementation(async (request) => {
    now = 100
    return request.run(new AbortController().signal)
  })
  jest.mocked(prepareCompanionOllama).mockImplementation(async () => {
    now = 300
    return { residency: 'warm', startupMs: 200 }
  })
  jest.mocked(streamOllamaChat).mockImplementation(async (_request, onDelta) => {
    now = 500
    onDelta('private partial reply')
    now = 800
    throw new Error('Disconnected')
  })
  await expect(createCompanionModel(() => config)([], options())).rejects.toThrow('Disconnected')
  const logger = jest.mocked(createLogger).mock.results[0].value
  expect(logger.warn).toHaveBeenCalledWith('Model failed', expect.objectContaining({ totalMs: 800, queueMs: 100, startupMs: 200, generationMs: 500, firstTokenMs: 500 }))
  expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain('private partial reply')
})
