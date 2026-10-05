import { mcpToolAvailable, mcpToolsFor } from '@/lib/integration/mcp-availability'
import { MCP_TOOLS } from '@/lib/integration/mcp-catalog'

describe('mcp availability', () => {
  it('server serves every catalog tool', () => {
    expect(mcpToolsFor('server')).toHaveLength(MCP_TOOLS.length)
  })

  it('plugin serves in-game groups only, without eval / batch', () => {
    const names = mcpToolsFor('plugin').map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['chaya_live_state', 'chaya_edit_catalog', 'chaya_translate_text', 'chaya_cache_query', 'chaya_logs_query', 'chaya_logs_clear']))
    expect(names).not.toContain('chaya_live_eval')
    expect(names).not.toContain('chaya_translate_batch')
    expect(names.some((name) => name.startsWith('chaya_library_') || name.startsWith('chaya_game_'))).toBe(false)
  })

  it('checks a single tool', () => {
    expect(mcpToolAvailable({ name: 'chaya_game_launch', group: 'game' }, 'plugin')).toBe(false)
    expect(mcpToolAvailable({ name: 'chaya_game_launch', group: 'game' }, 'server')).toBe(true)
  })
})
