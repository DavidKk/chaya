import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { normalizeTranslateKey, type TranslateExtraGet, translateWithLookup } from '@/lib/translate/lookup'
import { isStorableTranslation } from '@/services/translate/text-classify'

export { normalizeTranslateKey, translateWithLookup }
export type { TranslateExtraGet }

function applyPair(lookup: Record<string, string>, src: unknown, zh: unknown) {
  if (src == null || zh == null) return
  const k = String(src)
  const v = String(zh)
  if (!isStorableTranslation(k, v)) return
  lookup[k] = v
  const nk = normalizeTranslateKey(k)
  if (nk && nk !== k) lookup[nk] = v
}

function removePair(lookup: Record<string, string>, src: unknown) {
  if (typeof src !== 'string') return
  delete lookup[src]
  const normalized = normalizeTranslateKey(src)
  if (normalized !== src) delete lookup[normalized]
}

function loadSeedObject(file: string, lookup: Record<string, string>) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v == null) continue
      applyPair(lookup, k, v)
    }
  } catch {
    /* ignore bad seed */
  }
}

function loadNdjsonFile(file: string, lookup: Record<string, string>) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue
      try {
        const row = JSON.parse(line) as unknown
        if (Array.isArray(row) && row.length >= 2) {
          if (row[1] === null) removePair(lookup, row[0])
          else applyPair(lookup, row[0], row[1])
        } else if (row && typeof row === 'object') {
          const rec = row as { s?: unknown; t?: unknown }
          if (rec.t === null) removePair(lookup, rec.s)
          else if (rec.s != null && rec.t != null) applyPair(lookup, rec.s, rec.t)
        }
      } catch {
        /* skip incomplete / bad line */
      }
    }
  } catch {
    /* ignore bad ndjson */
  }
}

/**
 * 从游戏内容根加载翻译表：seed ∪ cache.ndjson（后者覆盖前者）。
 * 找不到文件时返回空表。
 */
export function loadGameTranslateLookup(contentRoot: string): Record<string, string> {
  const lookup: Record<string, string> = Object.create(null)
  const seedPath = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  const cachePath = gameContentReadPath(contentRoot, 'cacheNdjson', { alsoParent: true })
  if (seedPath) loadSeedObject(seedPath, lookup)
  if (cachePath) loadNdjsonFile(cachePath, lookup)
  return lookup
}
