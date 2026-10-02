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
const itemKind: JsonSchema = { type: 'string', enum: EDIT_ITEM_KINDS, description: 'item=物品、weapon=武器、armor=防具' }
const slot = obj({ slot: num('存档位（默认 1）') })

export const BOOST_DEFAULT_RATE = 3

export const PLUGIN_TOOL_CATALOG: readonly PluginToolCatalogEntry[] = [
  { plugin: 'ChayaEdit', tool: 'gold', title: '设置金钱', description: '把队伍金钱设为 value；不传 value 时只读当前金钱。', inputSchema: obj({ value: num('目标金钱') }) },
  {
    plugin: 'ChayaEdit',
    tool: 'item',
    title: '设置持有数',
    description: '把物品 / 武器 / 防具的持有数设为 count（id 用 chaya_edit_catalog 或 find 查）。',
    inputSchema: obj({ kind: itemKind, id: num('条目 id'), count: num('持有数（物品默认 99，装备默认 1）') }, ['id']),
  },
  {
    plugin: 'ChayaEdit',
    tool: 'variable',
    title: '变量',
    description: '读写游戏变量：传 value 时写入，否则只读。',
    inputSchema: obj({ id: num('变量 id'), value: num('新值') }, ['id']),
  },
  {
    plugin: 'ChayaEdit',
    tool: 'switch',
    title: '开关',
    description: '读写游戏开关：传 value 时写入，否则只读。',
    inputSchema: obj({ id: num('开关 id'), value: bool('开 / 关') }, ['id']),
  },
  { plugin: 'ChayaEdit', tool: 'god', title: '无敌', description: '开关无敌（我方不受伤害）；不传 on 时只读。', inputSchema: obj({ on: bool('开启') }) },
  { plugin: 'ChayaEdit', tool: 'through', title: '穿墙', description: '开关穿墙；不传 on 时只读。', inputSchema: obj({ on: bool('开启') }) },
  {
    plugin: 'ChayaEdit',
    tool: 'teleport',
    title: '传送',
    description: '传送到地图 mapId 的 (x, y)。',
    inputSchema: obj({ mapId: num('地图 id'), x: num('x'), y: num('y'), direction: num('朝向：2 下、4 左、6 右、8 上') }, ['mapId', 'x', 'y']),
  },
  { plugin: 'ChayaEdit', tool: 'common_event', title: '公共事件', description: '执行公共事件 id。', inputSchema: obj({ id: num('公共事件 id') }, ['id']) },
  { plugin: 'ChayaEdit', tool: 'save', title: '存档', description: '存到存档位 slot（默认 1，会覆盖该位）。', inputSchema: slot, destructive: true },
  { plugin: 'ChayaEdit', tool: 'load', title: '读档', description: '读取存档位 slot（默认 1），当前未保存进度会丢失。', inputSchema: slot, destructive: true },
  {
    plugin: 'ChayaEdit',
    tool: 'find',
    title: '查找条目',
    description: '按关键词在物品 / 武器 / 防具数据里找 id。',
    inputSchema: obj({ kind: itemKind, keyword: { type: 'string', description: '名称关键词' } }, ['keyword']),
    readOnly: true,
  },
  {
    plugin: 'ChayaBoost',
    tool: 'on',
    title: '开启加速',
    description: `开启移动加速并一直疾跑，rate 为倍率（默认 ${BOOST_DEFAULT_RATE}，0.25–12）。`,
    inputSchema: obj({ rate: num('移动倍率') }),
  },
  { plugin: 'ChayaBoost', tool: 'off', title: '关闭加速', description: '恢复默认移动速度并关闭一直疾跑。', inputSchema: obj() },
  { plugin: 'ChayaBoost', tool: 'status', title: '加速状态', description: '读取当前行走 / 跑步倍率与一直疾跑开关。', inputSchema: obj(), readOnly: true },
  {
    plugin: 'ChayaTrans',
    tool: 'status',
    title: '局内翻译状态',
    description: '读取局内翻译状态：缓存文件、词条数、实时翻译是否在线、当前翻译方式。',
    inputSchema: obj(),
    readOnly: true,
  },
  { plugin: 'ChayaTrans', tool: 'reload', title: '重载译文', description: '重新读取翻译缓存并刷新数据库与地图文本（改了共享翻译库后用）。', inputSchema: obj() },
]
