import { dispatchMcp, type McpServerConfig } from '@/lib/integration/mcp-protocol'
import { mcpImage } from '@/lib/integration/tools/types'

const SERVER: McpServerConfig = {
  serverInfo: { name: 'chaya', version: 'test' },
  tools: [
    { name: 'shot', description: 'shot', inputSchema: { type: 'object' }, run: async () => mcpImage({ mimeType: 'image/jpeg', data: 'AAAA' }, { width: 512 }) },
    { name: 'text', description: 'text', inputSchema: { type: 'object' }, run: async () => ({ a: 1 }) },
  ],
}

const call = async (name: string) => {
  const res = await dispatchMcp(SERVER, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } })
  return (res.body as { result: { content: unknown[] } }).result.content
}

describe('MCP image content', () => {
  it('emits image + metadata text for image results', async () => {
    expect(await call('shot')).toEqual([
      { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
      { type: 'text', text: JSON.stringify({ width: 512 }, null, 2) },
    ])
  })

  it('keeps plain results as a single text part', async () => {
    expect(await call('text')).toEqual([{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }])
  })
})
