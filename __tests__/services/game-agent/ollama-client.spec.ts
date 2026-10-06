import {
  DEFAULT_GAME_AGENT_MODEL,
  listOllamaModels,
  pickAvailableModel,
  pickDefaultModel,
  readOllamaModelCapabilities,
  streamOllamaChat,
} from '@/services/game-agent/ollama-client'

function streamed(lines: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      },
    })
  )
}

describe('game agent Ollama client', () => {
  it('parses fragmented NDJSON and emits content deltas', async () => {
    const fetcher = jest.fn(async () => streamed(['{"message":{"content":"你', '好"}}\n{"message":{"content":"！"}}\n'])) as unknown as typeof fetch
    const deltas: string[] = []
    const answer = await streamOllamaChat({ model: 'demo', messages: [{ role: 'user', content: 'hi' }] }, (text) => deltas.push(text), fetcher)
    expect(answer).toEqual({ role: 'assistant', content: '你好！' })
    expect(deltas).toEqual(['你好', '！'])
  })

  it('sends tools and parses Gemma tool calls with object or JSON arguments', async () => {
    const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.tools[0].function.name).toBe('chaya_edit_set')
      expect(body.options.num_ctx).toBe(16_384)
      return streamed([
        '{"message":{"content":"","tool_calls":[{"function":{"name":"chaya_edit_set","arguments":{"op":"walkRate","value":2}}},{"function":{"name":"chaya_edit_set","arguments":"{\\"op\\":\\"runRate\\",\\"value\\":2}"}}]}}\n',
      ])
    }) as unknown as typeof fetch
    const tools = [{ type: 'function' as const, function: { name: 'chaya_edit_set', description: 'Set a value', parameters: { type: 'object' } } }]
    const message = await streamOllamaChat({ model: 'gemma', messages: [], tools }, () => {}, fetcher)
    expect(message.tool_calls).toEqual([
      { function: { name: 'chaya_edit_set', arguments: { op: 'walkRate', value: 2 } } },
      { function: { name: 'chaya_edit_set', arguments: { op: 'runRate', value: 2 } } },
    ])
  })

  it('removes the fast-mode directive when thinking is enabled for one call', async () => {
    const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.think).toBe(true)
      expect(body.messages[0].content).toBe('Analyze the goal.')
      expect(body.options.num_predict).toBe(2048)
      return streamed(['{"message":{"thinking":"checking","content":"done"}}\n'])
    }) as unknown as typeof fetch
    await expect(
      streamOllamaChat({ model: 'demo', think: true, maxTokens: 128, messages: [{ role: 'system', content: '/no_think\nAnalyze the goal.' }] }, () => {}, fetcher)
    ).resolves.toMatchObject({ content: 'done' })
  })

  it('falls back when a model explicitly rejects thinking', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response('model does not support thinking', { status: 400 }))
      .mockResolvedValueOnce(streamed(['{"message":{"content":"ok"}}\n'])) as unknown as typeof fetch
    await expect(streamOllamaChat({ model: 'basic', think: true, messages: [] }, () => {}, fetcher)).resolves.toMatchObject({ content: 'ok' })
    expect(JSON.parse(String((fetcher as jest.Mock).mock.calls[1][1].body)).think).toBe(false)
  })

  it('passes screenshot bytes in the Ollama image field', async () => {
    const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.messages[0]).toEqual({ role: 'user', content: 'Read menu', images: ['base64-jpeg'] })
      return streamed(['{"message":{"content":"ok"}}\n'])
    }) as unknown as typeof fetch
    await streamOllamaChat({ model: 'vision', messages: [{ role: 'user', content: 'Read menu', images: ['base64-jpeg'] }] }, () => {}, fetcher)
  })

  it('reads installed models and prefers the existing repository default', async () => {
    const fetcher = jest.fn(async () =>
      Response.json({
        models: [
          { name: 'qwen3:8b', size: 1 },
          { name: DEFAULT_GAME_AGENT_MODEL, modified_at: 'today' },
        ],
      })
    ) as unknown as typeof fetch
    const models = await listOllamaModels('http://ollama.test', fetcher)
    expect(models).toEqual([
      { name: 'qwen3:8b', size: 1, modifiedAt: undefined },
      { name: DEFAULT_GAME_AGENT_MODEL, size: undefined, modifiedAt: 'today' },
    ])
    expect(pickDefaultModel(models)).toBe(DEFAULT_GAME_AGENT_MODEL)
    expect(pickDefaultModel([{ name: 'only' }])).toBe('only')
    expect(pickAvailableModel(models, 'qwen3:8b')).toBe('qwen3:8b')
    expect(pickAvailableModel([{ name: 'only' }], 'removed')).toBe('only')
    expect(fetcher).toHaveBeenCalledWith('http://ollama.test/api/tags', expect.any(Object))
  })

  it('uses a bearer token without placing it in the request body', async () => {
    const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-token')
      expect(String(init?.body)).not.toContain('private-token')
      return streamed(['{"message":{"content":"ok"}}\n'])
    }) as unknown as typeof fetch

    await streamOllamaChat({ model: 'demo', messages: [], token: 'private-token' }, () => {}, fetcher)
  })

  it('reads vision capability from model details', async () => {
    const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'gemma4:vision' })
      return Response.json({ capabilities: ['completion', 'vision'] })
    }) as unknown as typeof fetch
    await expect(readOllamaModelCapabilities('gemma4:vision', 'http://ollama.test', fetcher)).resolves.toEqual(['completion', 'vision'])
    expect(fetcher).toHaveBeenCalledWith('http://ollama.test/api/show', expect.objectContaining({ method: 'POST' }))
  })

  it('surfaces invalid NDJSON instead of returning a partial answer', async () => {
    const fetcher = jest.fn(async () => streamed(['not-json\n'])) as unknown as typeof fetch
    await expect(streamOllamaChat({ model: 'demo', messages: [] }, () => {}, fetcher)).rejects.toThrow('无效的 NDJSON')
  })
})
