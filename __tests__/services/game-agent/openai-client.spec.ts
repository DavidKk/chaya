import { isOpenApiGatewayEndpoint } from '@/lib/game-agent/providers'
import { buildOpenApiFetchHeaders, completeOpenAiChat, listOpenAiModels, openApiGatewayRequestHeaders } from '@/services/game-agent/openai-client'

it('encodes runtime observations without inventing an unmatched tool call id', async () => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Done' } }] })))
  await completeOpenAiChat(
    {
      endpoint: 'https://model.example/v1',
      model: 'test',
      messages: [
        { role: 'user', content: 'Continue' },
        { role: 'tool', tool_name: 'chaya_live_state', content: 'Fresh map snapshot' },
      ],
    },
    fetcher
  )
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
  expect(body.messages[1]).toEqual({ role: 'user', content: 'Tool observation (chaya_live_state):\nFresh map snapshot' })
})

describe('OpenAPI gateway headers (web-scripts style)', () => {
  it('treats a custom base URL as a gateway endpoint', () => {
    expect(isOpenApiGatewayEndpoint('gemini-api', 'https://generativelanguage.googleapis.com')).toBe(false)
    expect(isOpenApiGatewayEndpoint('gemini-api', 'https://generativelanguage.googleapis.com/')).toBe(false)
    expect(isOpenApiGatewayEndpoint('gemini-api', 'https://proxy.example.com/api')).toBe(true)
    expect(isOpenApiGatewayEndpoint('codex-api', 'https://api.openai.com/v1')).toBe(false)
    expect(isOpenApiGatewayEndpoint('codex-api', 'https://api.openai.com/v1/')).toBe(false)
  })

  it('attaches proxyHeaders only for gateway endpoints', () => {
    const headers = { 'X-API-KEY': 'gate', Authorization: 'Bearer gate' }
    expect(openApiGatewayRequestHeaders('gemini-api', 'https://proxy.example.com/api', headers)).toEqual(headers)
    expect(openApiGatewayRequestHeaders('gemini-api', 'https://generativelanguage.googleapis.com', headers)).toBeUndefined()
    expect(openApiGatewayRequestHeaders('gemini-api', 'https://proxy.example.com/api', {})).toBeUndefined()
  })

  it('omits Bearer when token is empty and merges gateway headers (may override Authorization)', () => {
    expect(buildOpenApiFetchHeaders({ contentType: 'application/json' })).toEqual({ 'Content-Type': 'application/json' })
    expect(
      buildOpenApiFetchHeaders({
        token: '  ',
        requestHeaders: { 'X-API-KEY': 'gate' },
        contentType: 'application/json',
      })
    ).toEqual({ 'Content-Type': 'application/json', 'X-API-KEY': 'gate' })
    expect(
      buildOpenApiFetchHeaders({
        token: 'vendor',
        requestHeaders: { Authorization: 'Bearer gate', 'X-Foo': '1' },
        contentType: 'application/json',
      })
    ).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer gate',
      'X-Foo': '1',
    })
  })
})

describe('listOpenAiModels with custom models endpoint and catalog support', () => {
  it('defaults to /models when modelsEndpoint is not provided', async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] })))
    const models = await listOpenAiModels('https://api.openai.com/v1', fetcher, undefined, 'sk-test')
    expect(fetcher).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.any(Object))
    expect(models).toEqual([{ name: 'gpt-4o', label: 'gpt-4o' }])
  })

  it('resolves relative modelsEndpoint against base endpoint', async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(JSON.stringify({ models: [{ slug: 'antigravity/gemini-3.8-flash', display_name: 'Gemini 3.8 Flash' }] })))
    const models = await listOpenAiModels('http://127.0.0.1:3425/v1', fetcher, undefined, 'sk-magpie', undefined, '/codex/models')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3425/v1/codex/models', expect.any(Object))
    expect(models).toEqual([{ name: 'antigravity/gemini-3.8-flash', label: 'Gemini 3.8 Flash (antigravity/gemini-3.8-flash)' }])
  })

  it('supports absolute URL for modelsEndpoint and parses magpie format', async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { slug: 'codex/gpt-6.1-sol', magpie_label: 'GPT-6.1-Sol' },
            { model: 'workbuddy/deepseek-v4.1-flash', display_name: 'DeepSeek-V4.1-Flash' },
          ],
        })
      )
    )
    const models = await listOpenAiModels('http://127.0.0.1:3425/v1', fetcher, undefined, 'sk-magpie', undefined, 'http://127.0.0.1:3425/v1/codex/models')
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3425/v1/codex/models', expect.any(Object))
    expect(models).toEqual([
      { name: 'workbuddy/deepseek-v4.1-flash', label: 'DeepSeek-V4.1-Flash (workbuddy/deepseek-v4.1-flash)' },
      { name: 'codex/gpt-6.1-sol', label: 'GPT-6.1-Sol (codex/gpt-6.1-sol)' },
    ])
  })
})
