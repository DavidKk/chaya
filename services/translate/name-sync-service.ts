import { randomUUID } from 'node:crypto'

import { isZhNameTarget, type NameEntry } from '@/lib/translate/name-glossary'
import type { SentenceRecord } from '@/lib/translate/sentence-plan'
import { appendPublicGameCache } from '@/services/storage/game-files'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { assertOptimizeMayDispatch } from '@/services/translate/live-activity'
import { liveTranslateTexts, resolveBoundContentRoot } from '@/services/translate/live-translate'
import { loadGameNameEntries } from '@/services/translate/name-glossary-game'
import { planLockedNames, stitchLockedNamePlan } from '@/services/translate/name-lock'
import { openSharedCache } from '@/services/translate/shared-cache'

export const OPTIMIZE_ENGINE_NAMES = 'live:optimize:names'

export type NameSyncCandidate = {
  src: string
  oldZh: string
  newZh: string
  via: 'stitch' | 'review'
  engine?: string
}

export type ScanNameSyncResult = {
  totalRecords: number
  nameCount: number
  candidates: NameSyncCandidate[]
  skippedProtected: number
  unchanged: number
  review: number
  previewId?: string
  pausedReason?: string
  hasMore: boolean
}

export type ApplyNameSyncResult = {
  totalProcessed: number
  applied: number
  skippedCount: number
  skippedRank: number
  review: number
  pausedReason?: string
  items: NameSyncCandidate[]
}

type SyncOptions = {
  names?: string[]
  limit?: number
  signal?: AbortSignal
  requireIdle?: boolean
  sourceLang?: string
  targetLang?: string
}

type Preview = {
  root: string
  expires: number
  names?: string[]
  glossary: string
  scan: ScanNameSyncResult
  records: Map<string, string>
}

// Confirmation writes the exact preview, with bounded storage and no engine call during apply.
const previews = new Map<string, Preview>()
const PREVIEW_TTL = 10 * 60_000

function isProtectedEngine(engine?: string | null): boolean {
  const lower = (engine || '').toLowerCase()
  return lower === 'manual' || lower.startsWith('manual:') || lower.startsWith('import') || lower === 'reset' || lower === 'game:locales'
}

function selectedEntries(all: NameEntry[], names?: string[]): NameEntry[] {
  if (names == null) return all
  const allow = new Set(names)
  return all.filter((entry) => allow.has(entry.src) || names.some((name) => entry.src === `${name}'s` || entry.src === `${name}\u2019s`))
}

function signature(record: SentenceRecord): string {
  return JSON.stringify([record.id, record.revision, record.zh, record.engine])
}

function pauseReason(opts: SyncOptions): string | undefined {
  if (opts.requireIdle === false) return undefined
  const gate = assertOptimizeMayDispatch('short-entities')
  return gate.ok ? undefined : gate.pausedReason
}

export async function scanNameSentenceSync(contentRoot = resolveBoundContentRoot() || '', opts: SyncOptions = {}): Promise<ScanNameSyncResult> {
  const root = contentRoot || resolveBoundContentRoot() || ''
  const scan: ScanNameSyncResult = { totalRecords: 0, nameCount: 0, candidates: [], skippedProtected: 0, unchanged: 0, review: 0, hasMore: false }
  if (!root || !isZhNameTarget(opts.targetLang)) return scan
  const entries = selectedEntries(await loadGameNameEntries(root, 'zh'), opts.names)
  const records = loadGameTranslationRecords(root)
  scan.totalRecords = records.length
  scan.nameCount = entries.length
  if (!entries.length) return scan
  const limit = Math.max(1, Math.min(opts.limit ?? 80, 200))
  const snapshots = new Map<string, string>()
  for (const record of records) {
    opts.signal?.throwIfAborted()
    const plan = planLockedNames(record.src, entries, { sourceLang: opts.sourceLang, targetLang: 'zh' })
    if (!plan || plan.wholeName) continue
    if (isProtectedEngine(record.engine)) {
      scan.skippedProtected++
      continue
    }
    if (!record.zh) continue
    if (scan.candidates.length >= limit) {
      scan.hasMore = true
      break
    }
    const gapZh = new Map<string, string>()
    let failed = false
    for (const gap of plan.translatable) {
      scan.pausedReason = pauseReason(opts)
      if (scan.pausedReason) return scan
      const remainder = await liveTranslateTexts([gap.text], {
        contentRoot: root,
        sourceLang: opts.sourceLang,
        targetLang: 'zh',
        persist: false,
        trackLiveActivity: false,
        local: { signal: opts.signal },
      })
      const hit = remainder.items.find((item) => item.src === gap.text)
      if (!hit?.zh || hit.error) {
        failed = true
        break
      }
      gapZh.set(gap.id, hit.zh)
    }
    const newZh = failed ? record.zh : stitchLockedNamePlan(record.src, plan, gapZh)
    if (!failed && newZh === record.zh) {
      scan.unchanged++
      continue
    }
    scan.candidates.push({ src: record.src, oldZh: record.zh, newZh, via: failed ? 'review' : 'stitch', engine: record.engine ?? undefined })
    snapshots.set(record.src, signature(record))
    if (failed) scan.review++
  }
  opts.signal?.throwIfAborted()
  for (const [id, preview] of previews) if (preview.expires < Date.now()) previews.delete(id)
  if (previews.size >= 16) previews.delete(previews.keys().next().value!)
  const previewId = randomUUID()
  previews.set(previewId, {
    root,
    names: opts.names ? [...opts.names] : undefined,
    glossary: JSON.stringify(entries),
    expires: Date.now() + PREVIEW_TTL,
    scan: { ...scan, candidates: scan.candidates.map((item) => ({ ...item })) },
    records: snapshots,
  })
  return { ...scan, previewId }
}

export async function applyNameSentenceSync(options: SyncOptions & { contentRoot?: string; previewId: string }): Promise<ApplyNameSyncResult> {
  const result: ApplyNameSyncResult = { totalProcessed: 0, applied: 0, skippedCount: 0, skippedRank: 0, review: 0, items: [] }
  const root = options.contentRoot || resolveBoundContentRoot() || ''
  const preview = previews.get(options.previewId)
  if (!preview || preview.root !== root || preview.expires < Date.now() || !isZhNameTarget(options.targetLang)) {
    return { ...result, pausedReason: 'Preview expired or game changed; scan again' }
  }
  const entries = selectedEntries(await loadGameNameEntries(root, 'zh'), preview.names)
  if (JSON.stringify(entries) !== preview.glossary) return { ...result, pausedReason: 'Name translations changed; scan again' }
  result.pausedReason = pauseReason(options)
  if (result.pausedReason) return result
  if (previews.get(options.previewId) !== preview || preview.expires < Date.now()) return { ...result, pausedReason: 'Preview expired or already applied; scan again' }
  // Claim once before any writes so duplicate confirmation requests cannot replay the batch.
  previews.delete(options.previewId)
  result.review = preview.scan.review
  const current = new Map(loadGameTranslationRecords(root).map((record) => [record.src, record]))
  const cache = openSharedCache()
  try {
    for (const candidate of preview.scan.candidates) {
      options.signal?.throwIfAborted()
      result.pausedReason = pauseReason(options)
      if (result.pausedReason) break
      result.totalProcessed++
      const record = current.get(candidate.src)
      if (candidate.via === 'review' || !record || isProtectedEngine(record.engine) || signature(record) !== preview.records.get(candidate.src)) {
        result.skippedCount++
        continue
      }
      const written = cache.writeMany([[candidate.src, candidate.newZh]], OPTIMIZE_ENGINE_NAMES, { to: 'zh' })
      if (written.accepted.length) {
        appendPublicGameCache(
          root,
          written.accepted.map(([s, t]) => ({ s, t, engine: OPTIMIZE_ENGINE_NAMES, at: Date.now() }))
        )
        result.applied++
        result.items.push(candidate)
      } else {
        result.skippedRank += written.rejected.filter((row) => row.reason === 'rank' || row.reason === 'conflict').length
        result.skippedCount++
      }
    }
  } finally {
    cache.close()
  }
  return result
}
