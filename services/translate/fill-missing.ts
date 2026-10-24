/** Seed progress and fill jobs use an explicit content root rather than the console's currently selected game. */
import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { createNumericLabelIndex, numericLabelFamily } from '@/lib/translate/dynamic-template'
import { detectSourceLanguage } from '@/lib/translate/source-text'
import { filterRgssSeedKeys } from '@/services/extract/lib/rgss'
import { getResolvedFromConfig } from '@/services/game/binding'

import { lookupCachedTranslation } from './cache-lookup'
import { getGameCacheContext } from './game-cache-context'
import { liveTranslateTexts } from './live-translate'
import { readSeedInventory } from './scheduler/seed-inventory'
import { createScheduledSeedSession } from './scheduler/seed-session'
import { openSharedCache } from './shared-cache'
import { charCount, lineCount, shouldTranslate } from './text-classify'

const DEFAULT_BATCH = 40

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
  pendingResults?: number
  performance?: { completedChars: number; cacheMs: number }
  unresolved: string[]
  items: Array<{ src: string; zh: string | null; error?: string; engine?: string }>
}

type Scan = { progress: SeedProgress; missingKeys: string[]; signature: string }
const scans = new Map<string, Scan>()

export function resolveTranslateContentRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('Please bind a local game in the game library first')
  if (resolved.remote) throw new Error('Remote games must be bound locally before translating')
  return resolved.contentRoot
}

function loadSeedKeys(contentRoot: string): string[] {
  const file = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (!file || !fs.existsSync(file)) return []
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('seed must be an object mapping source text to translation')
  return filterRgssSeedKeys(
    contentRoot,
    Object.keys(raw).filter((key) => key.trim())
  )
}

export function getSeedSourceLanguage(contentRoot = resolveTranslateContentRoot()) {
  return detectSourceLanguage(loadSeedKeys(contentRoot))
}

/** Verify only the selected slice; progress polling must not scan the whole corpus. */
function seedCoverage(contentRoot: string, keys: string[], cache: ReturnType<typeof openSharedCache>, trace?: (message: string) => void) {
  const started = performance.now()
  const context = getGameCacheContext(contentRoot)
  const local = context.lookup
  const records = context.records
  const resolver = context.resolver
  trace?.(`Coverage game indexes loaded: records=${records.length}, elapsedMs=${Math.round(performance.now() - started)}`)
  const plansStarted = performance.now()
  const hits = new Map<string, string>()
  const numeric = new Map<string, ReturnType<typeof createNumericLabelIndex> | null>()
  for (const key of keys) {
    const plan = cache.plan(key, { from: detectCacheLang(key), to: 'zh' }, resolver.select(key))
    if (plan.limited) continue
    const from = detectCacheLang(key)
    const family = numericLabelFamily(key)
    const numericKey = JSON.stringify([from, family])
    if (family && !numeric.has(numericKey)) {
      const shared = cache.numericRecords({ from, to: 'zh' }, key)
      numeric.set(numericKey, shared.limited ? null : createNumericLabelIndex([...shared, ...context.numericRecords(key)]))
    }
    const hit =
      plan.zh ??
      numeric.get(numericKey)?.resolve(key) ??
      (/\\(?:C\[|FS\[|RB\[|ruby\[)/i.test(key) ? lookupCachedTranslation((k) => local[k] ?? cache.get(k, { from: detectCacheLang(key), to: 'zh' }), key) : null)
    if (hit != null) hits.set(key, hit)
  }
  trace?.(`Coverage cache plans resolved: items=${keys.length}, elapsedMs=${Math.round(performance.now() - plansStarted)}`)
  return hits
}

function scanSeed(contentRoot: string, fresh = false): Scan {
  const cache = openSharedCache()
  try {
    const keys = loadSeedKeys(contentRoot)
    const signature = JSON.stringify([
      cache.path,
      cache.version(),
      keys,
      ...(['seed', 'cacheNdjson'] as const).map((kind) => {
        const file = gameContentReadPath(contentRoot, kind, { alsoParent: true })
        const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
        return [file, stat?.mtimeMs, stat?.ctimeMs, stat?.size]
      }),
    ])
    const previous = scans.get(contentRoot)
    if (!fresh && previous?.signature === signature) {
      return previous
    }
    const hits = seedCoverage(contentRoot, keys.filter(shouldTranslate), cache)
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
    const scan = { progress, missingKeys, signature }
    if (scans.size >= 20 && !scans.has(contentRoot)) scans.delete(scans.keys().next().value!)
    scans.set(contentRoot, scan)
    return scan
  } finally {
    cache.close()
  }
}

export function getSeedTranslateProgress(contentRoot = resolveTranslateContentRoot(), fresh = false, inventoryOnly = false): SeedProgress {
  return inventoryOnly ? readSeedInventory(contentRoot).progress : { ...scanSeed(contentRoot, fresh).progress }
}

/** Exclude failures from the current job without persisting them to the cache; a new job can retry them. */
export async function fillMissingFromSeed(opts?: { contentRoot?: string; limit?: number; exclude?: ReadonlySet<string> }): Promise<FillMissingResult> {
  const contentRoot = opts?.contentRoot ?? resolveTranslateContentRoot()
  const { progress, missingKeys } = scanSeed(contentRoot, true)
  if (!progress.hasSeed) throw new Error('Seed not found (please extract text first or provide *-trans.seed.json)')
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit || DEFAULT_BATCH)), DEFAULT_BATCH)
  const batch = missingKeys.filter((key) => !opts?.exclude?.has(key)).slice(0, limit)
  if (!batch.length) return { ...progress, translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] }
  const { items } = await liveTranslateTexts(batch, { contentRoot })
  const next = scanSeed(contentRoot, true)
  const attempted = new Set(batch)
  const unresolved = next.missingKeys.filter((key) => attempted.has(key))
  const translated = batch.length - unresolved.length
  return { ...next.progress, translated, failed: unresolved.length, scanned: batch.length, unresolved, items }
}

export type SeedFillOptions = {
  limit?: number
  maxChars?: number
  exclude?: ReadonlySet<string>
  onItem?: (item: FillMissingResult['items'][number]) => void
  onTrace?: (message: string) => void
}

/** A job owns this cursor. Successful items already live in the durable translation cache.
 * Restart/resume builds a fresh cursor; only unfinished sources need inference again.
 */
export function createSeedFillSession(
  contentRoot: string,
  onTrace?: (message: string) => void,
  opts?: { nonBlocking?: boolean; inventory?: import('./scheduler/seed-prepare').SeedInventoryBundle }
) {
  if (opts?.nonBlocking) return createScheduledSeedSession(contentRoot, onTrace, { inventory: opts.inventory })
  const prepareStarted = performance.now()
  let scan = scanSeed(contentRoot)
  onTrace?.(`Session prepared: items=${scan.progress.total}, missing=${scan.progress.missing}, elapsedMs=${Math.round(performance.now() - prepareStarted)}`)
  let progress = { ...scan.progress }
  let queue = [...scan.missingKeys]
  let cursor = 0
  function seedStamp() {
    const file = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
    const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
    return JSON.stringify([file, stat?.mtimeMs, stat?.ctimeMs, stat?.size])
  }
  let stamp = seedStamp()
  function refresh() {
    scan = scanSeed(contentRoot, true)
    if (!scan.progress.hasSeed) throw new Error('Seed not found (please extract text first or provide *-trans.seed.json)')
    progress = { ...scan.progress }
    queue = [...scan.missingKeys]
    cursor = 0
    stamp = seedStamp()
  }
  return {
    get progress(): SeedProgress {
      return { ...progress }
    },
    get processed(): number | undefined {
      return undefined
    },
    pause() {},
    async close() {},
    async fill(opts: SeedFillOptions = {}): Promise<FillMissingResult> {
      const started = performance.now()
      const trace = opts.onTrace
      if (stamp !== seedStamp()) refresh()
      if (!progress.hasSeed) throw new Error('Seed not found (please extract text first or provide *-trans.seed.json)')
      const limit = Math.min(40, Math.max(1, Math.floor(Number.isFinite(opts.limit) ? opts.limit! : 40)))
      const maxChars = Math.max(1, opts.maxChars || 6000)
      const batch: string[] = []
      let chars = 0
      while (cursor < queue.length && batch.length < limit) {
        const key = queue[cursor]
        if (opts.exclude?.has(key)) {
          cursor++
          continue
        }
        if (batch.length && chars + key.length > maxChars) break
        cursor++
        batch.push(key)
        chars += key.length
      }
      if (!batch.length) {
        // Once at the end, reconcile against current authority (including manual edits).
        const reconcileStarted = performance.now()
        refresh()
        trace?.(`Full reconciliation: elapsedMs=${Math.round(performance.now() - reconcileStarted)}, missing=${progress.missing}`)
        if (queue.some((key) => !opts.exclude?.has(key))) return this.fill(opts)
        return { ...progress, translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] }
      }
      trace?.(
        `Batch selected: items=${batch.length}, sourceChars=${Array.from(batch.join('')).length}, budgetUnits=${chars}, charBudget=${maxChars}, elapsedMs=${Math.round(performance.now() - started)}`
      )
      let cacheMs = 0
      const translateStarted = performance.now()
      const deadline = AbortSignal.timeout(15_000)
      let items: FillMissingResult['items'] = []
      try {
        const result = await liveTranslateTexts(batch, {
          contentRoot,
          local: { signal: deadline },
          itemTimeoutMs: 15_000,
          onTrace: trace,
          onCacheMatch: (ms) => {
            cacheMs += ms
          },
          onItem: (item) => {
            items.push(item)
            opts.onItem?.(item)
          },
        })
        items = result.items
      } catch (error) {
        if (!deadline.aborted) throw error
        const received = new Set(items.map((item) => item.src))
        items.push(...batch.filter((src) => !received.has(src)).map((src) => ({ src, zh: null, error: 'Batch deadline exceeded; saved results are retained' })))
      }
      trace?.(`Translation pipeline finished: elapsedMs=${Math.round(performance.now() - translateStarted)}, results=${items.length}, deadlineExceeded=${deadline.aborted}`)
      const verifyStarted = performance.now()
      const cache = openSharedCache()
      try {
        const cacheStarted = performance.now()
        const hits = seedCoverage(contentRoot, batch, cache, trace)
        cacheMs += performance.now() - cacheStarted
        for (const key of hits.keys()) {
          progress.done++
          progress.missing--
          progress.doneChars += charCount(key)
          progress.missingChars -= charCount(key)
        }
        progress.batchesLeft = Math.ceil(progress.missing / limit)
        progress.batchSize = limit
        const unresolved = batch.filter((key) => !hits.has(key))
        trace?.(`Batch coverage verified: elapsedMs=${Math.round(performance.now() - verifyStarted)}, covered=${hits.size}, unresolved=${unresolved.length}`)
        if (!progress.missing) {
          const reconcileStarted = performance.now()
          refresh()
          trace?.(`Full reconciliation: elapsedMs=${Math.round(performance.now() - reconcileStarted)}, missing=${progress.missing}`)
        }
        trace?.(`Batch finished: elapsedMs=${Math.round(performance.now() - started)}`)
        return {
          ...progress,
          scanned: batch.length,
          translated: hits.size,
          failed: unresolved.length,
          unresolved,
          items,
          performance: { completedChars: [...hits.keys()].reduce((sum, key) => sum + charCount(key), 0), cacheMs },
        }
      } finally {
        cache.close()
      }
    },
  }
}
