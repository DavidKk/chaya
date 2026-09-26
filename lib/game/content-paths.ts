/**
 * 游戏内容根下产物的相对路径（无 fs，可供 Node 服务与局内 plugins 共用）。
 *
 * 布局：
 *   chaya/translate/…  翻译管线
 *   chaya/config/…     局内配置
 *   chaya/plugins/…    跟踪插件磁盘缓存（清除时整目录清空）
 */
import { CONTENT_FILE_PREFIX } from '@/constants/brand'

/** 内容根下的品牌数据目录 */
export const GAME_CONTENT_DIR = CONTENT_FILE_PREFIX

/** 跟踪插件 IIFE 缓存目录（相对 `chaya/`） */
export const GAME_PLUGINS_CACHE_DIR = 'plugins'

/** 用户点过「清除 Loader」后写入；存在则启动/升级不再自动注入 */
export const GAME_PLUGINS_DISABLED_REL = 'config/plugins-disabled'

export const GAME_CONTENT_RELS = {
  seed: 'translate/seed.json',
  cacheNdjson: 'translate/cache.ndjson',
  switches: 'translate/switches.json',
  translationPlay: 'config/translation-play.json',
  glossaryCache: 'translate/glossary.cache.json',
  skippedNdjson: 'translate/skipped.ndjson',
  merged: 'translate/merged.json',
  extractStrings: 'translate/extract.strings.json',
  extractCompare: 'translate/extract.compare.json',
  gameEdit: 'config/game-edit.json',
} as const

export type GameContentKind = keyof typeof GAME_CONTENT_RELS

/** 旧扁平文件名（只读回退 / 迁移源，不新建） */
export const LEGACY_FLAT_FILES: Record<GameContentKind, readonly string[]> = {
  seed: [`${CONTENT_FILE_PREFIX}-trans.seed.json`, 'shiru-trans.seed.json', 'translate-both.seed.json'],
  cacheNdjson: [`${CONTENT_FILE_PREFIX}-trans.cache.ndjson`, 'shiru-trans.cache.ndjson', 'translate-both.cache.ndjson'],
  switches: [`${CONTENT_FILE_PREFIX}-trans.switches.json`, 'shiru-trans.switches.json', 'translate-switches.json', 'translate-both.switches.json'],
  translationPlay: [],
  glossaryCache: [`${CONTENT_FILE_PREFIX}-glossary.cache.json`, 'translate-glossary.cache.json'],
  skippedNdjson: [`${CONTENT_FILE_PREFIX}-trans.skipped.ndjson`, 'translate-both.skipped.ndjson'],
  merged: [`${CONTENT_FILE_PREFIX}-trans.merged.json`],
  extractStrings: [`${CONTENT_FILE_PREFIX}-extract.strings.json`, 'extracted-strings.json'],
  extractCompare: [`${CONTENT_FILE_PREFIX}-extract.compare.json`, 'extracted-compare.json'],
  gameEdit: [`${CONTENT_FILE_PREFIX}-game-edit.json`],
}

/** 相对内容根：`chaya/translate/cache.ndjson` */
export function gameContentRelPath(kind: GameContentKind): string {
  return `${GAME_CONTENT_DIR}/${GAME_CONTENT_RELS[kind]}`
}

/** 相对内容根：`chaya/plugins` */
export function gamePluginsCacheRelDir(): string {
  return `${GAME_CONTENT_DIR}/${GAME_PLUGINS_CACHE_DIR}`
}

/** 相对内容根：`chaya/config/plugins-disabled` */
export function gamePluginsDisabledRelPath(): string {
  return `${GAME_CONTENT_DIR}/${GAME_PLUGINS_DISABLED_REL}`
}
