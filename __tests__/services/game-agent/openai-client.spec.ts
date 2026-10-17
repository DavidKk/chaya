import { isOpenApiGatewayEndpoint } from '@/lib/game-agent/providers'
import { buildOpenApiFetchHeaders, completeOpenAiChat, openApiGatewayRequestHeaders } from '@/services/game-agent/openai-client'

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
