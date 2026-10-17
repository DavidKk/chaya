import { completeAnthropicChat, listAnthropicModels, usesAnthropicApi } from '@/services/game-agent/anthropic-client'

it('uses native Claude authentication for the official endpoint and paginates models', async () => {
  const fetcher = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Claude' }], has_more: true, last_id: 'claude-test' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'claude-other' }], has_more: false })))
  expect(usesAnthropicApi('https://api.anthropic.com/v1')).toBe(true)
  expect(usesAnthropicApi('https://gateway.example/v1')).toBe(false)
  await expect(listAnthropicModels('https://api.anthropic.com/v1', fetcher, undefined, 'secret')).resolves.toEqual([
    { name: 'claude-test', label: 'Claude' },
    { name: 'claude-other' },
  ])
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' })
  expect(String(fetcher.mock.calls[1][0])).toContain('after_id=claude-test')
})

it('sends system instructions separately and pairs parallel tool results with their calls', async () => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
    new Response(
      JSON.stringify({
        content: [
          { type: 'text', text: '继续' },
          { type: 'tool_use', name: 'state', input: {} },
        ],
        usage: { input_tokens: 7, output_tokens: 3 },
      })
    )
  )
  const result = await completeAnthropicChat(
    {
      endpoint: 'https://api.anthropic.com/v1',
      model: 'claude-test',
      token: 'secret',
      messages: [
        { role: 'system', content: 'Observe first' },
        { role: 'user', content: 'Go' },
        { role: 'assistant', content: '', tool_calls: [{ function: { name: 'state', arguments: {} } }, { function: { name: 'ui', arguments: {} } }] },
        { role: 'tool', tool_name: 'state', content: 'map' },
        { role: 'tool', tool_name: 'ui', content: 'menu' },
      ],
      tools: [{ type: 'function', function: { name: 'state', description: 'Read state', parameters: { type: 'object' } } }],
    },
    fetcher
  )
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
  expect(fetcher.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
  expect(body.system).toBe('Observe first')
  expect(body.messages[2].content.map((part: { tool_use_id: string }) => part.tool_use_id)).toEqual(['tool_0', 'tool_1'])
  expect(body.tools[0].input_schema).toEqual({ type: 'object' })
  expect(result).toMatchObject({ content: '继续', tool_calls: [{ function: { name: 'state', arguments: {} } }], usage: { total: 10 } })
})

it('accepts a runtime observation without a preceding model tool call', async () => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Done' }] })))
  await completeAnthropicChat(
    {
      endpoint: 'https://api.anthropic.com/v1',
      model: 'test',
      messages: [
        { role: 'user', content: 'Continue' },
        { role: 'tool', tool_name: 'state', content: 'Fresh map' },
      ],
    },
    fetcher
  )
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
  expect(body.messages[0].content).toContainEqual({ type: 'text', text: 'Tool observation (state):\nFresh map' })
})
