import type { TranslateRunEngine } from '@/lib/translate/engines'
import { fixKnownBadGameTermTranslation } from '@/lib/translate/game-terms'
import { getGamePresence } from '@/services/runtime/presence'

import { loadGameTranslationRecords } from './game-records'
import { appendGameNdjson, liveTranslateTexts, resolveBoundContentRoot } from './live-translate'
import { openSharedCache } from './shared-cache'
import { isUsefulTranslation } from './text-classify'

export type TermFixCandidate = {
  src: string
  currentZh: string
  suggestedZh: string
  engine: string
}

export type ScanOptimizationResult = {
  totalRecords: number
  termFixCandidates: TermFixCandidate[]
  polishCandidatesCount: number
}

export type ApplyTermFixesResult = {
  totalScanned: number
  fixedCount: number
  items: Array<{ src: string; oldZh: string; newZh: string }>
}

/** Check if translation engine or source is lower rank (eligible for machine optimization). */
export function isMachineTranslationEngine(engine?: string | null): boolean {
  if (!engine) return true
  const lower = engine.toLowerCase()
  if (lower === 'manual' || lower.startsWith('manual:') || lower === 'import' || lower.startsWith('import:')) return false
  return true
}

/** Scan local game records for known machine translation flaws and polish candidates. */
export function scanGameTranslationsForOptimization(contentRoot = resolveBoundContentRoot() || ''): ScanOptimizationResult {
  const root = contentRoot || resolveBoundContentRoot() || resolveBoundContentRoot() || ''
  if (!root) return { totalRecords: 0, termFixCandidates: [], polishCandidatesCount: 0 }
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
  }
}

/** Apply term fixes directly to cache and local game records, respecting rank. */
export function applyGameTermFixes(contentRoot = resolveBoundContentRoot() || ''): ApplyTermFixesResult {
  const root = contentRoot || resolveBoundContentRoot() || resolveBoundContentRoot() || ''
  if (!root) return { totalScanned: 0, fixedCount: 0, items: [] }
  const scan = scanGameTranslationsForOptimization(root)
  if (!scan.termFixCandidates.length) {
    return { totalScanned: scan.totalRecords, fixedCount: 0, items: [] }
  }

  const toWrite: Array<[string, string]> = []
  const fixedItems: Array<{ src: string; oldZh: string; newZh: string }> = []
  const cache = openSharedCache()

  try {
    for (const cand of scan.termFixCandidates) {
      toWrite.push([cand.src, cand.suggestedZh])
      fixedItems.push({ src: cand.src, oldZh: cand.currentZh, newZh: cand.suggestedZh })
    }
    cache.upsertOptimizeMany(toWrite, 'manual:optimize', { to: 'zh' })
    appendGameNdjson(root, toWrite)
  } finally {
    cache.close()
  }

  return {
    totalScanned: scan.totalRecords,
    fixedCount: fixedItems.length,
    items: fixedItems,
  }
}

let lastLiveTranslateRequestAt = 0
let activeLiveTranslateRequests = 0

export function recordLiveTranslateActivity(): void {
  lastLiveTranslateRequestAt = Date.now()
}

export function trackLiveTranslateRequest<T>(fn: () => Promise<T>): Promise<T> {
  activeLiveTranslateRequests++
  recordLiveTranslateActivity()
  return fn().finally(() => {
    activeLiveTranslateRequests = Math.max(0, activeLiveTranslateRequests - 1)
    recordLiveTranslateActivity()
  })
}

/** Determine whether the system is in an idle state for background optimization. */
export function isSystemIdleForOptimization(idleWindowMs = 5000): { isIdle: boolean; reason: string } {
  if (activeLiveTranslateRequests > 0) {
    return { isIdle: false, reason: 'Live translate requests in flight' }
  }
  const presence = getGamePresence()
  const now = Date.now()
  if (!presence.online) {
    return { isIdle: true, reason: 'Game offline' }
  }
  if (now - lastLiveTranslateRequestAt < idleWindowMs) {
    return { isIdle: false, reason: 'Recent in-game live translate activity' }
  }
  return { isIdle: true, reason: 'Game running but idle' }
}

export type BatchOptimizeOptions = {
  contentRoot?: string
  limit?: number
  engines?: TranslateRunEngine[]
  signal?: AbortSignal
}

export type BatchOptimizeResult = {
  totalProcessed: number
  optimizedCount: number
  skippedCount: number
  items: Array<{ src: string; oldZh: string; newZh: string; engine: string }>
}

/** Batch optimize low-rank machine translations using eligible translation engines or term fixes. */
export async function batchOptimizeTranslations(options: BatchOptimizeOptions = {}): Promise<BatchOptimizeResult> {
  const contentRoot = options.contentRoot || resolveBoundContentRoot() || ''
  if (!contentRoot) return { totalProcessed: 0, optimizedCount: 0, skippedCount: 0, items: [] }

  const records = loadGameTranslationRecords(contentRoot)
  const candidates = records.filter((r) => isMachineTranslationEngine(r.engine))
  const slice = candidates.slice(0, Math.min(options.limit || 20, 100))

  const optimizedItems: Array<{ src: string; oldZh: string; newZh: string; engine: string }> = []
  let skippedCount = 0

  for (const record of slice) {
    options.signal?.throwIfAborted()
    // 1. Check term fix first
    const termFixed = fixKnownBadGameTermTranslation(record.src, record.zh || '', 'zh')
    if (termFixed && termFixed !== record.zh) {
      optimizedItems.push({ src: record.src, oldZh: record.zh, newZh: termFixed, engine: 'builtin:terms' })
      continue
    }

    // 2. If engines provided, re-translate using engine polish
    if (options.engines && options.engines.length > 0) {
      try {
        const result = await liveTranslateTexts([record.src], {
          contentRoot,
          engines: options.engines,
          force: true,
          persist: false,
        })
        const res = result.items[0]
        if (res && res.zh && isUsefulTranslation(record.src, record.src, res.zh, res.zh, 'zh') && res.zh !== record.zh) {
          optimizedItems.push({ src: record.src, oldZh: record.zh, newZh: res.zh, engine: res.engine || 'live:optimize' })
          continue
        }
      } catch {
        // Ignore single failure
      }
    }

    skippedCount++
  }

  if (optimizedItems.length > 0) {
    const toWrite = optimizedItems.map((item) => [item.src, item.newZh] as [string, string])
    const cache = openSharedCache()
    try {
      cache.upsertOptimizeMany(toWrite, 'manual:optimize', { to: 'zh' })
      appendGameNdjson(contentRoot, toWrite)
    } finally {
      cache.close()
    }
  }

  return {
    totalProcessed: slice.length,
    optimizedCount: optimizedItems.length,
    skippedCount,
    items: optimizedItems,
  }
}
