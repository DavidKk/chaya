import { buildEdgeMcpTools, type EdgeToolDeps, loadEdgePluginTools } from '@/components/webmcp/edge'
import { MCP_TOOLS } from '@/lib/integration/mcp-catalog'
import { EDGE_UNAVAILABLE_TOOLS } from '@/lib/webmcp/mode-matrix'

function deps(overrides: Partial<EdgeToolDeps> = {}): EdgeToolDeps {
  return {
    connected: () => true,
    roomId: () => 'room-1',
    callAgent: jest.fn(async () => null) as unknown as EdgeToolDeps['callAgent'],
    translationRequest: jest.fn(async () => ({ status: 200, data: { ok: true } })),
    requestCatalog: jest.fn(),
    gameOnline: () => true,
    quit: jest.fn(),
    serviceMode: 'vercel',
    ...overrides,
  }
}

describe('Edge WebMCP tools', () => {
  it('offers every MCP tool except the documented unavailable ones', () => {
    const names = buildEdgeMcpTools(deps()).map((tool) => tool.name)
    const expected = MCP_TOOLS.map((tool) => tool.name).filter((name) => !EDGE_UNAVAILABLE_TOOLS[name])
    expect(names.sort()).toEqual(expected.sort())
    for (const name of Object.keys(EDGE_UNAVAILABLE_TOOLS)) expect(MCP_TOOLS.some((tool) => tool.name === name)).toBe(true)
  })

  it('keeps catalog schemas and read-only annotations', () => {
    const tools = buildEdgeMcpTools(deps())
    const state = tools.find((tool) => tool.name === 'chaya_live_state')
    expect(state?.inputSchema).toEqual(MCP_TOOLS.find((tool) => tool.name === 'chaya_live_state')?.inputSchema)
    expect(state?.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true })
    expect(tools.find((tool) => tool.name === 'chaya_cache_update')?.annotations).toMatchObject({ consequentialHint: true })
  })

  it('reports game_offline when the DataChannel is down', async () => {
    const tool = buildEdgeMcpTools(deps({ connected: () => false })).find((entry) => entry.name === 'chaya_live_state')
    expect(await tool?.execute({})).toMatchObject({ ok: false, error: 'game_offline' })
  })

  it('rejects a gameId that is not the linked room', async () => {
    const tool = buildEdgeMcpTools(deps()).find((entry) => entry.name === 'chaya_live_state')
    expect(await tool?.execute({ gameId: 'other' })).toMatchObject({ ok: false, error: 'tool_error' })
  })

  it('turns first-party plugin declarations into chaya_plugin_* tools', async () => {
    const callAgent = jest.fn(async (method: string) =>
      method === 'plugins.list'
        ? [
            { name: 'ChayaEdit', tools: [{ tool: 'gold', title: '金钱', description: '设置金钱', inputSchema: { type: 'object', properties: {} } }] },
            { name: 'ChayaEvil', tools: [{ tool: 'x', title: 'x', description: 'x', inputSchema: { type: 'object', properties: {} } }] },
          ]
        : { gold: 5 }
    ) as unknown as EdgeToolDeps['callAgent']
    const tools = await loadEdgePluginTools(deps({ callAgent }))
    expect(tools.map((tool) => tool.name)).toEqual(['chaya_plugin_edit_gold'])
    expect(await tools[0].execute({ value: 5 })).toEqual({ ok: true, result: { gold: 5 } })
    expect(callAgent).toHaveBeenLastCalledWith('plugin.tool', { plugin: 'ChayaEdit', tool: 'gold', input: { value: 5 } })
  })
})
