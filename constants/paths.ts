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
 * Node-side absolute path constants (`@/constants/paths`).
 * **Do not** import from `'use client'` modules (`fileURLToPath` is unavailable in the browser).
 * Clients should import `@/constants/path-names` / `@/constants/brand` only.
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
 * Repo / toolkit root (based on this file by default; not cwd).
 * Packaged apps may set `CHAYA_ROOT` to extraResources app-root.
 */
export const ROOT_PATH = process.env.CHAYA_ROOT ? resolve(process.env.CHAYA_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Local data and shared shell.
 * Packaged apps set `CHAYA_DATA_DIR` to `userData/data` (Resources are read-only).
 */
export const DATA_DIR = process.env.CHAYA_DATA_DIR ? resolve(process.env.CHAYA_DATA_DIR) : join(ROOT_PATH, DATA_DIR_NAME)

/**
 * Toolkit config: repo root in development; under `CHAYA_DATA_DIR` when packaged
 * (avoid writing into the read-only app bundle).
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
/** Legacy brand shells under `data/{legacy}` */
export const LEGACY_SHELL_AT_DATA_PATHS = LEGACY_SHELL_APP_NAMES.map((name) => join(DATA_DIR, name))
/** Legacy brand shells under `data/shell/{legacy}` */
export const LEGACY_SHELL_IN_SHELL_PATHS = LEGACY_SHELL_APP_NAMES.map((name) => join(SHELL_DIR, name))

export const IS_WIN32 = process.platform === 'win32'
/** Default shared shell path for this platform (macOS `.app` / Windows `nw` dir) */
export const TOOLKIT_SHELL_PATH = IS_WIN32 ? SHELL_WIN_PATH : SHELL_APP_PATH

/** Shared translation cache */
export const TRANSLATE_CACHE_DIR = join(DATA_DIR, TRANSLATE_CACHE_DIR_NAME)
export const TRANSLATE_CACHE_DB_PATH = join(TRANSLATE_CACHE_DIR, TRANSLATE_CACHE_DB_NAME)
/** Seed translation background job state */
export const TRANSLATE_JOBS_DIR = join(DATA_DIR, TRANSLATE_JOBS_DIR_NAME)

/** Toolkit logs (`logs/plugins/` at repo root; packaged via `CHAYA_LOGS_DIR`) */
export const LOGS_DIR = process.env.CHAYA_LOGS_DIR ? resolve(process.env.CHAYA_LOGS_DIR) : join(ROOT_PATH, LOGS_DIR_NAME)
export const PLUGIN_LOGS_DIR = join(LOGS_DIR, PLUGIN_LOGS_DIR_NAME)

/** In-game plugin sources and build output */
export const PLUGINS_DIR = join(ROOT_PATH, PLUGINS_DIR_NAME)
export const PLUGINS_MANIFEST_PATH = join(PLUGINS_DIR, 'manifest.json')
/** @deprecated use PLUGINS_DIR */
export const PRESET_DIR = PLUGINS_DIR
/** @deprecated use PLUGINS_MANIFEST_PATH */
export const PRESET_MANIFEST_PATH = PLUGINS_MANIFEST_PATH
export const NODE_MODULES_DIR = join(ROOT_PATH, NODE_MODULES_DIR_NAME)
export const KUROMIJI_DICT_PATH = join(NODE_MODULES_DIR, 'kuromoji', 'dict')
