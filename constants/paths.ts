import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAMES, LEGACY_SHELL_APP_NAMES, SHELL_APP_NAME, SHELL_WIN_DIR_NAME } from './brand'
import {
  DATA_DIR_NAME,
  LOGS_DIR_NAME,
  NODE_MODULES_DIR_NAME,
  PLUGIN_LOGS_DIR_NAME,
  PLUGINS_DIR_NAME,
  SHELL_CACHE_DIR_NAME,
  SHELL_DIR_NAME,
  TRANSLATE_CACHE_DB_NAME,
  TRANSLATE_CACHE_DIR_NAME,
  TRANSLATE_JOBS_DIR_NAME,
} from './path-names'

/**
 * Node 侧绝对路径常量（`@/constants/paths`）。
 * **禁止**被 `'use client'` 模块 import（`fileURLToPath` 在浏览器不可用）。
 * 客户端只 import `@/constants/path-names` / `@/constants/brand`。
 */

export {
  DATA_DIR_NAME,
  LOGS_DIR_NAME,
  NODE_MODULES_DIR_NAME,
  PLUGIN_LOGS_DIR_NAME,
  PLUGINS_DIR_NAME,
  PRESET_DIR_NAME,
  SHELL_CACHE_DIR_NAME,
  SHELL_DIR_NAME,
  TRANSLATE_CACHE_DB_NAME,
  TRANSLATE_CACHE_DIR_NAME,
  TRANSLATE_JOBS_DIR_NAME,
} from './path-names'

/**
 * 仓库 / 工具根（默认以本文件位置为准，不依赖 cwd）。
 * 打包 App 可通过 `CHAYA_ROOT` 指向 extraResources 内的 app-root。
 */
export const ROOT_PATH = process.env.CHAYA_ROOT ? resolve(process.env.CHAYA_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 本机数据与壳。
 * 打包 App 通过 `CHAYA_DATA_DIR` 指到 `userData/data`（Resources 只读）。
 */
export const DATA_DIR = process.env.CHAYA_DATA_DIR ? resolve(process.env.CHAYA_DATA_DIR) : join(ROOT_PATH, DATA_DIR_NAME)

/**
 * 工具配置：开发态仍在仓库根；打包态写入 `CHAYA_DATA_DIR`（避免写进只读 app bundle）。
 */
export const CONFIG_FILE_PATH = process.env.CHAYA_DATA_DIR ? join(DATA_DIR, CONFIG_FILE_NAME) : join(ROOT_PATH, CONFIG_FILE_NAME)
export const LEGACY_CONFIG_FILE_PATHS = [
  ...LEGACY_CONFIG_FILE_NAMES.map((name) => join(ROOT_PATH, name)),
  ...(process.env.CHAYA_DATA_DIR ? [join(ROOT_PATH, CONFIG_FILE_NAME), ...LEGACY_CONFIG_FILE_NAMES.map((name) => join(DATA_DIR, name))] : []),
]
export const SHELL_DIR = join(DATA_DIR, SHELL_DIR_NAME)
export const SHELL_CACHE_DIR = join(DATA_DIR, SHELL_CACHE_DIR_NAME)
export const SHELL_APP_PATH = join(SHELL_DIR, SHELL_APP_NAME)
export const SHELL_WIN_PATH = join(SHELL_DIR, SHELL_WIN_DIR_NAME)
/** 旧品牌壳：`data/{legacy}` */
export const LEGACY_SHELL_AT_DATA_PATHS = LEGACY_SHELL_APP_NAMES.map((name) => join(DATA_DIR, name))
/** 旧品牌壳：`data/shell/{legacy}` */
export const LEGACY_SHELL_IN_SHELL_PATHS = LEGACY_SHELL_APP_NAMES.map((name) => join(SHELL_DIR, name))

export const IS_WIN32 = process.platform === 'win32'
/** 当前平台默认共用壳路径（macOS `.app` / Windows `nw` 目录） */
export const TOOLKIT_SHELL_PATH = IS_WIN32 ? SHELL_WIN_PATH : SHELL_APP_PATH

/** 共享翻译缓存 */
export const TRANSLATE_CACHE_DIR = join(DATA_DIR, TRANSLATE_CACHE_DIR_NAME)
export const TRANSLATE_CACHE_DB_PATH = join(TRANSLATE_CACHE_DIR, TRANSLATE_CACHE_DB_NAME)
/** Seed 补译后台任务状态 */
export const TRANSLATE_JOBS_DIR = join(DATA_DIR, TRANSLATE_JOBS_DIR_NAME)

/** 工具日志（仓库根 `logs/plugins/`，非 data 下；打包可用 `CHAYA_LOGS_DIR`） */
export const LOGS_DIR = process.env.CHAYA_LOGS_DIR ? resolve(process.env.CHAYA_LOGS_DIR) : join(ROOT_PATH, LOGS_DIR_NAME)
export const PLUGIN_LOGS_DIR = join(LOGS_DIR, PLUGIN_LOGS_DIR_NAME)

/** 游戏内插件源码与构建产物 */
export const PLUGINS_DIR = join(ROOT_PATH, PLUGINS_DIR_NAME)
export const PLUGINS_MANIFEST_PATH = join(PLUGINS_DIR, 'manifest.json')
/** @deprecated 使用 PLUGINS_DIR */
export const PRESET_DIR = PLUGINS_DIR
/** @deprecated 使用 PLUGINS_MANIFEST_PATH */
export const PRESET_MANIFEST_PATH = PLUGINS_MANIFEST_PATH
export const NODE_MODULES_DIR = join(ROOT_PATH, NODE_MODULES_DIR_NAME)
export const KUROMIJI_DICT_PATH = join(NODE_MODULES_DIR, 'kuromoji', 'dict')
