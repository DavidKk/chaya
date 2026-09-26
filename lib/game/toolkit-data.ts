import fs from 'node:fs'
import path from 'node:path'

import { LEGACY_SHELL_APP_NAMES, SHELL_APP_NAME, SHELL_WIN_DIR_NAME, WIN_SHELL_EXE_NAMES } from '@/constants/brand'
import {
  DATA_DIR,
  DATA_DIR_NAME,
  LEGACY_SHELL_AT_DATA_PATHS,
  LEGACY_SHELL_IN_SHELL_PATHS,
  ROOT_PATH,
  SHELL_APP_PATH,
  SHELL_DIR,
  SHELL_DIR_NAME,
  SHELL_WIN_PATH,
  TOOLKIT_SHELL_PATH,
  TRANSLATE_CACHE_DB_NAME,
  TRANSLATE_CACHE_DB_PATH,
  TRANSLATE_CACHE_DIR,
  TRANSLATE_CACHE_DIR_NAME,
} from '@/constants/paths'

import { isWin32, toolkitShellFolderName } from './shell-layout'

export { SHELL_APP_NAME }

/**
 * 工具本机数据根。默认即 `@/constants` 的 `DATA_DIR`；仅自定义 toolkitRoot 时再拼接。
 */
export function toolkitDataDir(toolkitRoot = ROOT_PATH): string {
  if (toolkitRoot === ROOT_PATH) return DATA_DIR
  return path.join(path.resolve(toolkitRoot), DATA_DIR_NAME)
}

/** 共用壳目录：`data/shell/` */
export function toolkitShellDir(toolkitRoot = ROOT_PATH): string {
  if (toolkitRoot === ROOT_PATH) return SHELL_DIR
  return path.join(toolkitDataDir(toolkitRoot), SHELL_DIR_NAME)
}

/**
 * 本地工具共用壳根：
 * - macOS：`data/shell/{SHELL_APP_NAME}`（Chaya.app）
 * - Windows / Linux：`data/shell/{SHELL_WIN_DIR_NAME}`（Chaya/）
 */
export function toolkitShellAppPath(toolkitRoot = ROOT_PATH, platform = process.platform): string {
  if (toolkitRoot === ROOT_PATH && platform === process.platform) return TOOLKIT_SHELL_PATH
  return path.join(toolkitShellDir(toolkitRoot), toolkitShellFolderName(platform))
}

/** 旧品牌壳：`data/{legacyName}`（只回退，不新建） */
export function legacyToolkitShellAppPath(toolkitRoot = ROOT_PATH, legacyName: string = LEGACY_SHELL_APP_NAMES[0]): string {
  if (toolkitRoot === ROOT_PATH) {
    const hit = LEGACY_SHELL_AT_DATA_PATHS.find((p) => path.basename(p) === legacyName)
    if (hit) return hit
  }
  return path.join(toolkitDataDir(toolkitRoot), legacyName)
}

/** 共用壳：优先当前品牌，再回退旧品牌路径常量 */
export function resolveToolkitShellAppPath(toolkitRoot = ROOT_PATH, platform = process.platform): string {
  const primary = toolkitShellAppPath(toolkitRoot, platform)
  if (fs.existsSync(primary)) return primary
  if (!isWin32(platform)) {
    const inShell = toolkitRoot === ROOT_PATH ? LEGACY_SHELL_IN_SHELL_PATHS : LEGACY_SHELL_APP_NAMES.map((n) => path.join(toolkitShellDir(toolkitRoot), n))
    const atData = toolkitRoot === ROOT_PATH ? LEGACY_SHELL_AT_DATA_PATHS : LEGACY_SHELL_APP_NAMES.map((n) => path.join(toolkitDataDir(toolkitRoot), n))
    for (let i = 0; i < inShell.length; i++) {
      if (fs.existsSync(inShell[i])) return inShell[i]
      if (fs.existsSync(atData[i])) return atData[i]
    }
  }
  return primary
}

/** 共享翻译缓存目录：`data/translate-cache/` */
export function toolkitTranslateCacheDir(toolkitRoot = ROOT_PATH): string {
  if (toolkitRoot === ROOT_PATH) return TRANSLATE_CACHE_DIR
  return path.join(toolkitDataDir(toolkitRoot), TRANSLATE_CACHE_DIR_NAME)
}

export function toolkitTranslateCacheDbPath(toolkitRoot = ROOT_PATH): string {
  if (toolkitRoot === ROOT_PATH) return TRANSLATE_CACHE_DB_PATH
  return path.join(toolkitTranslateCacheDir(toolkitRoot), TRANSLATE_CACHE_DB_NAME)
}

/** @deprecated 请从 `@/constants` 引用 */
export { SHELL_APP_PATH, SHELL_DIR, SHELL_WIN_DIR_NAME, SHELL_WIN_PATH, TOOLKIT_SHELL_PATH, WIN_SHELL_EXE_NAMES }
