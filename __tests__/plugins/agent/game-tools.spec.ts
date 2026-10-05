import { mcpToolsFor } from '@/lib/integration/mcp-availability'
import { makeGameTools } from '@/plugins/src/agent/game-tools'
import { startGameGateway } from '@/plugins/src/agent/gateway'

type Globals = Record<string, unknown>

describe('in-game plugin MCP tools', () => {
  const g = globalThis as unknown as Globals
  const ctx = { signal: new AbortController().signal }

  beforeEach(() => {
    g.window = globalThis
  })
  afterEach(() => {
    for (const key of ['window', 'ChayaLog', 'ChayaEdit', '__chayaTranslationRuntime']) delete g[key]
  })

  it('queries and clears the in-game log history', async () => {
    const clear = jest.fn()
    g.ChayaLog = {
      history: () => [
        { id: 1, ts: 1, level: 'info', source: 'ChayaEdit', message: 'ready' },
        { id: 2, ts: 2, level: 'fail', source: 'ChayaTrans', message: 'boom' },
      ],
      clear,
    }
    const tools = makeGameTools()
    await expect(tools.chaya_logs_query({ level: 'fail' }, ctx)).resolves.toMatchObject({ count: 1, entries: [{ id: '2', source: 'ChayaTrans' }] })
    await expect(tools.chaya_logs_clear({}, ctx)).resolves.toEqual({ cleared: true })
    expect(clear).toHaveBeenCalled()
  })

  it('reads the edit catalog from ChayaEdit', async () => {
    g.ChayaEdit = { catalog: () => ({ items: [{ id: 1, name: 'Potion' }], weapons: [], armors: [] }) }
    const result = await makeGameTools().chaya_edit_catalog({ kind: 'items' }, ctx)
    expect(JSON.stringify(result)).toContain('Potion')
  })

  it('explains missing plugins instead of failing silently', async () => {
    const tools = makeGameTools()
    await expect(tools.chaya_edit_catalog({ kind: 'items' }, ctx)).rejects.toThrow('修改插件未就绪')
    await expect(tools.chaya_translate_engines({}, ctx)).rejects.toThrow('翻译运行时未就绪')
    expect(tools.chaya_translate_batch).toBeUndefined()
  })

  it('gateway rpc lists the plugin tool set even without Node', async () => {
    const { control } = startGameGateway({ gameId: () => 'room-1', gameInfo: () => ({ name: 'Demo' }), log: { info: jest.fn(), warn: jest.fn() } })
    expect(control.available).toBe(false)
    const res = await control.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const names = ((res.body as { result: { tools: { name: string }[] } }).result.tools ?? []).map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(mcpToolsFor('plugin').map((tool) => tool.name)))
  })

  it('routes translate / cache through the translator runtime', async () => {
    const request = jest.fn(async () => ({ status: 200, data: { ok: true, engines: ['google'] } }))
    g.__chayaTranslationRuntime = { request, dispose: () => {} }
    await expect(makeGameTools().chaya_translate_engines({}, ctx)).resolves.toMatchObject({ engines: ['google'] })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/api/translate' }), expect.anything())
  })
})
