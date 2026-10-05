/**
 * Which catalog tools each MCP form serves. Pages, the plugin gateway and docs all read this one list.
 * - `server`: local service `/api/mcp`, every tool (eval still needs `CHAYA_MCP_EVAL=1`).
 * - `plugin`: in-game gateway of an Edge-opened game; only what runs inside the game process.
 */

import { MCP_TOOLS, type McpToolGroupId, type McpToolMeta } from './mcp-catalog'

export type McpHost = 'server' | 'plugin'

const PLUGIN_GROUPS: ReadonlySet<McpToolGroupId> = new Set(['live', 'edit', 'translate', 'cache', 'logs'])

/** Needs the local disk or the batch job queue, which only the local service has */
const PLUGIN_EXCLUDED: ReadonlySet<string> = new Set(['chaya_translate_batch'])

export function mcpToolAvailable(meta: Pick<McpToolMeta, 'name' | 'group' | 'evalOnly'>, host: McpHost): boolean {
  if (host === 'server') return true
  return PLUGIN_GROUPS.has(meta.group) && !meta.evalOnly && !PLUGIN_EXCLUDED.has(meta.name)
}

export function mcpToolsFor(host: McpHost): McpToolMeta[] {
  return MCP_TOOLS.filter((meta) => mcpToolAvailable(meta, host))
}

export const MCP_PLUGIN_INSTRUCTIONS = [
  'Chaya in-game gateway: tools for the running game only — play (state, recent story, screenshot, keys, tap, walk, quit), the edit page (ids, session, set values, actions), translation, translation library and plugin logs.',
  'Library, launching, plugin install, shell, batch translation and eval need the local Chaya server (dev or App).',
  'Play workflow: chaya_live_state → chaya_live_play with a short key sequence → inspect the returned state → repeat.',
  'Edit workflow: chaya_edit_catalog for ids → chaya_edit_set / chaya_edit_action → chaya_edit_state to confirm.',
  'Story help: when the user skipped dialogue or asks what to do next, read chaya_live_history, then chaya_live_state (chaya_live_screenshot only if the picture matters).',
  'Tools marked "Destructive" require the user\'s consent first.',
].join('\n')
