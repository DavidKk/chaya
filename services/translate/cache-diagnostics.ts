import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { CACHE_TEST_MAX_CANDIDATES, CACHE_TEST_MAX_LENGTH, type CacheTestInput, type CacheTestResult } from '@/lib/translate/cache-diagnostics'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { traceTranslationCache } from '@/lib/translate/cache-match-trace'
import { normalizeTranslateQuery } from '@/lib/translate/cache-query'
import { createSentenceResolver, planSentenceTranslation, renderSentencePlan } from '@/lib/translate/sentence-plan'
import { sentenceQueryViewUnits } from '@/lib/translate/sentence-query'
import { SENTENCE_RULE_VERSION } from '@/lib/translate/sentence-units'
import { scanStructuredText, STRUCTURE_MAX_UNITS } from '@/lib/translate/structured-segments'
import { getResolvedFromConfig } from '@/services/game/binding'

import { loadGameTranslationRecords } from './game-records'
import { withReadOnlyCache } from './shared-cache/read-only'
import { isReusableTranslation } from './text-classify'

export class CacheTestInputError extends Error {
  constructor(
    message: string,
    readonly code = 'CACHE_TEST_INVALID'
  ) {
    super(message)
  }
}

function fingerprint(root: string) {
  const hash = createHash('sha256')
  for (const kind of ['seed', 'cacheNdjson'] as const) {
    const file = gameContentReadPath(root, kind, { alsoParent: true })
    hash.update(kind)
    if (!file) {
      hash.update('missing')
      continue
    }
    if (fs.statSync(file).size > 16 * 1024 * 1024) throw new CacheTestInputError('本作缓存过大，暂不支持诊断', 'CACHE_TEST_LIMIT')
    hash.update(fs.readFileSync(file))
  }
  return hash.digest('hex')
}

export function testTranslationCache(input: CacheTestInput, dbPath?: string): CacheTestResult {
  const normalizedText = normalizeTranslateQuery(input.text)
  if (!normalizedText || normalizedText.length > CACHE_TEST_MAX_LENGTH) throw new CacheTestInputError('请输入 1 至 20000 字的原文')
  const query: CacheTestInput = { ...input, text: normalizedText }
  let root: string | undefined
  if (query.scope !== 'shared') {
    if (query.to !== 'zh') throw new CacheTestInputError('本作缓存仅支持译入中文，请改用共享库', 'CACHE_TEST_GAME_LANGUAGE')
    const resolved = getResolvedFromConfig()
    const entry = resolved.config.library.find((item) => item.gameRoot === resolved.config.gameRoot)
    if (!resolved.ok || resolved.remote || !entry || !query.gameId || entry.id !== query.gameId)
      throw new CacheTestInputError('当前游戏未绑定或已变化，请重新选择', 'CACHE_TEST_GAME_CHANGED')
    root = resolved.contentRoot
  }
  const before = root ? fingerprint(root) : ''
  return withReadOnlyCache((cache) => {
    const structure = scanStructuredText(query.text, query.structure)
    const selected = query.scope === 'game' || !cache ? { records: [], limited: false } : cache.index.candidates(query.text, query, { structure: query.structure })
    const local = root
      ? loadGameTranslationRecords(root, (origin) => !!cache && origin.database === cache.path && cache.index.current([{ ...origin, src: '', zh: '' }])).filter(
          (r) => detectCacheLang(r.src) === query.from
        )
      : []
    const localCandidates = createSentenceResolver(local).select(query.text, { structure: query.structure })
    const records = [...localCandidates, ...selected.records].filter((r) => query.to !== 'zh' || isReusableTranslation(r.src, r.zh))
    const limited =
      localCandidates.limited ||
      selected.limited ||
      records.length > CACHE_TEST_MAX_CANDIDATES ||
      structure.diagnostics.some((d) => d.code === 'candidate_limit') ||
      structure.units.length > STRUCTURE_MAX_UNITS
    // Limits must never silently turn incomplete candidate inspection into a full hit.
    const plan = planSentenceTranslation(query.text, limited ? [] : records, { structure: query.structure, srcLang: query.from })
    plan.limited = limited || plan.limited
    if (root && fingerprint(root) !== before) throw new CacheTestInputError('本作缓存已变化，请重试', 'CACHE_TEST_STALE')
    return {
      query,
      ruleVersion: SENTENCE_RULE_VERSION,
      corpusVersion: `${cache?.index.version() || 'empty'}:${before}`,
      structure,
      segments: sentenceQueryViewUnits(query.text, { structure: query.structure, srcLang: query.from }),
      plan,
      preview: renderSentencePlan(plan),
      trace: traceTranslationCache(query.text, limited ? [] : records, plan, { structure: query.structure, srcLang: query.from }),
      candidateCount: records.length,
      diagnostics: [
        ...structure.diagnostics.map((d) => d.code),
        ...(plan.ambiguous ? ['ambiguous_translation'] : []),
        ...(plan.matches.some((match) => match.alignment === 'inferred') ? ['inferred_alignment'] : []),
        ...(plan.limited ? ['candidate_limit'] : []),
        ...(plan.status !== 'full' && !plan.matches.some((match) => match.record.structuralAlias) && records.some((r) => !r.alignments?.length) ? ['missing_alignment'] : []),
      ],
    }
  }, dbPath)
}
