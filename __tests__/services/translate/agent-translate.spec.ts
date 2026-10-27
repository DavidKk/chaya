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

  const onTrace = jest.fn()
  await expect(agentJaToZh('こんにちは', { profileId: 'a', model: 'qwen' }, { interactive: true, onTrace })).resolves.toBe('你好')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).think).toBe(false)
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ think: true, model: 'qwen' })
  expect(onTrace.mock.calls).toEqual([['Agent request submitted: items=1, sourceChars=5'], ['Agent request submitted: items=1, sourceChars=5']])
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

    const textWithTokens = 'あいうえお。__C0__かき。さしすせそ。__C1__たち。'
    const chunksWithTokens = splitSentenceByNaturalBoundaries(textWithTokens, 12)
    expect(chunksWithTokens.join('')).toBe(textWithTokens)
    expect(chunksWithTokens.every((c) => !c.includes('__C0') || c.includes('__C0__'))).toBe(true)
    expect(chunksWithTokens.every((c) => Array.from(c).length <= 12)).toBe(true)
    expect(chunksWithTokens).toContain('__C1__たち。')
  })

  it('rejects indivisible clauses instead of cutting text or sending an oversized request', async () => {
    expect(() => splitSentenceByNaturalBoundaries('あ'.repeat(20), 12)).toThrow('no safe sentence boundary')
    expect(() => splitSentenceByNaturalBoundaries('あ。\\V[1,234567890]い。', 12)).toThrow('no safe sentence boundary')
    await expect(agentJaToZh('あ'.repeat(20), { profileId: 'a', model: 'qwen' }, { maxChars: 12 })).rejects.toThrow('no safe sentence boundary')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts Unicode characters and preserves punctuation inside control codes', () => {
    const text = '😀あ。\\N[名,前]い。😀う。'
    const chunks = splitSentenceByNaturalBoundaries(text, 11)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every((chunk) => Array.from(chunk).length <= 11)).toBe(true)
    expect(chunks.some((chunk) => chunk.includes('\\N[名,前]'))).toBe(true)
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

  it('collects small arrivals from different event-loop turns into one request', async () => {
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: { content: Array.from({ length: 10 }, (_, i) => `[${i + 1}] 译文${i}`).join('\n') } })))
    const trace = jest.fn()
    const requests: Array<Promise<string>> = []
    for (let i = 0; i < 10; i++) {
      requests.push(agentJaToZh(`あいうえおかきく${i}`, { profileId: 'a', model: 'qwen' }, { onTrace: trace }))
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await Promise.all(requests)).toHaveLength(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(trace).toHaveBeenCalledWith('Agent request submitted: items=10, sourceChars=90')
  })

  it('does not let cancellation of the first source abort other items in the shared request', async () => {
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    const first = new AbortController()
    let signal: AbortSignal | undefined
    let finish!: (response: Response) => void
    fetchMock.mockImplementation((_url, init) => {
      signal = init.signal
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    })
    const cancelled = agentJaToZh('あいうえ', { profileId: 'a', model: 'qwen' }, { maxChars: 8, signal: first.signal }).catch((error: Error) => error.message)
    const second = agentJaToZh('かきくけ', { profileId: 'a', model: 'qwen' }, { maxChars: 8 })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    first.abort(new Error('Cache won'))
    expect(await cancelled).toBe('Cache won')
    expect(signal?.aborted).toBe(false)
    finish(new Response(JSON.stringify({ message: { content: '[1] 缓存先命中\n[2] 保留翻译' } })))
    expect(await second).toBe('保留翻译')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([1, 3])('limits actual packed HTTP concurrency to %i while filling requests', async (concurrency) => {
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    const finishes: Array<() => void> = []
    let active = 0
    let peak = 0
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          peak = Math.max(peak, ++active)
          finishes.push(() => {
            active--
            resolve(new Response(JSON.stringify({ message: { content: '[1] 译文一\n[2] 译文二' } })))
          })
        })
    )
    const trace = jest.fn()
    const requests = Array.from({ length: 6 }, (_, i) =>
      agentJaToZh(`あいうえ${i}`, { profileId: 'a', model: 'qwen' }, { maxChars: 10, concurrency, lane: `test:${concurrency}`, onTrace: trace })
    )
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(concurrency)
    for (let i = 0; i < 3; i++) {
      finishes[i]()
      for (let n = 0; n < 30; n++) await Promise.resolve()
    }
    expect(await Promise.all(requests)).toHaveLength(6)
    expect(peak).toBe(concurrency)
    expect(trace.mock.calls.filter(([line]) => line === 'Agent request submitted: items=2, sourceChars=10')).toHaveLength(3)
  })

  it('flushes within five seconds of the first item even when new items keep arriving', async () => {
    jest.useFakeTimers()
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    fetchMock.mockImplementation(async (_url, init) => {
      const content = JSON.parse(init.body).messages.at(-1).content as string
      const lines = content.split('\n').filter((line) => /^\[\d+\]/.test(line))
      return new Response(JSON.stringify({ message: { content: lines.map((_, i) => `[${i + 1}] 翻译${i}`).join('\n') } }))
    })
    const requests: Array<Promise<string>> = []
    const batchScope = { waitForMore: () => true }
    try {
      for (let i = 0; i < 50; i++) {
        requests.push(agentJaToZh(`あいうえ${i}`, { profileId: 'a', model: 'qwen' }, { batchScope }))
        await jest.advanceTimersByTimeAsync(100)
        if (i < 49) expect(fetchMock).not.toHaveBeenCalled()
      }
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(await Promise.all(requests)).toHaveLength(50)
    } finally {
      jest.useRealTimers()
    }
  })

  it('aborts a shared transport only after all of its sources are cancelled and skips retries', async () => {
    jest.mocked(loadGameAgentSettings).mockReturnValue({ version: 1, defaultProfileId: 'a', profiles: [profile('a')] } as never)
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        })
    )
    const controllers = [new AbortController(), new AbortController()]
    const requests = controllers.map((controller, i) =>
      agentJaToZh(`あいう${i}`, { profileId: 'a', model: 'qwen' }, { maxChars: 8, signal: controller.signal }).catch((error: Error) => error.message)
    )
    for (let i = 0; i < 10; i++) await Promise.resolve()
    controllers[0].abort(new Error('Cache won'))
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false)
    controllers[1].abort(new Error('Cache won'))
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(await Promise.all(requests)).toEqual(['Cache won', 'Cache won'])
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
