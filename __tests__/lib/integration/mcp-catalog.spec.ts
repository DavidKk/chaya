jest.mock('@/app/api/extract/route.server', () => ({}))
jest.mock('@/app/api/game-edit/catalog/route.server', () => ({}))
jest.mock('@/app/api/launch/route.server', () => ({}))
jest.mock('@/app/api/logs/route', () => ({}))
jest.mock('@/app/api/plugins/route.server', () => ({}))
jest.mock('@/app/api/shell/route.server', () => ({}))
jest.mock('@/app/api/status/route', () => ({}))
jest.mock('@/app/api/translate/route.server', () => ({}))
jest.mock('@/app/api/translate-cache/route.server', () => ({}))
jest.mock('@/app/api/window/route.server', () => ({}))
jest.mock('@/services/game', () => ({}))
jest.mock('@/services/log', () => ({}))
jest.mock('@/services/runtime/agent-bridge', () => ({}))

import { CHAYA_MCP_SERVER, MCP_TOOL_IMPLS } from '@/app/api/mcp/_tools'
import type { Locale } from '@/lib/i18n/locales'
import { ASK_FIRST, MCP_INSTRUCTIONS, MCP_TOOL_GROUPS, MCP_TOOLS, mcpToolsByGroup } from '@/lib/integration/mcp-catalog'
import { localizedMcpToolsByGroup, localizeMcpTool, MCP_CATALOG_MESSAGES } from '@/lib/integration/mcp-catalog-i18n'

describe('MCP catalog', () => {
  it('has unique names following chaya_<group>_<verb>', () => {
    const names = MCP_TOOLS.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of MCP_TOOLS) expect(tool.name).toMatch(new RegExp(`^chaya_${tool.group}_[a-z_]+$`))
  })

  it('is aligned with the implementations both ways', () => {
    expect(Object.keys(MCP_TOOL_IMPLS).sort()).toEqual(MCP_TOOLS.map((tool) => tool.name).sort())
    expect(CHAYA_MCP_SERVER.tools.map((tool) => tool.name)).toEqual(MCP_TOOLS.map((tool) => tool.name))
  })

  it('declares required params inside properties and documents every tool', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.title).toBeTruthy()
      expect(tool.description).toBeTruthy()
      for (const key of tool.inputSchema.required ?? []) expect(tool.inputSchema.properties).toHaveProperty(key)
    }
  })

  it('marks destructive tools as ask-first in their description', () => {
    for (const tool of MCP_TOOLS.filter((t) => t.destructive)) expect(tool.description).toContain(ASK_FIRST)
  })

  it('keeps agent-facing text English', () => {
    const cjk = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/
    expect(JSON.stringify({ MCP_TOOLS, MCP_TOOL_GROUPS, MCP_INSTRUCTIONS })).not.toMatch(cjk)
  })

  it.each(Object.keys(MCP_CATALOG_MESSAGES))('translates every group, tool and top-level param for %s', (locale) => {
    const messages = MCP_CATALOG_MESSAGES[locale as Locale]!
    expect(Object.keys(messages.groups).sort()).toEqual(MCP_TOOL_GROUPS.map((g) => g.id).sort())
    expect(Object.keys(messages.tools).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort())
    for (const tool of MCP_TOOLS) {
      const entry = messages.tools[tool.name]
      expect(entry.title).toBeTruthy()
      expect(entry.description).toBeTruthy()
      expect(Object.keys(entry.params ?? {}).sort()).toEqual(Object.keys(tool.inputSchema.properties ?? {}).sort())
    }
  })

  it('localizes tools for the page while keeping names and schemas', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'chaya_logs_query')!
    expect(localizeMcpTool(tool, 'en')).toBe(tool)
    const zh = localizeMcpTool(tool, 'zh')
    expect(zh.name).toBe(tool.name)
    expect(zh.description).toBe(MCP_CATALOG_MESSAGES.zh!.tools[tool.name].description)
    expect(localizedMcpToolsByGroup('ja').map((g) => g.title)).toEqual(MCP_TOOL_GROUPS.map((g) => MCP_CATALOG_MESSAGES.ja!.groups[g.id].title))
  })

  it('groups every tool under a known group', () => {
    const groups = mcpToolsByGroup()
    expect(groups.map((g) => g.id)).toEqual(MCP_TOOL_GROUPS.map((g) => g.id))
    expect(groups.reduce((sum, g) => sum + g.tools.length, 0)).toBe(MCP_TOOLS.length)
    for (const group of groups) expect(group.tools.length).toBeGreaterThan(0)
  })

  it('hides eval-only tools unless CHAYA_MCP_EVAL=1', () => {
    const evalTool = CHAYA_MCP_SERVER.tools.find((tool) => tool.name === 'chaya_live_eval')
    const prev = process.env.CHAYA_MCP_EVAL
    try {
      delete process.env.CHAYA_MCP_EVAL
      expect(evalTool?.enabled?.()).toBe(false)
      process.env.CHAYA_MCP_EVAL = '1'
      expect(evalTool?.enabled?.()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.CHAYA_MCP_EVAL
      else process.env.CHAYA_MCP_EVAL = prev
    }
  })
})
