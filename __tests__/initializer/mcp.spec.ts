import { handleMcpPost, type McpServerConfig } from '@/initializer/mcp'

const config: McpServerConfig = {
  serverInfo: { name: 'test', version: '0.0.1' },
  tools: [
    { name: 'echo', description: 'echo', inputSchema: { type: 'object' }, run: async (args, ctx) => ({ got: args.text, signal: ctx.signal instanceof AbortSignal }) },
    { name: 'boom', description: 'boom', inputSchema: { type: 'object' }, run: async () => Promise.reject(new Error('炸了')) },
    { name: 'hidden', description: 'hidden', inputSchema: { type: 'object' }, enabled: () => false, run: async () => 'no' },
  ],
}

function rpc(body: unknown) {
  return handleMcpPost(config, new Request('http://localhost/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}

describe('handleMcpPost', () => {
  it('initializes with a supported protocol version', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    const body = await res.json()
    expect(body.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'test' }, capabilities: { tools: {} } })
  })

  it('lists only enabled tools', async () => {
    const body = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(['echo', 'boom'])
  })

  it('calls tools and reports failures as isError', async () => {
    const ok = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } })).json()
    expect(JSON.parse(ok.result.content[0].text)).toEqual({ got: 'hi', signal: true })
    const bad = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom' } })).json()
    expect(bad.result).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('炸了') }] })
    const hidden = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'hidden' } })).json()
    expect(hidden.error).toBeDefined()
  })

  it('accepts notifications with 202', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
  })

  it('merges dynamic tools (static names win) and lists annotations', async () => {
    const dynamic: McpServerConfig = {
      ...config,
      tools: [{ ...config.tools[0], annotations: { readOnlyHint: true } }],
      dynamicTools: () => [
        { name: 'echo', description: 'shadow', inputSchema: { type: 'object' }, run: async () => 'shadow' },
        { name: 'plugin_x', description: 'x', inputSchema: { type: 'object' }, run: async () => 'x' },
      ],
    }
    const call = (body: unknown) =>
      handleMcpPost(dynamic, new Request('http://localhost/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
    const list = await (await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()
    expect(list.result.tools).toEqual([
      { name: 'echo', description: 'echo', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      { name: 'plugin_x', description: 'x', inputSchema: { type: 'object' } },
    ])
    const res = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'plugin_x' } })).json()
    expect(res.result.content[0].text).toContain('x')
  })
})
