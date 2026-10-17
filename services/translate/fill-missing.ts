/** Seed progress and fill jobs use an explicit content root rather than the console's currently selected game. */
import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { getResolvedFromConfig } from '@/services/game/binding'

import { lookupCachedTranslation } from './cache-lookup'
import { loadGameTranslateLookup } from './game-lookup'
import { loadGameTranslationRecords } from './game-records'
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
  const hits = new Map<string, string>()
  try {
    const records = loadGameTranslationRecords(contentRoot, (origin) => origin.database === cache.path && cache.current([{ ...origin, src: '', zh: '' }]))
    for (const key of needed) {
      const plan = cache.plan(key, { from: detectCacheLang(key), to: 'zh' }, records)
      const hit =
        plan.zh ?? (/\\(?:C\[|FS\[|RB\[|ruby\[)/i.test(key) ? lookupCachedTranslation((k) => local[k] ?? cache.get(k, { from: detectCacheLang(key), to: 'zh' }), key) : null)
      if (hit != null) hits.set(key, hit)
    }
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
    const hit = hits.get(key)
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

/** Exclude failures from the current job without persisting them to the cache; a new job can retry them. */
export async function fillMissingFromSeed(opts?: { contentRoot?: string; limit?: number; exclude?: ReadonlySet<string> }): Promise<FillMissingResult> {
  const contentRoot = opts?.contentRoot ?? resolveTranslateContentRoot()
  const { progress, missingKeys } = scanSeed(contentRoot, true)
  if (!progress.hasSeed) throw new Error('未找到 seed（请先抽取文本，或放入 *-trans.seed.json）')
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit || DEFAULT_BATCH)), DEFAULT_BATCH)
  const batch = missingKeys.filter((key) => !opts?.exclude?.has(key)).slice(0, limit)
  if (!batch.length) return { ...progress, translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] }
  const { items } = await liveTranslateTexts(batch, { contentRoot })
  const translated = items.filter((item) => item.zh && item.status !== 'partial' && !item.error && !isIdenticalTranslation(item.src, item.zh)).length
  const next = scanSeed(contentRoot, true)
  const attempted = new Set(batch)
  const unresolved = next.missingKeys.filter((key) => attempted.has(key))
  return { ...next.progress, translated, failed: unresolved.length, scanned: batch.length, unresolved, items }
}
