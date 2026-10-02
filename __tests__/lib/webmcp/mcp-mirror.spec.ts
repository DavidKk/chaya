import { functionToolDefinition, MIRROR_MAX_CHARS, mirrorToolDefinition, parseMcpCallResult, webMcpAnnotations, webMcpCodedError } from '@/lib/webmcp/mcp-mirror'

describe('mcp-mirror', () => {
  it('marks read-only tools untrusted and the rest consequential', () => {
    expect(webMcpAnnotations(true)).toEqual({ readOnlyHint: true, untrustedContentHint: true })
    expect(webMcpAnnotations(false)).toEqual({ consequentialHint: true, untrustedContentHint: true })
    expect(webMcpAnnotations(undefined)).toEqual({ consequentialHint: true, untrustedContentHint: true })
  })

  it('parses MCP tools/call results into WebMCP envelopes', () => {
    expect(parseMcpCallResult({ content: [{ type: 'text', text: '{"a":1}' }] })).toEqual({ ok: true, result: { a: 1 } })
    expect(parseMcpCallResult({ content: [{ type: 'text', text: 'plain' }] })).toEqual({ ok: true, text: 'plain' })
    expect(parseMcpCallResult({ isError: true, content: [{ type: 'text', text: '没有游戏' }] })).toEqual({ ok: false, error: 'mcp_error', message: '没有游戏' })
    expect(parseMcpCallResult({ isError: true })).toMatchObject({ ok: false, error: 'mcp_error' })
    const long = parseMcpCallResult({ content: [{ type: 'text', text: 'x'.repeat(MIRROR_MAX_CHARS + 10) }] }) as unknown as { text: string; truncated: boolean }
    expect(long.truncated).toBe(true)
    expect(long.text).toHaveLength(MIRROR_MAX_CHARS)
  })

  it('mirrors a listed tool and forwards calls', async () => {
    const call = jest.fn(async () => ({ ok: true }))
    const def = mirrorToolDefinition({ name: 'chaya_game_status', annotations: { readOnlyHint: true } }, call)
    expect(def).toMatchObject({ description: 'chaya_game_status', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } })
    await def.execute({ q: 1 })
    expect(call).toHaveBeenCalledWith('chaya_game_status', { q: 1 })
  })

  it('wraps function tools and maps coded errors', async () => {
    const meta = { name: 't', description: 'd', inputSchema: { type: 'object' } }
    expect(await functionToolDefinition(meta, async () => undefined).execute({})).toEqual({ ok: true, result: null })
    expect(await functionToolDefinition(meta, async (args) => args.v).execute({ v: 2 })).toEqual({ ok: true, result: 2 })
    const offline = functionToolDefinition(meta, async () => Promise.reject(webMcpCodedError('game_offline', '未连接')))
    expect(await offline.execute({})).toEqual({ ok: false, error: 'game_offline', message: '未连接' })
    const plain = functionToolDefinition(meta, async () => Promise.reject(new Error('x')))
    expect(await plain.execute({})).toEqual({ ok: false, error: 'tool_error', message: 'x' })
  })
})
