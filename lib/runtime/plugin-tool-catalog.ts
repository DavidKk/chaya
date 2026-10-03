/**
 * Metadata of every first-party plugin tool. The game only reports which tools it implements; the
 * descriptions / schemas agents see always come from here, so game scripts cannot inject text.
 */

import type { JsonSchema, JsonSchemaObject } from '@/lib/integration/mcp-catalog'

export type PluginToolCatalogEntry = {
  plugin: 'ChayaEdit' | 'ChayaBoost' | 'ChayaTrans'
  tool: string
  title: string
  description: string
  inputSchema: JsonSchemaObject
  readOnly?: boolean
  destructive?: boolean
}

const num = (description: string): JsonSchema => ({ type: 'number', description })
const bool = (description: string): JsonSchema => ({ type: 'boolean', description })
const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchemaObject => ({ type: 'object', properties, ...(required.length ? { required } : {}) })

export const EDIT_ITEM_KINDS = ['item', 'weapon', 'armor'] as const
const itemKind: JsonSchema = { type: 'string', enum: EDIT_ITEM_KINDS, description: 'item, weapon or armor' }
const slot = obj({ slot: num('Save slot (default 1)') })

export const BOOST_DEFAULT_RATE = 3

export const PLUGIN_TOOL_CATALOG: readonly PluginToolCatalogEntry[] = [
  {
    plugin: 'ChayaEdit',
    tool: 'gold',
    title: 'Set gold',
    description: 'Set party gold to value; without value, only read the current gold.',
    inputSchema: obj({ value: num('Target gold') }),
  },
  {
    plugin: 'ChayaEdit',
    tool: 'item',
    title: 'Set count',
    description: 'Set the owned count of an item / weapon / armor to count (look up id with chaya_edit_catalog or find).',
    inputSchema: obj({ kind: itemKind, id: num('Entry id'), count: num('Count (default 99 for items, 1 for equipment)') }, ['id']),
  },
  {
    plugin: 'ChayaEdit',
    tool: 'variable',
    title: 'Variable',
    description: 'Read or write a game variable: writes when value is given, otherwise reads.',
    inputSchema: obj({ id: num('Variable id'), value: num('New value') }, ['id']),
  },
  {
    plugin: 'ChayaEdit',
    tool: 'switch',
    title: 'Switch',
    description: 'Read or write a game switch: writes when value is given, otherwise reads.',
    inputSchema: obj({ id: num('Switch id'), value: bool('On / off') }, ['id']),
  },
  { plugin: 'ChayaEdit', tool: 'god', title: 'God mode', description: 'Toggle god mode (party takes no damage); without on, only read.', inputSchema: obj({ on: bool('Enable') }) },
  {
    plugin: 'ChayaEdit',
    tool: 'through',
    title: 'Walk through walls',
    description: 'Toggle walking through walls; without on, only read.',
    inputSchema: obj({ on: bool('Enable') }),
  },
  {
    plugin: 'ChayaEdit',
    tool: 'teleport',
    title: 'Teleport',
    description: 'Teleport to (x, y) on map mapId.',
    inputSchema: obj({ mapId: num('Map id'), x: num('x'), y: num('y'), direction: num('Facing: 2 down, 4 left, 6 right, 8 up') }, ['mapId', 'x', 'y']),
  },
  { plugin: 'ChayaEdit', tool: 'common_event', title: 'Common event', description: 'Run common event id.', inputSchema: obj({ id: num('Common event id') }, ['id']) },
  { plugin: 'ChayaEdit', tool: 'save', title: 'Save', description: 'Save to slot (default 1; overwrites that slot).', inputSchema: slot, destructive: true },
  { plugin: 'ChayaEdit', tool: 'load', title: 'Load', description: 'Load slot (default 1); unsaved progress is lost.', inputSchema: slot, destructive: true },
  {
    plugin: 'ChayaEdit',
    tool: 'find',
    title: 'Find entry',
    description: 'Find ids in item / weapon / armor data by keyword.',
    inputSchema: obj({ kind: itemKind, keyword: { type: 'string', description: 'Name keyword' } }, ['keyword']),
    readOnly: true,
  },
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
