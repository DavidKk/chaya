import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import type { TranslateRunEngine } from '@/lib/translate/engines'
import { fixKnownBadGameTermTranslation } from '@/lib/translate/game-terms'
import { type ExtractedTextCategory, type ExtractedTranslationItem, loadExtractedItems } from '@/services/extract/lib/extract-items'
import { assertOptimizeMayDispatch, isSystemIdleForOptimization, recordLiveTranslateActivity, trackLiveTranslateRequest } from '@/services/translate/live-activity'

import { loadGameTranslationRecords } from './game-records'
import { appendGameNdjson, liveTranslateTexts, resolveBoundContentRoot } from './live-translate'
import { openSharedCache } from './shared-cache'
import { isUsefulTranslation } from './text-classify'

export { assertOptimizeMayDispatch, isSystemIdleForOptimization, recordLiveTranslateActivity, trackLiveTranslateRequest }

export const OPTIMIZE_ENGINE_TERMS = 'live:optimize:terms'
export const OPTIMIZE_ENGINE_AGENT = 'live:optimize:agent'
export const SHORT_ENTITY_MAX_CHARS = 40

const NAME_CATEGORIES = new Set<ExtractedTextCategory>(['actor', 'item', 'weapon', 'armor', 'skill', 'enemy', 'state', 'map'])

export type TermFixCandidate = {
  src: string
  currentZh: string
  suggestedZh: string
  engine: string
  category?: ExtractedTextCategory
}

export type ScanOptimizationResult = {
  totalRecords: number
  termFixCandidates: TermFixCandidate[]
  polishCandidatesCount: number
  scope?: 'short-entities' | 'all'
  totalCandidates?: number
  byCategory?: Record<string, number>
  termFixable?: number
  alreadyOptimized?: number
  skippedManual?: number
}

export type ApplyTermFixesResult = {
  totalScanned: number
  fixedCount: number
  skippedRank: number
  items: Array<{ src: string; oldZh: string; newZh: string }>
}

/** Low-rank machine output eligible for optimization (not manual/import/already optimized). */
export function isMachineTranslationEngine(engine?: string | null): boolean {
  if (!engine) return true
  const lower = engine.toLowerCase()
  if (lower === 'manual' || lower.startsWith('manual:') || lower === 'import' || lower.startsWith('import:')) return false
  if (lower === 'live:optimize' || lower.startsWith('live:optimize:')) return false
  if (lower === 'manual:optimize') return false
  return true
}

export function isAlreadyOptimizedEngine(engine?: string | null): boolean {
  if (!engine) return false
  const lower = engine.toLowerCase()
  return lower === 'live:optimize' || lower.startsWith('live:optimize:')
}

function visibleLength(text: string): number {
  return Array.from(text.replace(/\\[A-Za-z]+(?:\[[^\]]*\])?/g, '').replace(/\s+/g, '')).length
}

export function isShortEntityItem(item: ExtractedTranslationItem, includeChoices = true): boolean {
  const cat = item.meta.category
  if (cat === 'dialogue' || cat === 'story') return false
  if (cat.endsWith('_desc') || cat === 'actor_profile') return false
  if (cat === 'choice') {
    if (!includeChoices) return false
  } else if (cat === 'actor_nickname') {
    /* allow when short */
  } else if (!NAME_CATEGORIES.has(cat)) {
    return false
  }
  const core = cat === 'choice' ? peelChoiceMetaShell(item.src).core : item.src
  const len = visibleLength(core)
  return len > 0 && len <= SHORT_ENTITY_MAX_CHARS
}

type ZhRow = { zh: string; engine: string }

function indexTranslations(contentRoot: string): Map<string, ZhRow> {
  const map = new Map<string, ZhRow>()
  for (const record of loadGameTranslationRecords(contentRoot)) {
    map.set(record.src, { zh: record.zh, engine: record.engine || '' })
  }
  return map
}

function writeOptimizePairs(contentRoot: string, pairs: Array<[string, string]>, engine: string, category?: string): { accepted: number; skippedRank: number } {
  if (!pairs.length) return { accepted: 0, skippedRank: 0 }
  const cache = openSharedCache()
  try {
    const written = cache.writeMany(pairs, engine, { to: 'zh', category })
    if (written.accepted.length) appendGameNdjson(contentRoot, written.accepted)
    const skippedRank = written.rejected.filter((r) => r.reason === 'rank' || r.reason === 'conflict').length
    return { accepted: written.accepted.length, skippedRank }
  } finally {
    cache.close()
  }
}

/** Scan local game records for known machine translation flaws and polish candidates. */
export function scanGameTranslationsForOptimization(
  contentRoot = resolveBoundContentRoot() || '',
  opts?: { scope?: 'short-entities' | 'all'; includeChoices?: boolean }
): ScanOptimizationResult {
  const root = contentRoot || resolveBoundContentRoot() || ''
  const scope = opts?.scope || 'all'
  if (!root) {
    return { totalRecords: 0, termFixCandidates: [], polishCandidatesCount: 0, scope, totalCandidates: 0 }
  }

  if (scope === 'short-entities') {
    const includeChoices = opts?.includeChoices !== false
    const extracted = loadExtractedItems(root)
    const zhIndex = indexTranslations(root)
    const termFixCandidates: TermFixCandidate[] = []
    const byCategory: Record<string, number> = {}
    let totalCandidates = 0
    let alreadyOptimized = 0
    let skippedManual = 0
    let needEngine = 0

    for (const item of extracted) {
      if (!isShortEntityItem(item, includeChoices)) continue
      totalCandidates++
      byCategory[item.meta.category] = (byCategory[item.meta.category] || 0) + 1
      const row = zhIndex.get(item.src)
      const zh = row?.zh || item.zh || ''
      const engine = row?.engine || ''
      if (!isMachineTranslationEngine(engine) && engine) {
        if (isAlreadyOptimizedEngine(engine)) alreadyOptimized++
        else skippedManual++
        continue
      }
      if (!zh) {
        needEngine++
        continue
      }
      const fixed = fixKnownBadGameTermTranslation(item.src, zh, 'zh')
      if (fixed && fixed !== zh) {
        termFixCandidates.push({ src: item.src, currentZh: zh, suggestedZh: fixed, engine, category: item.meta.category })
      } else if (!isAlreadyOptimizedEngine(engine)) {
        needEngine++
      } else {
        alreadyOptimized++
      }
    }

    return {
      totalRecords: extracted.length,
      termFixCandidates,
      polishCandidatesCount: needEngine,
      scope,
      totalCandidates,
      byCategory,
      termFixable: termFixCandidates.length,
      alreadyOptimized,
      skippedManual,
    }
  }

  const records = loadGameTranslationRecords(root)
  const termFixCandidates: TermFixCandidate[] = []
  let polishCandidatesCount = 0

  for (const record of records) {
    if (!isMachineTranslationEngine(record.engine)) continue
    const fixed = fixKnownBadGameTermTranslation(record.src, record.zh || '', 'zh')
    if (fixed && fixed !== record.zh) {
      termFixCandidates.push({
        src: record.src,
        currentZh: record.zh,
        suggestedZh: fixed,
        engine: record.engine || '',
      })
    } else {
      polishCandidatesCount++
    }
  }

  return {
    totalRecords: records.length,
    termFixCandidates,
    polishCandidatesCount,
    scope,
  }
}

/** Apply term fixes directly to cache and local game records, respecting rank. */
export function applyGameTermFixes(contentRoot = resolveBoundContentRoot() || '', opts?: { scope?: 'short-entities' | 'all'; includeChoices?: boolean }): ApplyTermFixesResult {
  const root = contentRoot || resolveBoundContentRoot() || ''
  if (!root) return { totalScanned: 0, fixedCount: 0, skippedRank: 0, items: [] }
  const scan = scanGameTranslationsForOptimization(root, opts)
  if (!scan.termFixCandidates.length) {
    return { totalScanned: scan.totalRecords, fixedCount: 0, skippedRank: 0, items: [] }
  }

  const toWrite: Array<[string, string]> = []
  const fixedItems: Array<{ src: string; oldZh: string; newZh: string }> = []
  for (const cand of scan.termFixCandidates) {
    toWrite.push([cand.src, cand.suggestedZh])
    fixedItems.push({ src: cand.src, oldZh: cand.currentZh, newZh: cand.suggestedZh })
  }
  const { accepted, skippedRank } = writeOptimizePairs(root, toWrite, OPTIMIZE_ENGINE_TERMS)
  return {
    totalScanned: scan.totalRecords,
    fixedCount: accepted,
    skippedRank,
    items: fixedItems.slice(0, accepted),
  }
}

export type BatchOptimizeOptions = {
  contentRoot?: string
  limit?: number
  engines?: TranslateRunEngine[]
  signal?: AbortSignal
  requireIdle?: boolean
}

export type BatchOptimizeResult = {
  totalProcessed: number
  optimizedCount: number
  skippedCount: number
  pausedReason?: string
  items: Array<{ src: string; oldZh: string; newZh: string; engine: string }>
}

/** Batch optimize low-rank machine translations (legacy / polish path). */
export async function batchOptimizeTranslations(options: BatchOptimizeOptions = {}): Promise<BatchOptimizeResult> {
  if (options.requireIdle !== false) {
    const gate = assertOptimizeMayDispatch('polish')
    if (!gate.ok) return { totalProcessed: 0, optimizedCount: 0, skippedCount: 0, pausedReason: gate.pausedReason, items: [] }
  }

  const contentRoot = options.contentRoot || resolveBoundContentRoot() || ''
  if (!contentRoot) return { totalProcessed: 0, optimizedCount: 0, skippedCount: 0, items: [] }

  const records = loadGameTranslationRecords(contentRoot)
  const candidates = records.filter((r) => isMachineTranslationEngine(r.engine))
  const slice = candidates.slice(0, Math.min(options.limit || 20, 100))

  const optimizedItems: Array<{ src: string; oldZh: string; newZh: string; engine: string }> = []
  let skippedCount = 0

  for (const record of slice) {
    options.signal?.throwIfAborted()
    if (options.requireIdle !== false) {
      const gate = assertOptimizeMayDispatch('polish')
      if (!gate.ok) {
        return {
          totalProcessed: slice.length,
          optimizedCount: optimizedItems.length,
          skippedCount,
          pausedReason: gate.pausedReason,
          items: optimizedItems,
        }
      }
    }

    const termFixed = fixKnownBadGameTermTranslation(record.src, record.zh || '', 'zh')
    if (termFixed && termFixed !== record.zh) {
      optimizedItems.push({ src: record.src, oldZh: record.zh, newZh: termFixed, engine: OPTIMIZE_ENGINE_TERMS })
      continue
    }

    if (options.engines && options.engines.length > 0) {
      try {
        const result = await liveTranslateTexts([record.src], {
          contentRoot,
          engines: options.engines,
          force: true,
          persist: false,
          trackLiveActivity: false,
        })
        const res = result.items[0]
        if (res && res.zh && isUsefulTranslation(record.src, record.src, res.zh, res.zh, 'zh') && res.zh !== record.zh) {
          optimizedItems.push({ src: record.src, oldZh: record.zh, newZh: res.zh, engine: OPTIMIZE_ENGINE_AGENT })
          continue
        }
      } catch {
        /* Ignore single failure */
      }
    }

    skippedCount++
  }

  if (optimizedItems.length > 0) {
    const toWrite = optimizedItems.map((item) => [item.src, item.newZh] as [string, string])
    writeOptimizePairs(contentRoot, toWrite, OPTIMIZE_ENGINE_AGENT)
  }

  return {
    totalProcessed: slice.length,
    optimizedCount: optimizedItems.length,
    skippedCount,
    items: optimizedItems,
  }
}

export type ShortEntityOptimizeOptions = {
  contentRoot?: string
  limit?: number
  engines?: TranslateRunEngine[]
  includeChoices?: boolean
  signal?: AbortSignal
  requireIdle?: boolean
}

export type ShortEntityOptimizeResult = {
  totalProcessed: number
  termFixed: number
  engineOptimized: number
  skippedCount: number
  skippedRank: number
  pausedReason?: string
  items: Array<{ src: string; oldZh: string; newZh: string; engine: string; category?: string }>
}

/** Phase-1 name/short-entity optimization: terms first, then optional engine polish. */
export async function runShortEntityOptimization(options: ShortEntityOptimizeOptions = {}): Promise<ShortEntityOptimizeResult> {
  if (options.requireIdle !== false) {
    const gate = assertOptimizeMayDispatch('short-entities')
    if (!gate.ok) {
      return { totalProcessed: 0, termFixed: 0, engineOptimized: 0, skippedCount: 0, skippedRank: 0, pausedReason: gate.pausedReason, items: [] }
    }
  }

  const contentRoot = options.contentRoot || resolveBoundContentRoot() || ''
  if (!contentRoot) {
    return { totalProcessed: 0, termFixed: 0, engineOptimized: 0, skippedCount: 0, skippedRank: 0, items: [] }
  }

  const includeChoices = options.includeChoices !== false
  const extracted = loadExtractedItems(contentRoot).filter((item) => isShortEntityItem(item, includeChoices))
  const zhIndex = indexTranslations(contentRoot)
  const limit = Math.min(options.limit || 40, 100)
  const items: ShortEntityOptimizeResult['items'] = []
  let termFixed = 0
  let engineOptimized = 0
  let skippedCount = 0
  let skippedRank = 0
  let processed = 0

  for (const item of extracted) {
    if (processed >= limit) break
    options.signal?.throwIfAborted()
    if (options.requireIdle !== false) {
      const gate = assertOptimizeMayDispatch('short-entities')
      if (!gate.ok) {
        return {
          totalProcessed: processed,
          termFixed,
          engineOptimized,
          skippedCount,
          skippedRank,
          pausedReason: gate.pausedReason,
          items,
        }
      }
    }

    const row = zhIndex.get(item.src)
    const oldZh = row?.zh || item.zh || ''
    const engine = row?.engine || ''
    if (!isMachineTranslationEngine(engine) && engine) {
      skippedCount++
      continue
    }
    processed++

    const fixed = oldZh ? fixKnownBadGameTermTranslation(item.src, oldZh, 'zh') : null
    if (fixed && fixed !== oldZh) {
      const write = writeOptimizePairs(contentRoot, [[item.src, fixed]], OPTIMIZE_ENGINE_TERMS, item.meta.category)
      if (write.accepted) {
        termFixed++
        items.push({ src: item.src, oldZh, newZh: fixed, engine: OPTIMIZE_ENGINE_TERMS, category: item.meta.category })
        zhIndex.set(item.src, { zh: fixed, engine: OPTIMIZE_ENGINE_TERMS })
      } else {
        skippedRank += write.skippedRank
      }
      continue
    }

    if (!options.engines?.length) {
      skippedCount++
      continue
    }

    try {
      const result = await liveTranslateTexts([item.src], {
        contentRoot,
        engines: options.engines,
        force: true,
        optimizeWholeName: true,
        persist: false,
        category: item.meta.category,
        trackLiveActivity: false,
      })
      const res = result.items[0]
      if (res?.zh && isUsefulTranslation(item.src, item.src, res.zh, res.zh, 'zh') && res.zh !== oldZh) {
        const write = writeOptimizePairs(contentRoot, [[item.src, res.zh]], OPTIMIZE_ENGINE_AGENT, item.meta.category)
        if (write.accepted) {
          engineOptimized++
          items.push({ src: item.src, oldZh, newZh: res.zh, engine: OPTIMIZE_ENGINE_AGENT, category: item.meta.category })
          zhIndex.set(item.src, { zh: res.zh, engine: OPTIMIZE_ENGINE_AGENT })
        } else {
          skippedRank += write.skippedRank
        }
        continue
      }
    } catch {
      /* ignore */
    }
    skippedCount++
  }

  return { totalProcessed: processed, termFixed, engineOptimized, skippedCount, skippedRank, items }
}
