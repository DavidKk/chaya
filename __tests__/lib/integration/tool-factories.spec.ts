import { makeCacheTools } from '@/lib/integration/tools/cache'
import { type AgentCaller, makeLiveTools, pluginToolRun } from '@/lib/integration/tools/live'
import { makeTranslateTools } from '@/lib/integration/tools/translate'
import { type ApiInvoke, pathWithQuery, redactSecrets } from '@/lib/integration/tools/types'

const ctx = { signal: new AbortController().signal }

describe('shared tool factories', () => {
  it('builds query paths and redacts secrets', () => {
    expect(pathWithQuery('/api/x', { q: 'a b', page: 2, empty: undefined })).toBe('/api/x?q=a+b&page=2')
    expect(pathWithQuery('/api/x', undefined)).toBe('/api/x')
    expect(redactSecrets({ token: 'secret', apiKey: 'k', data: { ok: 1 } })).not.toHaveProperty('token')
  })

  it('cache tools call the translate-cache API through the injected invoke', async () => {
    const invoke = jest.fn<ReturnType<ApiInvoke>, Parameters<ApiInvoke>>(async () => ({ items: [] }))
    const tools = makeCacheTools(invoke)
    await tools.chaya_cache_query({ q: 'ポーション', nsfw: true, page: 2 }, ctx)
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/translate-cache', query: expect.objectContaining({ q: 'ポーション', nsfw: '1', page: 2 }) })
    )
    await tools.chaya_cache_update({ src: '原文', zh: '译文' }, ctx)
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'PATCH', body: { src: '原文', zh: '译文' } }))
    await expect(tools.chaya_cache_delete({}, ctx)).rejects.toThrow('src')
  })

  it('translate tools use the same API paths', async () => {
    const invoke = jest.fn<ReturnType<ApiInvoke>, Parameters<ApiInvoke>>(async () => ({}))
    const tools = makeTranslateTools(invoke)
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(['chaya_translate_text', 'chaya_translate_extract', 'chaya_translate_job']))
    await tools.chaya_translate_extract({}, ctx)
    expect(invoke.mock.calls[0][0].path).toBe('/api/extract')
  })

  it('live tools route plugin.call, plugin.tool and input.press', async () => {
    const call = jest.fn(async () => 'ok') as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeLiveTools({ games: () => [{ gameId: 'g1' }], call })
    expect(await tools.chaya_live_games({}, ctx)).toEqual({ games: [{ gameId: 'g1' }] })
    await tools.chaya_live_call({ plugin: 'ChayaEdit', tool: 'gold', input: { value: 1 } }, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'plugin.tool', { plugin: 'ChayaEdit', tool: 'gold', input: { value: 1 } })
    await tools.chaya_live_call({ gameId: 'g1', plugin: 'ChayaEdit', method: 'actor', args: [1], chain: [{ method: 'hp', args: [9] }] }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'plugin.call', { plugin: 'ChayaEdit', method: 'actor', args: [1], chain: [{ method: 'hp', args: [9] }] })
    await expect(tools.chaya_live_call({ plugin: 'ChayaEdit' }, ctx)).rejects.toThrow('method 或 tool')
    await expect(tools.chaya_live_press({ key: 'f5' }, ctx)).rejects.toThrow('key 只能是')
  })

  it('plugin tool runs strip gameId from the input', async () => {
    const call = jest.fn(async () => null) as unknown as jest.MockedFunction<AgentCaller>
    await pluginToolRun({ plugin: 'ChayaBoost', tool: 'on' }, call)({ gameId: ' g2 ', rate: 3 }, ctx)
    expect(call).toHaveBeenCalledWith('g2', 'plugin.tool', { plugin: 'ChayaBoost', tool: 'on', input: { rate: 3 } })
  })
})
