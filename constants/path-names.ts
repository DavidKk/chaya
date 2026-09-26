/**
 * 路径**名称**常量（浏览器 / Node 均可 import）。
 * 绝对路径见 `@/constants/paths`（仅 Node：含 `fileURLToPath`）。
 */

/** `data/` 下用途子目录名（禁止把运行时文件直接堆在 data 根） */
export const DATA_DIR_NAME = 'data'
export const SHELL_DIR_NAME = 'shell'
/** 官方 NW.js 下载解压缓存（装壳前临时/复用） */
export const SHELL_CACHE_DIR_NAME = 'shell-cache'
export const TRANSLATE_CACHE_DIR_NAME = 'translate-cache'
export const TRANSLATE_CACHE_DB_NAME = 'shared.sqlite'
/** Seed 补译后台任务状态目录 */
export const TRANSLATE_JOBS_DIR_NAME = 'translate-jobs'
export const LOGS_DIR_NAME = 'logs'
export const PLUGIN_LOGS_DIR_NAME = 'plugins'
/** 仓库根下游戏内插件源码与构建目录 */
export const PLUGINS_DIR_NAME = 'plugins'
/** @deprecated 使用 PLUGINS_DIR_NAME */
export const PRESET_DIR_NAME = PLUGINS_DIR_NAME
export const NODE_MODULES_DIR_NAME = 'node_modules'
