import { PROVIDER_META } from '@/lib/game-agent/providers'
import { listGeminiModels, resolveGeminiApiBase, resolveGeminiRequestAuth, toGeminiContents, usesGeminiOpenAiCompat } from '@/services/game-agent/gemini-client'

describe('gemini-client (Gemini Generative Language / vercel-gemini-proxy)', () => {
  it('resolves API base like web-scripts (append /v1beta when missing)', () => {
    expect(resolveGeminiApiBase('https://vercel-gemini-proxy.example.com/api')).toBe('https://vercel-gemini-proxy.example.com/api/v1beta')
    expect(resolveGeminiApiBase('https://vercel-gemini-proxy.example.com/api/v1beta')).toBe('https://vercel-gemini-proxy.example.com/api/v1beta')
    expect(resolveGeminiApiBase(PROVIDER_META['gemini-api'].defaultEndpoint || '')).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('supports API key passthrough and proxy headers (together or alone)', () => {
    expect(() => resolveGeminiRequestAuth({ endpoint: 'https://generativelanguage.googleapis.com' })).toThrow(/API Key/)

    expect(
      resolveGeminiRequestAuth({
        endpoint: 'https://generativelanguage.googleapis.com',
        token: 'google-key',
      })
    ).toEqual({
      proxy: false,
      apiKey: 'google-key',
      headers: { 'x-goog-api-key': 'google-key' },
    })

    expect(
      resolveGeminiRequestAuth({
        endpoint: 'https://relay.example.com/api',
        proxyHeaders: { 'X-API-KEY': 'gate', 'CF-Access-Client-Id': 'id' },
      })
    ).toEqual({
      proxy: true,
      apiKey: '',
      headers: { 'X-API-KEY': 'gate', 'CF-Access-Client-Id': 'id' },
    })

    expect(
      resolveGeminiRequestAuth({
        endpoint: 'https://relay.example.com/api',
        token: 'google-key',
        proxyHeaders: { 'X-API-KEY': 'gate' },
        contentType: 'application/json',
      })
    ).toEqual({
      proxy: true,
      apiKey: 'google-key',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': 'gate',
        'x-goog-api-key': 'google-key',
      },
    })
  })

  it('uses OpenAI-compat Gemini surface only when the base ends with /openai', () => {
    expect(usesGeminiOpenAiCompat('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(true)
    expect(usesGeminiOpenAiCompat('https://relay.example.com/api')).toBe(false)
  })

  it('maps Ollama-shaped messages to Gemini contents', () => {
    expect(
      toGeminiContents([
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'look', arguments: { x: 1 } } }],
        },
        { role: 'tool', content: '{"ok":true}', tool_name: 'look' },
      ])
    ).toEqual([
      { role: 'user', parts: [{ text: 'System:\nrules' }] },
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ functionCall: { name: 'look', args: { x: 1 } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'look', response: { ok: true } } }] },
    ])
  })

  it('lists models with proxy headers and optional key query', async () => {
    const fetcher = jest.fn(async () =>
      Response.json({
        models: [{ name: 'models/gemini-2.5-flash', displayName: 'Flash', supportedGenerationMethods: ['generateContent'] }],
      })
    ) as unknown as typeof fetch
    await expect(listGeminiModels('https://relay.example.com/api', fetcher, undefined, 'google-key', { 'X-API-KEY': 'gate' })).resolves.toEqual([
      { name: 'gemini-2.5-flash', label: 'Flash' },
    ])
    expect(fetcher).toHaveBeenCalledWith(
      'https://relay.example.com/api/v1beta/models?key=google-key&pageSize=100',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-KEY': 'gate', 'x-goog-api-key': 'google-key' }),
      })
    )
  })
})
