/** Page-only translations of the MCP catalog; agents always get the English catalog. */
import type { Locale } from '@/lib/i18n/locales'

import { MCP_TOOL_GROUPS, MCP_TOOLS, type McpToolMeta } from './mcp-catalog'
import messages from './mcp-catalog-messages.json'
import webToolMessages from './web-tools-messages.json'

export type McpToolMessages = { title: string; description: string; params?: Record<string, string> }
export type McpCatalogMessages = { groups: Record<string, { title: string; summary: string }>; tools: Record<string, McpToolMessages> }

export const MCP_CATALOG_MESSAGES: Partial<Record<Locale, McpCatalogMessages>> = messages

/** Page-only descriptions of the WebMCP-only tools (`page_*`, `chaya_plugin_*`). */
export const WEB_TOOL_MESSAGES: Partial<Record<Locale, Record<string, string>>> = webToolMessages

/** Localized description of any registered tool name; falls back to the agent (English) text. */
export function localizedToolDescription(name: string, fallback: string, locale: Locale): string {
  return MCP_CATALOG_MESSAGES[locale]?.tools[name]?.description ?? WEB_TOOL_MESSAGES[locale]?.[name] ?? fallback
}

export function localizeMcpTool(tool: McpToolMeta, locale: Locale): McpToolMeta {
  const text = MCP_CATALOG_MESSAGES[locale]?.tools[tool.name]
  if (!text) return tool
  const properties = Object.fromEntries(
    Object.entries(tool.inputSchema.properties).map(([name, prop]) => [name, text.params?.[name] ? { ...prop, description: text.params[name] } : prop])
  )
  return { ...tool, title: text.title, description: text.description, inputSchema: { ...tool.inputSchema, properties } }
}

export function localizedMcpToolsByGroup(locale: Locale) {
  const pack = MCP_CATALOG_MESSAGES[locale]
  return MCP_TOOL_GROUPS.map((group) => ({
    ...group,
    ...pack?.groups[group.id],
    tools: MCP_TOOLS.filter((tool) => tool.group === group.id).map((tool) => localizeMcpTool(tool, locale)),
  }))
}
