import { PRODUCT_DISPLAY_NAME } from '@/constants/brand'
import type { PluginsJsEntry } from '@/lib/game/plugins-parse'

import type { PluginFamilyCount, PluginInfo, PluginStats } from './types'

/** 插件头 + `Imported.X` 一般都在文件前部；VisuStella 的 @help 很长，留够余量 */
export const PLUGIN_SOURCE_READ_BYTES = 256 * 1024

export type PluginHeader = {
  author?: string
  plugindesc?: string
  target: string[]
  version?: string
  url?: string
  base: string[]
  imported: string[]
}

const OFFICIAL_FAMILY = 'RPG Maker'
const CHAYA_FAMILY = PRODUCT_DISPLAY_NAME
const UNKNOWN_FAMILY = 'unknown'

/** 文件名前缀 → 插件系列；比作者字段稳定（作者常写成多语言或带链接） */
const PREFIX_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^VisuMZ_/, 'VisuStella'],
  [/^YEP_/, 'Yanfly'],
  [/^SRD_/, 'SumRndmDde'],
  [/^MOG_/, 'Moghunter'],
  [/^Galv_/, 'Galv'],
  [/^HIME_/, 'Hime'],
  [/^Olivia_/, 'Olivia'],
  [/^CGMZ_/, 'CGMZ'],
  [/^NUUN_/, 'NUUN'],
  [/^Torigoya_/, 'Torigoya'],
  [/^PKD_/, 'KageDesu'],
  [/^MPP_/, 'Mokusei Penguin'],
  [/^FTKR_/, 'Futokoro'],
  [/^DarkPlasma_/, 'DarkPlasma'],
]

/** 编辑器自带的官方插件 */
const OFFICIAL_PLUGINS = new Set([
  'Community_Basic',
  'MadeWithMv',
  'AltMenuScreen',
  'AltMenuScreen2',
  'AltSaveScreen',
  'EnemyBook',
  'ItemBook',
  'SimpleMsgSideView',
  'TitleCommandPosition',
  'WeaponSkill',
  'TextScriptBase',
  'ButtonPicture',
  'PluginCommonBase',
  'UniqueDataLoader',
])

const AUTHOR_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/yoji\s*ojima|kadokawa|gotcha\s*gotcha/i, OFFICIAL_FAMILY],
  [/triacontane|トリアコンタン/i, 'Triacontane'],
  [/yanfly/i, 'Yanfly'],
  [/visustella/i, 'VisuStella'],
]

const VERSION_IN_TEXT_RE = /\b(?:v|ver\.?|version)\s*(\d+(?:\.\d+)+[a-z]?)\b/i
const VERSION_IN_CODE_RE = /\.version\s*=\s*['"]?(\d+(?:\.\d+)+)/
const IMPORTED_RE = /\bImported\.(\w+)\s*=/g
const MAX_IMPORTED = 8

export function isChayaPlugin(name: string): boolean {
  return name.startsWith(PRODUCT_DISPLAY_NAME) || name.startsWith('ShiruKit')
}

/** 取默认语言的 `/*: … *\/` 块；没有时退回第一个本地化块（如 `/*:ja`） */
function headerBlock(source: string): string {
  const head = source.slice(0, PLUGIN_SOURCE_READ_BYTES)
  const plain = /\/\*:(?![A-Za-z])([\s\S]*?)(?:\*\/|$)/.exec(head)
  if (plain) return plain[1] ?? ''
  return /\/\*:[A-Za-z_]{2,8}\b([\s\S]*?)(?:\*\/|$)/.exec(head)?.[1] ?? ''
}

function tagValues(block: string, tag: string): string[] {
  const re = new RegExp(`^[\\s*]*@${tag}[ \\t]+(.+?)\\s*$`, 'gm')
  return Array.from(block.matchAll(re), (match) => match[1]!.trim()).filter(Boolean)
}

export function parsePluginHeader(source: string): PluginHeader {
  const block = headerBlock(source)
  const first = (tag: string) => tagValues(block, tag)[0]
  const plugindesc = first('plugindesc')
  const head = source.slice(0, PLUGIN_SOURCE_READ_BYTES)
  const version = first('version') ?? (plugindesc ? VERSION_IN_TEXT_RE.exec(plugindesc)?.[1] : undefined) ?? VERSION_IN_CODE_RE.exec(head)?.[1]
  const imported = Array.from(new Set(Array.from(head.matchAll(IMPORTED_RE), (match) => match[1]!))).slice(0, MAX_IMPORTED)
  return {
    author: first('author'),
    plugindesc,
    target: tagValues(block, 'target').flatMap((value) => value.split(/[\s,]+/).filter(Boolean)),
    version,
    url: first('url'),
    base: tagValues(block, 'base'),
    imported,
  }
}

export function pluginFamily(name: string, author?: string): string {
  if (isChayaPlugin(name)) return CHAYA_FAMILY
  if (OFFICIAL_PLUGINS.has(name)) return OFFICIAL_FAMILY
  for (const [re, family] of PREFIX_FAMILIES) if (re.test(name)) return family
  if (author) {
    for (const [re, family] of AUTHOR_FAMILIES) if (re.test(author)) return family
    const plain = author.replace(/\s*[(（<].*$/, '').trim()
    if (plain) return plain.slice(0, 32)
  }
  return UNKNOWN_FAMILY
}

export function buildPluginInfo(entry: PluginsJsEntry, source: string | null): PluginInfo {
  const header = source ? parsePluginHeader(source) : null
  const params = entry.parameters && typeof entry.parameters === 'object' ? Object.keys(entry.parameters).length : 0
  const description = typeof entry.description === 'string' && entry.description.trim() ? entry.description.trim() : header?.plugindesc
  return {
    name: entry.name,
    enabled: Boolean(entry.status),
    ...(description ? { description } : {}),
    paramCount: params,
    fileFound: source != null,
    family: pluginFamily(entry.name, header?.author),
    ...(header?.author ? { author: header.author } : {}),
    target: header?.target ?? [],
    ...(header?.version ? { version: header.version } : {}),
    ...(header?.url ? { url: header.url } : {}),
    imported: header?.imported ?? [],
    base: header?.base ?? [],
    chaya: isChayaPlugin(entry.name),
  }
}

export function pluginStats(plugins: readonly PluginInfo[]): PluginStats {
  const counts = new Map<string, number>()
  for (const plugin of plugins) counts.set(plugin.family, (counts.get(plugin.family) ?? 0) + 1)
  const families: PluginFamilyCount[] = Array.from(counts, ([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family))
  return {
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    missingFiles: plugins.filter((plugin) => !plugin.fileFound).length,
    families,
  }
}

/** 列表摘要用：去掉 Chaya / 官方 / 未知后的主要第三方系列 */
export function topThirdPartyFamilies(stats: PluginStats, limit = 3): string[] {
  return stats.families
    .filter((item) => item.family !== CHAYA_FAMILY && item.family !== OFFICIAL_FAMILY && item.family !== UNKNOWN_FAMILY)
    .slice(0, limit)
    .map((item) => item.family)
}
