/**
 * ChayaEdit tools for MCP / WebMCP (`chaya_plugin_edit_*`); each wraps the console API.
 * Names / descriptions / schemas live in `lib/runtime/plugin-tool-catalog.ts`.
 */
import { EDIT_ITEM_KINDS } from '@/lib/runtime/plugin-tool-catalog'

import { declarePluginTools, toolBool, toolNum, toolStr } from '../../helpers/plugin-tools'

type ItemKind = (typeof EDIT_ITEM_KINDS)[number]

function edit() {
  if (!window.ChayaEdit) throw new Error('ChayaEdit 未就绪')
  return window.ChayaEdit
}

function kindOf(input: Record<string, unknown>): ItemKind {
  const kind = input.kind ?? 'item'
  if (!EDIT_ITEM_KINDS.includes(kind as ItemKind)) throw new Error('kind 只能是 item、weapon、armor')
  return kind as ItemKind
}

const optNum = (input: Record<string, unknown>, key: string) => (input[key] === undefined ? undefined : toolNum(input, key))

export function declareEditTools() {
  declarePluginTools('ChayaEdit', {
    gold: (input) => (input.value === undefined ? edit().gold() : edit().gold(toolNum(input, 'value'))),
    item: (input) => edit()[kindOf(input)](toolNum(input, 'id'), optNum(input, 'count')),
    variable: (input) => (input.value === undefined ? edit().var(toolNum(input, 'id')) : edit().var(toolNum(input, 'id'), toolNum(input, 'value'))),
    switch: (input) => (input.value === undefined ? edit().sw(toolNum(input, 'id')) : edit().sw(toolNum(input, 'id'), toolBool(input, 'value'))),
    god: (input) => (input.on === undefined ? edit().god() : edit().god(toolBool(input, 'on'))),
    through: (input) => (input.on === undefined ? edit().through() : edit().through(toolBool(input, 'on'))),
    teleport: (input) => edit().teleport(toolNum(input, 'mapId'), toolNum(input, 'x'), toolNum(input, 'y'), optNum(input, 'direction')),
    common_event: (input) => edit().commonEvent(toolNum(input, 'id')),
    save: (input) => edit().save(toolNum(input, 'slot', 1)),
    load: (input) => edit().load(toolNum(input, 'slot', 1)),
    find: (input) => {
      const keyword = toolStr(input, 'keyword')
      const kind = kindOf(input)
      return kind === 'weapon' ? edit().findWeapon(keyword) : kind === 'armor' ? edit().findArmor(keyword) : edit().findItem(keyword)
    },
  })
}
