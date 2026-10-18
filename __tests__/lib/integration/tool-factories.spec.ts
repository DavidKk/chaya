import { makeCacheTools } from '@/lib/integration/tools/cache'
import { makeEditTools } from '@/lib/integration/tools/edit'
import { type AgentCaller, makeLiveTools, pluginToolRun } from '@/lib/integration/tools/live'
import { makeSaveTools } from '@/lib/integration/tools/saves'
import { makeSkillTools } from '@/lib/integration/tools/skills'
import { makeTranslateTools } from '@/lib/integration/tools/translate'
import { type ApiInvoke, pathWithQuery, redactSecrets } from '@/lib/integration/tools/types'

const ctx = { signal: new AbortController().signal }

describe('shared tool factories', () => {
  it('returns only requested state groups and keeps location together with map events', async () => {
    const state = {
      scene: 'Scene_Equip',
      title: 'Game',
      map: { id: 1 },
      player: { x: 2 },
      nearbyEvents: [{ id: 3 }],
      party: [{ id: 1, name: 'Hero', hp: 100, equipment: [{ slot: 0 }] }],
      inventory: { items: ['potion'], weapons: ['sword'], armors: [] },
      windows: [{ active: true }],
      screenText: 'large',
    }
    const call = jest.fn(async () => state) as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeLiveTools({ games: () => [], call })
    const summary = await tools.chaya_live_state({}, ctx)
    expect(summary).toMatchObject({ scene: 'Scene_Equip', availableSections: expect.arrayContaining(['equipment', 'map']) })
    expect(summary).not.toHaveProperty('map')
    const equipment = await tools.chaya_live_state({ sections: ['equipment', 'ui'] }, ctx)
    expect(equipment).toMatchObject({ party: [{ id: 1, equipment: [{ slot: 0 }] }], inventory: { weapons: ['sword'] }, windows: [{ active: true }] })
    expect(equipment).not.toHaveProperty('map')
    expect(equipment).not.toHaveProperty('screenText')
    expect(equipment).not.toHaveProperty('inventory.items')
    expect((equipment as typeof state).party[0]).not.toHaveProperty('hp')
    expect(await tools.chaya_live_state({ sections: ['map'] }, ctx)).toMatchObject({ map: state.map, player: state.player, nearbyEvents: state.nearbyEvents })
    expect(await tools.chaya_live_state({ sections: ['all'] }, ctx)).toEqual(state)
    await expect(tools.chaya_live_state({ sections: ['unknown'] }, ctx)).rejects.toThrow('sections')
  })
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
    await expect(tools.chaya_live_press({ key: 'f5' }, ctx)).rejects.toThrow('key must be one of')
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
    await expect(tools.chaya_live_play({ steps: [] }, ctx)).rejects.toThrow('steps cannot be empty')
    await expect(tools.chaya_live_play({ steps: [{ key: 'jump' }] }, ctx)).rejects.toThrow('steps[0].key')
  })

  it('opens the standard game scenes through the edit action bridge', async () => {
    const call = jest.fn(async () => 'ok') as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeLiveTools({ games: () => [], call })
    await tools.chaya_live_open_scene({ gameId: 'g1', scene: 'scene:status' }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'edit.action', { action: { id: 'scene:status' } })
    await expect(tools.chaya_live_open_scene({ scene: 'scene:unknown' }, ctx)).rejects.toThrow('scene must be one of')
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
    await tools.chaya_live_interact({ gameId: 'g1', eventId: 7 }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'player.interact', { eventId: 7 })
    await tools.chaya_live_interact({ gameId: 'g1', eventId: 7, openDoors: false }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'player.interact', { eventId: 7, openDoors: false })
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

  it('save tools list and load Chaya save entries through the agent', async () => {
    const call = jest.fn(async () => ({ ok: true })) as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeSaveTools(call)
    await tools.chaya_live_saves({ gameId: 'g1' }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'game.saves', { op: 'snapshot' })
    await tools.chaya_live_saves_load({ entryId: 'auto-abc', allowVersionMismatch: true }, ctx)
    expect(call).toHaveBeenLastCalledWith(undefined, 'game.saves', { op: 'load', entryId: 'auto-abc', allowVersionMismatch: true })
    await expect(tools.chaya_live_saves_load({}, ctx)).rejects.toThrow('entryId')
  })

  it('defaults omitted save source and slot to the native game file', async () => {
    const call = jest.fn(async () => ({ ok: true })) as unknown as jest.MockedFunction<AgentCaller>
    const tools = makeSaveTools(call)
    await tools.chaya_live_save({ gameId: 'g1' }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'game.saves', { op: 'nativeSave', slot: 1 })
    await tools.chaya_live_load_save({ gameId: 'g1' }, ctx)
    expect(call).toHaveBeenLastCalledWith('g1', 'game.saves', { op: 'nativeLoad', slot: 1 })
  })

  it('skills are indexed and loaded on demand', async () => {
    const tools = makeSkillTools()
    const index = (await tools.chaya_skills_list({}, ctx)) as { skills: Array<{ id: string }> }
    expect(index.skills.map((skill) => skill.id)).toContain('combat.optimization')
    const result = (await tools.chaya_skills_search({ query: 'multi path' }, ctx)) as { results: Array<{ id: string }> }
    expect(result.results.map((skill) => skill.id)).toContain('planning.route-selection')
    await expect(tools.chaya_skills_read({ id: 'combat.optimization' }, ctx)).resolves.toEqual(expect.objectContaining({ guidance: expect.any(Array) }))
  })

  it('plugin tool runs strip gameId from the input', async () => {
    const call = jest.fn(async () => null) as unknown as jest.MockedFunction<AgentCaller>
    await pluginToolRun({ plugin: 'ChayaBoost', tool: 'on' }, call)({ gameId: ' g2 ', rate: 3 }, ctx)
    expect(call).toHaveBeenCalledWith('g2', 'plugin.tool', { plugin: 'ChayaBoost', tool: 'on', input: { rate: 3 } })
  })
})
