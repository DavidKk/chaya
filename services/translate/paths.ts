import fs from 'node:fs'
import path from 'node:path'

import { KUROMIJI_DICT_PATH, ROOT_PATH, TRANSLATE_CACHE_DB_PATH, TRANSLATE_CACHE_DIR } from '@/constants/paths'

import { gameContentPath, gameContentReadPath } from '../../lib/game/content-files'

/** @deprecated 请用 `@/constants` 的 `ROOT_PATH` */
export function kitRoot() {
  return ROOT_PATH
}

/** @deprecated 请用 `@/constants` 的 `TRANSLATE_CACHE_DIR` */
export function sharedCacheDir() {
  return TRANSLATE_CACHE_DIR
}

export function resolveKuromojiDict(contentRoot: string) {
  const candidates = [path.join(contentRoot, 'node_modules/kuromoji/dict'), KUROMIJI_DICT_PATH]
  return candidates.find((c) => fs.existsSync(c)) || candidates[0]
}

export function createPaths(contentRoot: string) {
  const root = path.resolve(contentRoot)
  return {
    contentRoot: root,
    kitRoot: ROOT_PATH,
    DATA: path.join(root, 'data'),
    INPUT: gameContentReadPath(root, 'seed') ?? gameContentPath(root, 'seed'),
    CACHE_NDJSON: gameContentPath(root, 'cacheNdjson'),
    SKIPPED_NDJSON: gameContentPath(root, 'skippedNdjson'),
    EXTRACTED: gameContentReadPath(root, 'extractStrings') ?? gameContentPath(root, 'extractStrings'),
    SWITCHES_FILE: gameContentPath(root, 'switches'),
    GLOSSARY_CACHE: gameContentPath(root, 'glossaryCache'),
    MERGED: gameContentPath(root, 'merged'),
    KUROMOJI_DIC: resolveKuromojiDict(root),
    SHARED_CACHE_DIR: TRANSLATE_CACHE_DIR,
    SHARED_CACHE_DB: TRANSLATE_CACHE_DB_PATH,
  }
}

export type TranslatePaths = ReturnType<typeof createPaths>
