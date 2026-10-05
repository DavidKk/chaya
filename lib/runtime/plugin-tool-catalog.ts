/**
 * Metadata of every first-party plugin tool. The game only reports which tools it implements; the
 * descriptions / schemas agents see always come from here, so game scripts cannot inject text.
 */

import type { JsonSchema, JsonSchemaObject } from '@/lib/integration/mcp-catalog'

export type PluginToolCatalogEntry = {
  /** ChayaEdit declares none: edits go through `chaya_edit_*` (docs/capabilities.md) */
  plugin: 'ChayaBoost' | 'ChayaTrans'
  tool: string
  title: string
  description: string
  inputSchema: JsonSchemaObject
  readOnly?: boolean
  destructive?: boolean
}

const num = (description: string): JsonSchema => ({ type: 'number', description })
const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchemaObject => ({ type: 'object', properties, ...(required.length ? { required } : {}) })

export const BOOST_DEFAULT_RATE = 3

export const PLUGIN_TOOL_CATALOG: readonly PluginToolCatalogEntry[] = [
  {
    plugin: 'ChayaBoost',
    tool: 'on',
    title: 'Boost on',
    description: `Turn on movement boost with always-dash; rate is the multiplier (default ${BOOST_DEFAULT_RATE}, 0.25–12).`,
    inputSchema: obj({ rate: num('Movement multiplier') }),
  },
  { plugin: 'ChayaBoost', tool: 'off', title: 'Boost off', description: 'Restore default movement speed and turn off always-dash.', inputSchema: obj() },
  {
    plugin: 'ChayaBoost',
    tool: 'status',
    title: 'Boost status',
    description: 'Read the current walk / run multipliers and the always-dash flag.',
    inputSchema: obj(),
    readOnly: true,
  },
  {
    plugin: 'ChayaTrans',
    tool: 'status',
    title: 'In-game translation status',
    description: 'Read in-game translation status: cache file, entry count, whether live translation is online, and the current mode.',
    inputSchema: obj(),
    readOnly: true,
  },
  {
    plugin: 'ChayaTrans',
    tool: 'reload',
    title: 'Reload translations',
    description: 'Reload the translation cache and refresh database and map text (use after editing the shared library).',
    inputSchema: obj(),
  },
]
