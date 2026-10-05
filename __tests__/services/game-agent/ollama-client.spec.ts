import { DEFAULT_GAME_AGENT_MODEL, listOllamaModels, pickDefaultModel, streamOllamaChat } from '@/services/game-agent/ollama-client'

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
    expect(fetcher).toHaveBeenCalledWith('http://ollama.test/api/tags', expect.any(Object))
  })

  it('surfaces invalid NDJSON instead of returning a partial answer', async () => {
    const fetcher = jest.fn(async () => streamed(['not-json\n'])) as unknown as typeof fetch
    await expect(streamOllamaChat({ model: 'demo', messages: [] }, () => {}, fetcher)).rejects.toThrow('无效的 NDJSON')
  })
})
