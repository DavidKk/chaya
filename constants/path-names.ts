/**
 * Path **name** constants (safe for browser and Node).
 * Absolute paths live in `@/constants/paths` (Node only: uses `fileURLToPath`).
 */

/** Subdirectory names under `data/` (do not dump runtime files at data root) */
export const DATA_DIR_NAME = 'data'
export const SHELL_DIR_NAME = 'shell'
/** Official NW.js download/extract cache (temp / reuse before shell install) */
export const SHELL_CACHE_DIR_NAME = 'shell-cache'
/** Native RGSS runtime, verified downloads and per-game launch directories. */
export const RGSS_RUNTIME_DIR_NAME = 'rgss-runtime'
export const TRANSLATE_CACHE_DIR_NAME = 'translate-cache'
export const TRANSLATE_CACHE_DB_NAME = 'shared.sqlite'
/** Seed translation background job state directory */
export const TRANSLATE_JOBS_DIR_NAME = 'translate-jobs'
export const LOGS_DIR_NAME = 'logs'
export const PLUGIN_LOGS_DIR_NAME = 'plugins'
export const AGENT_ACTIVITY_LOGS_DIR_NAME = 'agent-activity'
export const GAME_ACTIVITY_LOGS_DIR_NAME = 'game-activity'
export const COMPANION_MEMORY_DIR_NAME = 'companion-memory'
export const COMPANION_MEMORY_DB_NAME = 'companion.sqlite'
/** Game Agent settings, secrets, CLI home (under `data/game-agent/`) */
export const GAME_AGENT_DIR_NAME = 'game-agent'
/** Bergamot / offline translation packs (under `data/translation-packs/`) */
export const TRANSLATION_PACKS_DIR_NAME = 'translation-packs'
/** Server download-center job snapshots (NW / RGSS; Bergamot has its own jobs/) */
export const DOWNLOAD_JOBS_FILE_NAME = 'download-jobs.json'
/** In-game plugin source + build directory at repo root */
export const PLUGINS_DIR_NAME = 'plugins'
/** @deprecated use PLUGINS_DIR_NAME */
export const PRESET_DIR_NAME = PLUGINS_DIR_NAME
export const NODE_MODULES_DIR_NAME = 'node_modules'
