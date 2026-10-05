import { buildPageTools } from '@/components/webmcp/page/tools'
import type { Locale } from '@/lib/i18n/locales'
import { localizedToolDescription, WEB_TOOL_MESSAGES } from '@/lib/integration/mcp-catalog-i18n'
import { PLUGIN_TOOL_CATALOG } from '@/lib/runtime/plugin-tool-catalog'
import { pluginToolDescription, pluginToolName } from '@/lib/runtime/plugin-tools'

const CJK = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/

const webTools = buildPageTools({ navigate: () => {}, routes: () => [], context: () => ({}) })
const pluginTools = PLUGIN_TOOL_CATALOG.map((meta) => ({ name: pluginToolName(meta.plugin, meta.tool), description: pluginToolDescription(meta), meta }))

describe('WebMCP-only tool text', () => {
  it('keeps agent-facing definitions English', () => {
    expect(JSON.stringify(webTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))).not.toMatch(CJK)
    expect(JSON.stringify(PLUGIN_TOOL_CATALOG)).not.toMatch(CJK)
  })

  it.each(Object.keys(WEB_TOOL_MESSAGES))('has a %s display description for every tool and nothing extra', (locale) => {
    const expected = [...webTools.map((tool) => tool.name), ...pluginTools.map((tool) => tool.name)].sort()
    expect(Object.keys(WEB_TOOL_MESSAGES[locale as Locale]!).sort()).toEqual(expected)
  })

  it('falls back to the agent text for English', () => {
    const tool = pluginTools[0]!
    expect(localizedToolDescription(tool.name, tool.description, 'en')).toBe(tool.description)
    expect(localizedToolDescription(tool.name, tool.description, 'zh')).toBe(WEB_TOOL_MESSAGES.zh![tool.name])
  })
})
