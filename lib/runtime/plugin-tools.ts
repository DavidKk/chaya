/**
 * Plugin-declared tools: in-game Chaya plugins implement tools from `PLUGIN_TOOL_CATALOG`; ChayaAgent
 * reports which ones and the local MCP / WebMCP expose them as `chaya_plugin_<plugin>_<tool>`.
 */

import { PLUGIN_TOOL_CATALOG, type PluginToolCatalogEntry } from './plugin-tool-catalog'

export type PluginToolMeta = PluginToolCatalogEntry

export const FIRST_PARTY_TOOL_PLUGINS = ['ChayaEdit', 'ChayaBoost', 'ChayaTrans'] as const

export const PLUGIN_TOOL_PREFIX = 'chaya_plugin_'

export function isFirstPartyToolPlugin(plugin: string): boolean {
  return (FIRST_PARTY_TOOL_PLUGINS as readonly string[]).includes(plugin)
}

/** `ChayaEdit` + `gold` → `chaya_plugin_edit_gold` */
export function pluginToolName(plugin: string, tool: string): string {
  return `${PLUGIN_TOOL_PREFIX}${plugin.replace(/^Chaya/, '').toLowerCase()}_${tool}`
}

export function findPluginToolMeta(plugin: unknown, tool: unknown): PluginToolMeta | undefined {
  return PLUGIN_TOOL_CATALOG.find((entry) => entry.plugin === plugin && entry.tool === tool)
}

/**
 * Untrusted reports (from the game or the network) → catalog entries. Only `plugin` / `tool` are
 * read; reported titles, descriptions and schemas are ignored.
 */
export function sanitizePluginTools(raw: unknown): PluginToolMeta[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<PluginToolMeta>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const meta = findPluginToolMeta((item as Record<string, unknown>).plugin, (item as Record<string, unknown>).tool)
    if (meta) out.add(meta)
  }
  return [...out]
}

/** Tool description shown to agents: plugin prefix + destructive warning. */
export function pluginToolDescription(meta: PluginToolMeta): string {
  const ask = meta.destructive ? ' 破坏性操作：调用前必须先征得用户同意。' : ''
  return `[${meta.plugin}] ${meta.description}${ask}`
}
