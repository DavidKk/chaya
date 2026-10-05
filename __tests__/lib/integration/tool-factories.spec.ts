import { makeCacheTools } from '@/lib/integration/tools/cache'
import { makeEditTools } from '@/lib/integration/tools/edit'
import { type AgentCaller, makeLiveTools, pluginToolRun } from '@/lib/integration/tools/live'
import { makeTranslateTools } from '@/lib/integration/tools/translate'
import { type ApiInvoke, pathWithQuery, redactSecrets } from '@/lib/integration/tools/types'

const ctx = { signal: new AbortController().signal }

describe('shared tool factories', () => {
  it('builds query paths and redacts secrets', () => {
    expect(pathWithQuery('/api/x', { q: 'a b', page: 2, empty: undefined })).toBe('/api/x?q=a+b&page=2')
    expect(pathWithQuery('/api/x', undefined)).toBe('/api/x')
    expect(redactSecrets({ token: 'secret', apiKey: 'k', password: 'p', hasToken: true, data: { ok: 1 } })).toEqual({ hasToken: true, data: { ok: 1 } })
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

  it('live tools route plugin calls and validated input commands', async () => {
    const call = jest.fn(async () => 'ok') as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeLiveTools({ games: () => [{ gameId: 'g1' }], call })
    expect(await tools.chaya_live_games({}, ctx)).toEqual({ games: [{ gameId: 'g1' }] })
    await tools.chaya_live_call({ plugin: 'ChayaBoost', tool: 'on', input: { rate: 2 } }, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'plugin.tool', { plugin: 'ChayaBoost', tool: 'on', input: { rate: 2 } })
    await expect(tools.chaya_live_call({ plugin: 'ChayaBoost', method: 'on' }, ctx)).rejects.toThrow('tool')
    await expect(tools.chaya_live_press({ key: 'f5' }, ctx)).rejects.toThrow('key 只能是')
    await tools.chaya_live_play(
      {
        gameId: 'g1',
        steps: [
          { key: 'down', frames: 2 },
          { key: 'ok', waitFrames: 12 },
        ],
      },
      ctx
    )
    expect(call).toHaveBeenLastCalledWith('g1', 'input.sequence', {
      steps: [
        { key: 'down', frames: 2, waitFrames: undefined },
        { key: 'ok', frames: undefined, waitFrames: 12 },
      ],
    })
    await expect(tools.chaya_live_play({ steps: [] }, ctx)).rejects.toThrow('steps 不能为空')
    await expect(tools.chaya_live_play({ steps: [{ key: 'jump' }] }, ctx)).rejects.toThrow('steps[0].key')
  })

  it('live game ops map to agent commands; screenshot returns an MCP image', async () => {
    const call = jest.fn(async (_game: string | undefined, method: string) =>
      method === 'game.snap' ? { mimeType: 'image/jpeg', data: 'AAAA', width: 512, height: 384, screen: { width: 816, height: 624 } } : 'ok'
    ) as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeLiveTools({ games: () => [], call })
    await tools.chaya_live_history({ limit: 20, kinds: ['message', 'choice'], afterSeq: 3 }, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'game.history', { limit: 20, kinds: ['message', 'choice'], afterSeq: 3 })
    await expect(tools.chaya_live_history({ kinds: ['secret'] }, ctx)).rejects.toThrow('kinds')
    expect(await tools.chaya_live_screenshot({ maxWidth: 512 }, ctx)).toEqual({
      width: 512,
      height: 384,
      screen: { width: 816, height: 624 },
      mcpImage: { mimeType: 'image/jpeg', data: 'AAAA' },
    })
    await tools.chaya_live_tap({ x: 10, y: 20 }, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'input.tap', { x: 10, y: 20, frames: undefined })
    await expect(tools.chaya_live_tap({ x: 10 }, ctx)).rejects.toThrow('y')
    await tools.chaya_live_move_to({ gameId: 'g1', x: 3, y: 4, timeoutMs: 5000 }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'player.moveTo', { x: 3, y: 4, timeoutMs: 5000 })
    await tools.chaya_live_quit({}, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'game.quit', {})
  })

  it('a host can override quit', async () => {
    const call = jest.fn() as unknown as jest.MockedFunction<AgentCaller>
    const quit = jest.fn(async () => ({ quit: true }))
    expect(await makeLiveTools({ games: () => [], call, quit }).chaya_live_quit({}, ctx)).toEqual({ quit: true })
    expect(call).not.toHaveBeenCalled()
  })

  it('edit tools validate before sending edit commands', async () => {
    const call = jest.fn(async () => 'ok') as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeEditTools(call)
    await tools.chaya_edit_state({ gameId: 'g1' }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'edit.state', {})
    await tools.chaya_edit_set({ op: 'gold', value: 999 }, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'edit.apply', { op: { op: 'gold', value: 999 } })
    await tools.chaya_edit_action({ id: 'save', slot: 2 }, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'edit.action', { action: expect.objectContaining({ id: 'save', slot: 2 }) })
    call.mockClear()
    await expect(tools.chaya_edit_set({ op: 'nope' }, ctx)).rejects.toThrow()
    await expect(tools.chaya_edit_action({ id: 'teleport', mapId: 1 }, ctx)).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })

  it('plugin tool runs strip gameId from the input', async () => {
    const call = jest.fn(async () => null) as unknown as jest.MockedFunction<AgentCaller>
    await pluginToolRun({ plugin: 'ChayaBoost', tool: 'on' }, call)({ gameId: ' g2 ', rate: 3 }, ctx)
    expect(call).toHaveBeenCalledWith('g2', 'plugin.tool', { plugin: 'ChayaBoost', tool: 'on', input: { rate: 3 } })
  })
})
