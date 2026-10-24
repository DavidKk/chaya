import { findNameSpans, type NameEntry } from '@/lib/translate/name-glossary'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { assertOptimizeMayDispatch } from '@/services/translate/live-activity'
import { appendGameNdjson, liveTranslateTexts, resolveBoundContentRoot } from '@/services/translate/live-translate'
import { loadGameNameEntries } from '@/services/translate/name-glossary-game'
import { planLockedNames, stitchLockedNamePlan } from '@/services/translate/name-lock'
import { openSharedCache } from '@/services/translate/shared-cache'

export const OPTIMIZE_ENGINE_NAMES = 'live:optimize:names'

export type NameSyncCandidate = {
  src: string
  oldZh: string
  newZh: string
  via: 'stitch' | 'rename' | 'review'
  engine?: string
}

export type ScanNameSyncResult = {
  totalRecords: number
  nameCount: number
  candidates: NameSyncCandidate[]
  skippedProtected: number
  unchanged: number
  review: number
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

function isProtectedEngine(engine?: string | null): boolean {
  if (!engine) return false
  const lower = engine.toLowerCase()
  return lower === 'manual' || lower.startsWith('manual:') || lower === 'import' || lower.startsWith('import:') || lower === 'reset'
}

function selectedEntries(all: NameEntry[], names?: string[]): NameEntry[] {
  if (names == null) return all
  if (!names.length) return []
  const allow = new Set(names)
  return all.filter((entry) => allow.has(entry.src) || names.some((name) => entry.src === name || entry.src.startsWith(`${name}'`) || entry.src.startsWith(`${name}\u2019`)))
}

function recordHasName(src: string, entries: NameEntry[]): boolean {
  return findNameSpans(src, entries).length > 0
}

function renameZh(oldZh: string, from: string, to: string): { zh: string; aligned: boolean } {
  if (!from || from === to || !oldZh.includes(from)) return { zh: oldZh, aligned: false }
  const next = oldZh.split(from).join(to)
  return { zh: next, aligned: next !== oldZh }
}

export function scanNameSentenceSync(
  contentRoot = resolveBoundContentRoot() || '',
  opts?: { names?: string[]; renameFrom?: string; renameTo?: string; targetLang?: string }
): ScanNameSyncResult {
  const root = contentRoot || resolveBoundContentRoot() || ''
  if (!root) return { totalRecords: 0, nameCount: 0, candidates: [], skippedProtected: 0, unchanged: 0, review: 0 }
  const entries = selectedEntries(loadGameNameEntries(root, opts?.targetLang || 'zh'), opts?.names)
  const records = loadGameTranslationRecords(root)
  const candidates: NameSyncCandidate[] = []
  let skippedProtected = 0
  let unchanged = 0
  let review = 0
  for (const record of records) {
    if (!recordHasName(record.src, entries)) continue
    if (isProtectedEngine(record.engine)) {
      skippedProtected++
      continue
    }
    const oldZh = typeof record.zh === 'string' ? record.zh : ''
    if (!oldZh) continue
    const plan = planLockedNames(record.src, entries, { targetLang: opts?.targetLang || 'zh' })
    if (!plan) continue
    if (plan.translatable.length) {
      if (opts?.renameFrom && opts.renameTo) {
        const renamed = renameZh(oldZh, opts.renameFrom, opts.renameTo)
        if (renamed.aligned && renamed.zh !== oldZh) {
          candidates.push({ src: record.src, oldZh, newZh: renamed.zh, via: 'rename', engine: record.engine })
          continue
        }
        if (!renamed.aligned) {
          review++
          candidates.push({ src: record.src, oldZh, newZh: oldZh, via: 'review', engine: record.engine })
          continue
        }
      }
      // Stitch preview without translating gaps: keep current remainder so users see name-only change when possible.
      const gapZh = new Map<string, string>()
      const preview = stitchLockedNamePlan(record.src, plan, gapZh)
      if (preview === oldZh) {
        unchanged++
        continue
      }
      candidates.push({ src: record.src, oldZh, newZh: preview, via: 'stitch', engine: record.engine })
      continue
    }
    const zh = stitchLockedNamePlan(record.src, plan, new Map())
    if (zh === oldZh) unchanged++
    else candidates.push({ src: record.src, oldZh, newZh: zh, via: 'stitch', engine: record.engine })
  }
  return { totalRecords: records.length, nameCount: entries.length, candidates, skippedProtected, unchanged, review }
}

export async function applyNameSentenceSync(options: {
  contentRoot?: string
  names?: string[]
  renameFrom?: string
  renameTo?: string
  limit?: number
  signal?: AbortSignal
  requireIdle?: boolean
  targetLang?: string
}): Promise<ApplyNameSyncResult> {
  if (options.requireIdle !== false) {
    const gate = assertOptimizeMayDispatch('short-entities')
    if (!gate.ok) return { totalProcessed: 0, applied: 0, skippedCount: 0, skippedRank: 0, review: 0, pausedReason: gate.pausedReason, items: [] }
  }
  const contentRoot = options.contentRoot || resolveBoundContentRoot() || ''
  if (!contentRoot) return { totalProcessed: 0, applied: 0, skippedCount: 0, skippedRank: 0, review: 0, items: [] }
  const scan = scanNameSentenceSync(contentRoot, options)
  const slice = scan.candidates.filter((item) => item.via !== 'review').slice(0, Math.min(options.limit || 80, 200))
  const items: NameSyncCandidate[] = []
  let applied = 0
  let skippedCount = 0
  let skippedRank = 0
  const cache = openSharedCache()
  try {
    for (const candidate of slice) {
      options.signal?.throwIfAborted()
      if (options.requireIdle !== false) {
        const gate = assertOptimizeMayDispatch('short-entities')
        if (!gate.ok) return { totalProcessed: items.length + skippedCount, applied, skippedCount, skippedRank, review: scan.review, pausedReason: gate.pausedReason, items }
      }
      let nextZh = candidate.newZh
      if (candidate.via === 'stitch') {
        const entries = selectedEntries(loadGameNameEntries(contentRoot, options.targetLang || 'zh'), options.names)
        const plan = planLockedNames(candidate.src, entries, { targetLang: options.targetLang || 'zh' })
        if (!plan) {
          skippedCount++
          continue
        }
        const gapZh = new Map<string, string>()
        if (plan.translatable.length) {
          const remainder = await liveTranslateTexts(
            plan.translatable.map((gap) => gap.text),
            { contentRoot, persist: false, trackLiveActivity: false, targetLang: options.targetLang || 'zh' }
          )
          let failed = false
          for (const gap of plan.translatable) {
            const hit = remainder.items.find((entry) => entry.src === gap.text)
            if (!hit?.zh || hit.error) {
              failed = true
              break
            }
            gapZh.set(gap.id, hit.zh)
          }
          if (failed) {
            skippedCount++
            continue
          }
        }
        nextZh = stitchLockedNamePlan(candidate.src, plan, gapZh)
      }
      if (!nextZh || nextZh === candidate.oldZh) {
        skippedCount++
        continue
      }
      const written = cache.writeMany([[candidate.src, nextZh]], OPTIMIZE_ENGINE_NAMES, { to: 'zh' })
      if (written.accepted.length) {
        appendGameNdjson(contentRoot, written.accepted)
        applied++
        items.push({ ...candidate, newZh: nextZh, via: candidate.via })
      } else {
        skippedRank += written.rejected.filter((row) => row.reason === 'rank' || row.reason === 'conflict').length
        skippedCount++
      }
    }
  } finally {
    cache.close()
  }
  return { totalProcessed: slice.length, applied, skippedCount, skippedRank, review: scan.review, items }
}
