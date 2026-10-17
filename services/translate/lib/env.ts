/** CLI environment: paths and mutable glossary state. Load kuromoji, undici and bing-translate-api on demand; report missing dependencies only when translation needs them. */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

import { createPaths, type TranslatePaths } from '../paths'
import { openSharedCache } from '../shared-cache'

const require = createRequire(import.meta.url)

export { fs, path }

export function loadKuromoji() {
  return require('kuromoji')
}

export function loadUndiciRequest() {
  return require('undici').request as typeof import('undici').request
}

export function loadBingApi() {
  return require('bing-translate-api').translate as (...args: unknown[]) => Promise<{ translation?: string }>
}

export function resolveContentRoot(argv = process.argv.slice(2)): string {
  const eq = argv.find((a) => a.startsWith('--root='))
  if (eq) return path.resolve(eq.slice('--root='.length))
  const i = argv.indexOf('--root')
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1])
  if (process.env.CHAYA_CONTENT_ROOT) return path.resolve(process.env.CHAYA_CONTENT_ROOT)
  return process.cwd()
}

export type GlossaryEntry = { jp: string; type: string; token: string }

/** Mutable glossary runtime shared across modules. */
export const glossary = {
  entries: [] as GlossaryEntry[],
  zh: {} as Record<string, string>,
}

type Runtime = {
  CONTENT_ROOT: string
  P: TranslatePaths
  INPUT: string
  CACHE_NDJSON: string
  SKIPPED_NDJSON: string
  EXTRACTED: string
  SWITCHES_FILE: string
  KUROMOJI_DIC: string
  GLOSSARY_CACHE: string
  SHARED_CACHE: ReturnType<typeof openSharedCache>
}

let current: Runtime | null = null

export function initRuntime(argv = process.argv.slice(2)): Runtime {
  const CONTENT_ROOT = resolveContentRoot(argv)
  const P = createPaths(CONTENT_ROOT)
  const SHARED_CACHE = openSharedCache(P.SHARED_CACHE_DB)
  current = {
    CONTENT_ROOT,
    P,
    INPUT: P.INPUT,
    CACHE_NDJSON: P.CACHE_NDJSON,
    SKIPPED_NDJSON: P.SKIPPED_NDJSON,
    EXTRACTED: P.EXTRACTED,
    SWITCHES_FILE: P.SWITCHES_FILE,
    KUROMOJI_DIC: P.KUROMOJI_DIC,
    GLOSSARY_CACHE: P.GLOSSARY_CACHE,
    SHARED_CACHE,
  }
  console.log(`[translate] contentRoot = ${CONTENT_ROOT}`)
  console.log(`[translate] sharedCache = ${P.SHARED_CACHE_DB}`)
  return current
}

export function rt(): Runtime {
  if (!current) throw new Error('translate runtime 未初始化；请先 initRuntime()')
  return current
}

export type { TranslatePaths }
