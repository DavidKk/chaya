/**
 * @jest-environment node
 */
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { loadGameAgentSettings } from '@/services/game-agent/settings'
import { agentJaToZh, listTranslateAgents } from '@/services/translate/agent-translate'

jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn() }))
jest.mock('@/services/game-agent/model-cache', () => ({ loadAgentModelCache: () => ({ a: [{ name: 'gemma', size: 1 }] }) }))
jest.mock('@/services/game-agent/settings', () => ({
  loadGameAgentSettings: jest.fn(),
  profileById: (settings: { profiles: Array<{ id: string }> }, id: string) => settings.profiles.find((p) => p.id === id) || null,
}))

const profile = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  provider: 'ollama',
  endpoint: `http://${id}.local:11434/`,
  defaultModel: 'base',
  temperature: 0.3,
  keepAlive: '5m',
  ...extra,
})

const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  jest.mocked(readGameAgentToken).mockReset()
})

it('uses the chosen instance endpoint, model and token', async () => {
  jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a'), profile('b')] } as never)
  jest.mocked(readGameAgentToken).mockReturnValue('secret')
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: { content: '你好' } })))
  await expect(agentJaToZh('こんにちは', { profileId: 'b', model: 'qwen' })).resolves.toBe('你好')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('http://b.local:11434/api/chat')
  expect(init.headers.Authorization).toBe('Bearer secret')
  expect(JSON.parse(init.body)).toMatchObject({ model: 'qwen', keep_alive: '5m', options: { temperature: 0.3 } })
})

it('falls back to the default instance and its default model', async () => {
  jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: { content: '你好' } })))
  await agentJaToZh('こんにちは', { profileId: '', model: '' })
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('http://a.local:11434/api/chat')
  expect(init.headers.Authorization).toBeUndefined()
  expect(JSON.parse(init.body).model).toBe('base')
})

it('picks an installed model when the instance has no default', async () => {
  jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a', { defaultModel: '' })] } as never)
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'gemma-x' }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '你好' } })))
  await agentJaToZh('こんにちは', { profileId: '', model: '' })
  expect(fetchMock.mock.calls[0][0]).toBe('http://a.local:11434/api/tags')
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('gemma-x')
})

it('refuses a deleted instance instead of silently switching', async () => {
  jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
  await expect(agentJaToZh('こんにちは', { profileId: 'gone', model: '' })).rejects.toThrow('所选 Agent 实例已不存在')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('lists instances with names and cached models only', () => {
  jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
  expect(listTranslateAgents()).toEqual({ profiles: [{ id: 'a', label: 'a', defaultModel: 'base' }], models: { a: [{ name: 'gemma' }] } })
})
