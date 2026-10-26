/**
 * @jest-environment node
 */
import { readGameAgentToken } from '@/services/game-agent/secrets'
import { loadGameAgentSettings } from '@/services/game-agent/settings'
import {
  agentJaToZh,
  buildBatchTranslatePrompt,
  listTranslateAgents,
  packBatches,
  parseBatchResponse,
  splitSentenceByNaturalBoundaries,
} from '@/services/translate/agent-translate'

jest.mock('@/services/game-agent/secrets', () => ({ readGameAgentToken: jest.fn() }))
jest.mock('@/services/game-agent/model-cache', () => ({ loadAgentModelCache: () => ({ a: [{ name: 'gemma', size: 1 }] }) }))
jest.mock('@/services/game-agent/settings', () => ({
  loadGameAgentSettings: jest.fn(),
  profileById: (settings: { profiles: Array<{ id: string }> }, id: string) => settings.profiles.find((p) => p.id === id) || null,
  ollamaProfiles: (settings: { profiles: Array<{ provider: string }> }) => settings.profiles.filter((p) => p.provider === 'ollama'),
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

it('retries an echoed translation with thinking on the selected instance', async () => {
  jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: 'こんにちは' } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '你好' } })))

  await expect(agentJaToZh('こんにちは', { profileId: 'a', model: 'qwen' }, { interactive: true })).resolves.toBe('你好')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).think).toBe(false)
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ think: true, model: 'qwen' })
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
  await expect(agentJaToZh('こんにちは', { profileId: 'gone', model: '' })).rejects.toThrow('Selected agent profile no longer exists')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('lists instances with names and cached models only', () => {
  jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
  expect(listTranslateAgents()).toEqual({ profiles: [{ id: 'a', label: 'a', defaultModel: 'base' }], models: { a: [{ name: 'gemma' }] } })
})

describe('batch packing and parsing', () => {
  it('packs items greedily until maxChars is reached', () => {
    const items = [
      { text: '12345' }, // 5
      { text: '67890' }, // 5 -> 10
      { text: 'abcde' }, // 5 -> 15 (exceeds 12, moves to batch 2)
      { text: 'fgh' }, // 3 -> 8
    ]
    const batches = packBatches(items, 12)
    expect(batches).toHaveLength(2)
    expect(batches[0].map((b) => b.text)).toEqual(['12345', '67890'])
    expect(batches[1].map((b) => b.text)).toEqual(['abcde', 'fgh'])
  })

  it('splits long sentence at natural punctuation without cutting control codes', () => {
    const longText = 'こんにちは。今日はいい天気ですね！散歩に行きましょうか？'
    const chunks = splitSentenceByNaturalBoundaries(longText, 12)
    expect(chunks.join('')).toBe(longText)
    expect(chunks).toEqual(['こんにちは。', '今日はいい天気ですね！', '散歩に行きましょうか？'])

    const textWithTokens = 'あいうえお__C0__かきくけこ。さしすせそ'
    const chunksWithTokens = splitSentenceByNaturalBoundaries(textWithTokens, 12)
    expect(chunksWithTokens.join('')).toBe(textWithTokens)
    expect(chunksWithTokens.every((c) => !c.includes('__C0') || c.includes('__C0__'))).toBe(true)
  })

  it('builds multi-item numbered prompt and parses various model response styles', () => {
    const texts = ['森３', '森１５', 'はい']
    const { system, user } = buildBatchTranslatePrompt(texts)
    expect(system).toContain('占位符')
    expect(user).toContain('[1] 森３')
    expect(user).toContain('[2] 森１５')
    expect(user).toContain('[3] はい')

    const standardResp = '[1] 森林3\n[2] 森林15\n[3] 是'
    expect(parseBatchResponse(standardResp, 3)).toEqual(['森林3', '森林15', '是'])

    const dotResp = '1. 森林3\n2. 森林15\n3. 是'
    expect(parseBatchResponse(dotResp, 3)).toEqual(['森林3', '森林15', '是'])

    const multiLineResp = '[1] 森林3\n第二行\n[2] 森林15\n[3] 是'
    expect(parseBatchResponse(multiLineResp, 3)).toEqual(['森林3\n第二行', '森林15', '是'])
  })

  it('translates multiple items in a single request and maps them back', async () => {
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: { content: '[1] 森林3\n[2] 森林15' } })))

    const results = await Promise.all([agentJaToZh('森３', { profileId: 'a', model: 'qwen' }), agentJaToZh('森１５', { profileId: 'a', model: 'qwen' })])

    expect(results).toEqual(['森林3', '森林15'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to single-sentence retry when a batch item is missing from response', async () => {
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '[1] 森林3' } }))) // Item 2 missing
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '森林15' } }))) // Fallback for item 2

    const results = await Promise.all([agentJaToZh('森３', { profileId: 'a', model: 'qwen' }), agentJaToZh('森１５', { profileId: 'a', model: 'qwen' })])

    expect(results).toEqual(['森林3', '森林15'])
  })
  it('automatically splits a sentence exceeding maxChars by natural boundaries and rejoins it', async () => {
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '你好。' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '今天！' } })))

    const longText = 'こんにちは。今日は！'
    const res = await agentJaToZh(longText, { profileId: 'a', model: 'qwen' }, { maxChars: 8 })
    expect(res).toBe('你好。今天！')
  })
})
