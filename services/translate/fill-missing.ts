/** Seed 进度与补译；后台任务显式传入内容根，不跟随控制台的选中状态。 */
import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { getResolvedFromConfig } from '@/services/game/binding'

import { lookupCachedTranslation, translationLookupKeys } from './cache-lookup'
import { loadGameTranslateLookup } from './game-lookup'
import { liveTranslateTexts } from './live-translate'
import { openSharedCache } from './shared-cache'
import { charCount, isIdenticalTranslation, lineCount, shouldTranslate } from './text-classify'

const DEFAULT_BATCH = 40
const PROGRESS_TTL_MS = 2_000

export type SeedProgress = {
  contentRoot: string
  hasSeed: boolean
  total: number
  done: number
  missing: number
  needCount: number
  skipCount: number
  needChars: number
  skipChars: number
  missingChars: number
  doneChars: number
  lines: number
  batchSize: number
  batchesLeft: number
}

export type FillMissingResult = SeedProgress & {
  translated: number
  failed: number
  scanned: number
  unresolved: string[]
  items: Array<{ src: string; zh: string | null; error?: string; engine?: string }>
}

type Scan = { progress: SeedProgress; missingKeys: string[]; at: number }
const scans = new Map<string, Scan>()

export function resolveTranslateContentRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('请先在游戏库绑定本地游戏')
  if (resolved.remote) throw new Error('远程游戏请在本机绑定后翻译')
  return resolved.contentRoot
}

function loadSeedKeys(contentRoot: string): string[] {
  const file = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (!file || !fs.existsSync(file)) return []
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('seed 必须是原文到译文的对象')
  return Object.keys(raw).filter((key) => key.trim())
}

function scanSeed(contentRoot: string, fresh = false): Scan {
  const previous = scans.get(contentRoot)
  if (!fresh && previous && Date.now() - previous.at < PROGRESS_TTL_MS) return previous
  const keys = loadSeedKeys(contentRoot)
  const local = loadGameTranslateLookup(contentRoot)
  const needed = keys.filter(shouldTranslate)
  const cache = openSharedCache()
  let shared: Map<string, string>
  try {
    shared = cache.getMany(needed.flatMap(translationLookupKeys))
  } finally {
    cache.close()
  }
  const progress: SeedProgress = {
    contentRoot,
    hasSeed: keys.length > 0,
    total: keys.length,
    done: 0,
    missing: 0,
    needCount: 0,
    skipCount: 0,
    needChars: 0,
    skipChars: 0,
    missingChars: 0,
    doneChars: 0,
    lines: 0,
    batchSize: DEFAULT_BATCH,
    batchesLeft: 0,
  }
  const missingKeys: string[] = []
  for (const key of keys) {
    const chars = charCount(key)
    progress.lines += lineCount(key)
    if (!shouldTranslate(key)) {
      progress.skipCount++
      progress.skipChars += chars
      continue
    }
    progress.needCount++
    progress.needChars += chars
    const hit = lookupCachedTranslation((k) => shared.get(k), key) ?? lookupCachedTranslation((k) => local[k], key)
    if (hit != null) {
      progress.done++
      progress.doneChars += chars
    } else {
      progress.missing++
      progress.missingChars += chars
      missingKeys.push(key)
    }
  }
  progress.batchesLeft = Math.ceil(progress.missing / DEFAULT_BATCH)
  const scan = { progress, missingKeys, at: Date.now() }
  if (scans.size >= 20 && !scans.has(contentRoot)) scans.delete(scans.keys().next().value!)
  scans.set(contentRoot, scan)
  return scan
}

export function getSeedTranslateProgress(contentRoot = resolveTranslateContentRoot(), fresh = false): SeedProgress {
  return { ...scanSeed(contentRoot, fresh).progress }
}

/** 失败项只在本次任务中排除，不写入翻译缓存；重新开始可重试。 */
export async function fillMissingFromSeed(opts?: { contentRoot?: string; limit?: number; exclude?: ReadonlySet<string> }): Promise<FillMissingResult> {
  const contentRoot = opts?.contentRoot ?? resolveTranslateContentRoot()
  const { progress, missingKeys } = scanSeed(contentRoot, true)
  if (!progress.hasSeed) throw new Error('未找到 seed（请先抽取文本，或放入 *-trans.seed.json）')
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit || DEFAULT_BATCH)), DEFAULT_BATCH)
  const batch = missingKeys.filter((key) => !opts?.exclude?.has(key)).slice(0, limit)
  if (!batch.length) return { ...progress, translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] }
  const { items } = await liveTranslateTexts(batch, { contentRoot })
  const translated = items.filter((item) => item.zh && !isIdenticalTranslation(item.src, item.zh)).length
  const next = scanSeed(contentRoot, true)
  const attempted = new Set(batch)
  const unresolved = next.missingKeys.filter((key) => attempted.has(key))
  return { ...next.progress, translated, failed: unresolved.length, scanned: batch.length, unresolved, items }
}
