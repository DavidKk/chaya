/** Seed progress and fill jobs use an explicit content root rather than the console's currently selected game. */
import fs from 'node:fs'

import { gameContentReadPath, localGameContentFile } from '@/lib/game/content-files'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { createNumericLabelIndex, numericLabelFamily } from '@/lib/translate/dynamic-template'
import type { SeedProgress, TranslationWindowReason } from '@/lib/translate/runtime-api'
import { detectSourceLanguage } from '@/lib/translate/source-text'
import { filterRgssSeedKeys } from '@/services/extract/lib/rgss'
import { getResolvedFromConfig } from '@/services/game/binding'

import { lookupCachedTranslation } from './cache-lookup'
import { getGameCacheContext } from './game-cache-context'
import { liveTranslateTexts } from './live-translate'
import { readSeedInventory } from './scheduler/seed-inventory'
import { prepareSeedInventory } from './scheduler/seed-prepare'
import { createScheduledSeedSession } from './scheduler/seed-session'
import { readSeedFailures, recordSeedFailure, seedFailureFile, writeSeedFailure } from './seed-failures'
import { openSharedCache } from './shared-cache'
import { charCount, lineCount, shouldTranslate } from './text-classify'

const DEFAULT_BATCH = 40

export type { SeedProgress } from '@/lib/translate/runtime-api'

export type FillMissingResult = SeedProgress & {
  windowReason?: TranslationWindowReason
  translated: number
  failed: number
  scanned: number
  pendingResults?: number
  performance?: { completedChars: number; cacheMs: number }
  /** Actual real-engine submissions in this result window; cache scans are not submissions. */
  submittedEngines?: string[]
  /** Cache lane was unavailable during this result window. */
  cacheUnavailable?: boolean
  /** Whether all items returned in this result window were pure cache hits without engine work. */
  cacheOnly?: boolean
  unresolved: string[]
  items: Array<{ src: string; zh: string | null; error?: string; engine?: string; engineWork?: boolean }>
}

type Scan = { progress: SeedProgress; missingKeys: string[]; signature: string }
const scans = new Map<string, Scan>()

export function resolveTranslateContentRoot(options?: { gameId?: string; contentRoot?: string }): string {
  if (options?.contentRoot) return options.contentRoot
  const resolved = getResolvedFromConfig(options?.gameId ? { gameId: options.gameId } : undefined)
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

function scanSeed(contentRoot: string, fresh = false, repair = false): Scan {
  const cache = openSharedCache()
  try {
    if (repair) cache.syncGameCache(contentRoot)
    const keys = loadSeedKeys(contentRoot)
    const signature = JSON.stringify([
      cache.path,
      cache.version(),
      keys,
      fs.statSync(seedFailureFile(contentRoot), { throwIfNoEntry: false })?.mtimeMs,
      [...readSeedFailures(contentRoot).keys()],
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
    const failures = readSeedFailures(contentRoot)
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
      } else if (failures.has(key)) {
        progress.failedCount = (progress.failedCount ?? 0) + 1
        progress.failedChars = (progress.failedChars ?? 0) + chars
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

/**
 * Sync progress helper for tests / explicit tools.
 * Console poll must use `getSeedJobSnapshot` (never this) — full `scanSeed` blocks Next.
 * Prefer `inventoryOnly: true` or `prepareSeedInventory` when a fresh inventory is needed.
 */
export function getSeedTranslateProgress(contentRoot = resolveTranslateContentRoot(), fresh = false, inventoryOnly = false): SeedProgress {
  return inventoryOnly ? readSeedInventory(contentRoot).progress : { ...scanSeed(contentRoot, fresh).progress }
}

/**
 * One-shot missing-batch fill (MCP / `mode: seed`).
 * Uses inventory (local fs + exact hits) — not full `scanSeed` shared-cache plans — so HTTP stays closer to job Start.
 * Batch success is taken from live results (not a second shared-cache coverage scan).
 */
export async function fillMissingFromSeed(opts?: { contentRoot?: string; limit?: number; exclude?: ReadonlySet<string> }): Promise<FillMissingResult> {
  const contentRoot = opts?.contentRoot ?? resolveTranslateContentRoot()
  const inventory = await prepareSeedInventory(contentRoot)
  if (!inventory.progress.hasSeed) throw new Error('Seed not found (please extract text first or provide *-trans.seed.json)')
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit || DEFAULT_BATCH)), DEFAULT_BATCH)
  const batch = inventory.pending.filter((key) => !opts?.exclude?.has(key)).slice(0, limit)
  if (!batch.length) return { ...inventory.progress, translated: 0, failed: 0, scanned: 0, unresolved: [], items: [] }
  const { items } = await liveTranslateTexts(batch, { contentRoot })
  for (const item of items) {
    if (item.engineWork && (item.zh == null || item.error || item.status === 'partial')) writeSeedFailure(contentRoot, item.src, item.error || 'No valid translation returned')
  }
  const bySrc = new Map(items.map((item) => [item.src, item]))
  const next = readSeedInventory(contentRoot)
  const stillPending = new Set(next.pending)
  // Batch-only shared get (not full scanSeed plans) to credit durable shared hits from this round.
  let cache: ReturnType<typeof openSharedCache> | undefined
  try {
    const unresolved = batch.filter((key) => {
      const item = bySrc.get(key)
      if (!item?.zh || item.error) return true
      if (!stillPending.has(key)) return false
      cache ??= openSharedCache()
      const hit = cache.get(key, { from: detectCacheLang(key), to: 'zh' })
      return !(typeof hit === 'string' && hit.trim())
    })
    const translated = batch.length - unresolved.length
    return { ...next.progress, translated, failed: unresolved.length, scanned: batch.length, unresolved, items }
  } finally {
    cache?.close()
  }
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
  let scan = scanSeed(contentRoot, false, true)
  onTrace?.(`Session prepared: items=${scan.progress.total}, missing=${scan.progress.missing}, elapsedMs=${Math.round(performance.now() - prepareStarted)}`)
  let progress = { ...scan.progress }
  let queue = [...scan.missingKeys]
  let cursor = 0
  function seedStamp() {
    const file = localGameContentFile(contentRoot, 'seed')
    const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined
    return JSON.stringify([file, stat?.mtimeMs, stat?.ctimeMs, stat?.size])
  }
  let stamp = seedStamp()
  function refresh() {
    scan = scanSeed(contentRoot, true, true)
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
      const terminalFailures = new Map<string, { src: string; error?: string }>()
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
        for (const item of result.items) {
          if (item.engineWork && (item.zh == null || item.error || item.status === 'partial') && !deadline.aborted) {
            terminalFailures.set(item.src, item)
          }
        }
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
        for (const key of unresolved) {
          const item = terminalFailures.get(key)
          if (item) recordSeedFailure(contentRoot, item, progress)
        }
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
