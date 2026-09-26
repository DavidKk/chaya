/**
 * Path **name** constants (safe for browser and Node).
 * Absolute paths live in `@/constants/paths` (Node only: uses `fileURLToPath`).
 */

/** Subdirectory names under `data/` (do not dump runtime files at data root) */
export const DATA_DIR_NAME = 'data'
export const SHELL_DIR_NAME = 'shell'
/** Official NW.js download/extract cache (temp / reuse before shell install) */
export const SHELL_CACHE_DIR_NAME = 'shell-cache'
export const TRANSLATE_CACHE_DIR_NAME = 'translate-cache'
export const TRANSLATE_CACHE_DB_NAME = 'shared.sqlite'
/** Seed translation background job state directory */
export const TRANSLATE_JOBS_DIR_NAME = 'translate-jobs'
export const LOGS_DIR_NAME = 'logs'
export const PLUGIN_LOGS_DIR_NAME = 'plugins'
/** In-game plugin source + build directory at repo root */
export const PLUGINS_DIR_NAME = 'plugins'
/** @deprecated use PLUGINS_DIR_NAME */
export const PRESET_DIR_NAME = PLUGINS_DIR_NAME
export const NODE_MODULES_DIR_NAME = 'node_modules'
