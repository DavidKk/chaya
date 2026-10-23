/** Server-side Japanese-to-Chinese live translation using enabled Google, Bing, Ollama or AI agent engines. Used for plugin cache misses and translation-page fill jobs. */
import fs from 'node:fs'

import { ensureGameContentDir } from '@/lib/game/content-files'
import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'
import { detectCacheLang, resolveCacheLangPair } from '@/lib/translate/cache-lang'
import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import { createNumericLabelIndex, numericLabelFamily } from '@/lib/translate/dynamic-template'
import { requestGoogle } from '@/lib/translate/engine-http'
import {
  engineAcceptsSensitive,
  engineSourceTag,
  findAgentEntry,
  mapTranslationBatch,
  type TranslateAgentEntry,
  type TranslateRunEngine,
  translationFallbackOrder,
} from '@/lib/translate/engines'
import { lookupTranslationRecord } from '@/lib/translate/lookup'
import { hasRmDigitCodes, toRmDigitTemplate } from '@/lib/translate/rm-escape'
import { renderSentencePlan, resolveSentenceGaps, type SentencePlan } from '@/lib/translate/sentence-plan'
import { getResolvedFromConfig } from '@/services/game/binding'

import { agentJaToZh } from './agent-translate'
import { lookupGameTranslation } from './cache-lookup'
import { DEFAULT_ENGINE_SWITCHES, getTranslateEngineSwitches, TRANSLATE_ENGINE_IDS } from './engine-switches'
import { getGameCacheContext } from './game-cache-context'
import { normalizeTranslateKey } from './game-lookup'
import { bergamotTranslate } from './lib/bergamot-translate'
import { appleTranslate } from './lib/macos-translate'
import { type LocalTranslateOptions, ollamaJaToZh } from './ollama-translate'
import { withEngineCapacity } from './scheduler/engine-capacity'
import { joinTranslationRequest } from './scheduler/in-flight'
import { isSensitiveForCloud } from './sensitive-text'
import { openSharedCache } from './shared-cache'
import {
  isReusableTranslation,
  isStorableTranslation,
  isUsefulTranslation,
  peelControlShell,
  protectSentenceForTranslate as protectForTranslate,
  restoreForTranslate,
  shouldTranslate,
  translationCoreForCache,
} from './text-classify'

const MAX_BATCH = 40

export { type LocalTranslateOptions, ollamaJaToZh }

export async function googleTranslateText(text: string, pair?: { from?: string; to?: string }, signal?: AbortSignal): Promise<string> {
  const q = String(text ?? '')
  if (!q.trim()) return q
  return requestGoogle(fetch, q, signal || AbortSignal.timeout(30_000), pair)
}

export async function googleJaToZh(text: string): Promise<string> {
  return googleTranslateText(text, { from: 'ja', to: 'zh' })
}

export async function bingTranslateText(text: string, pair?: { from?: string; to?: string }): Promise<string> {
  // Build the optional dependency name dynamically to avoid static bundler resolution; report a clear error if it is missing.
  const pkg = ['bing', 'translate', 'api'].join('-')
  let translate: ((...args: unknown[]) => Promise<{ translation?: string }>) | undefined
  try {
    const dependency = await import(/* webpackIgnore: true */ pkg)
    translate = dependency.translate || dependency.default?.translate
  } catch {
    throw new Error('bing-translate-api is not installed (optional dependency); please disable Bing or install the package')
  }
  if (!translate) throw new Error('Bing translation module does not export translate function')
  const normalizeBingLang = (code?: string, fallback = 'auto-detect') => {
    if (!code) return fallback
    const lower = code.toLowerCase()
    if (lower === 'zh' || lower === 'ch' || lower === 'zh-cn' || lower === 'zh-hans') return 'zh-Hans'
    if (lower === 'cht' || lower === 'zh-tw' || lower === 'zh-hant') return 'zh-Hant'
    if (lower === 'pt-br') return 'pt'
    return code
  }
  const toLang = normalizeBingLang(pair?.to, 'zh-Hans')
  const fromLang = normalizeBingLang(pair?.from, 'auto-detect')
  const res = await translate(text, fromLang, toLang, false, false)
  if (!res?.translation) throw new Error('empty translation')
  return res.translation
}

async function translateWithEngine(
  engine: TranslateRunEngine,
  text: string,
  options: LocalTranslateOptions | undefined,
  agents: TranslateAgentEntry[],
  pair?: { from?: string; to?: string }
): Promise<string> {
  if (engine === 'google') return googleTranslateText(text, pair, options?.signal)
  if (engine === 'bing') return bingTranslateText(text, pair)
  if (engine === 'apple') return appleTranslate(text, { source: pair?.from, target: pair?.to, ...(options?.signal ? { signal: options.signal } : {}) })
  if (engine === 'bergamot') return bergamotTranslate(text, { source: pair?.from, target: pair?.to })
  if (engine === 'ollama') return ollamaJaToZh(text, options)
  const entry = findAgentEntry(agents, engine)
  if (!entry) throw new Error('Agent translation entry removed')
  return agentJaToZh(text, entry, {
    interactive: options?.interactive,
    signal: options?.signal,
    category: options?.category,
    speaker: options?.speaker,
    context: options?.context,
  })
}

/** Append reusable pairs (incl. 原文===译文 labels) to the bound game's cache.ndjson. */
export function appendGameNdjson(contentRoot: string, pairs: Array<[string, string]>): number {
  const valid = pairs.filter(([src, zh]) => isReusableTranslation(src, zh))
  if (!valid.length) return 0
  const file = ensureGameContentDir(contentRoot, 'cacheNdjson')
  const release = lockCacheFile(fs, file)
  try {
    appendCacheLines(fs, file, valid)
  } finally {
    release()
  }
  return valid.length
}

/** Local bound game content root, or null when unbound / remote. */
export function resolveBoundContentRoot(): string | null {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) return null
  if (resolved.remote) return null
  return resolved.contentRoot || null
}

export type LiveTranslateItem = {
  src: string
  zh: string | null
  error?: string
  engine?: string
  status?: 'full' | 'partial' | 'miss'
  plan?: SentencePlan
}

/** Translate a batch using this game's library first, then the shared cache, then enabled engines and persistence. force skips lookup for retranslation; persist:false returns previews without writing either cache. */
export async function liveTranslateTexts(
  texts: string[],
  opts?: {
    contentRoot?: string | null
    engine?: string
    engines?: TranslateRunEngine[]
    force?: boolean
    /** Dispatch without full cache search; validate current authority before accepting the result. */
    cacheMode?: 'bypass'
    /** Internal, dependency-validated plan from the independent cache lane. */
    preparedPlan?: SentencePlan
    /** Borrow the job's writer; only the owning session flushes/closes it. */
    sharedCache?: () => ReturnType<typeof openSharedCache>
    persist?: boolean
    local?: LocalTranslateOptions
    sourceLang?: string
    targetLang?: string
    category?: string
    speaker?: string
    context?: string
    itemTimeoutMs?: number
    onItem?: (item: LiveTranslateItem) => void
    onTrace?: (message: string) => void
    onCacheMatch?: (elapsedMs: number) => void
    onEngineDispatch?: () => void
    onDuplicateInFlight?: () => void
  }
): Promise<{
  items: LiveTranslateItem[]
  contentRoot: string | null
  engines: TranslateRunEngine[]
}> {
  const started = performance.now()
  const trace = opts?.onTrace
  const timed = <T>(action: string, work: () => T): T => {
    const begin = performance.now()
    try {
      return work()
    } finally {
      trace?.(`${action}: elapsedMs=${Math.round(performance.now() - begin)}`)
    }
  }
  const matchCache = <T>(work: () => T): T => {
    const begin = performance.now()
    try {
      return work()
    } finally {
      opts?.onCacheMatch?.(performance.now() - begin)
    }
  }
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of texts) {
    const src = String(raw ?? '')
    if (!src || seen.has(src)) continue
    seen.add(src)
    unique.push(src)
    if (unique.length >= MAX_BATCH) break
  }

  const contentRoot = opts?.contentRoot === undefined ? resolveBoundContentRoot() : opts.contentRoot
  const explicitEngines = opts?.engines !== undefined
  let engines: TranslateRunEngine[] = opts?.engines ? opts.engines.filter(Boolean) : []
  let agents: TranslateAgentEntry[] = []
  try {
    const state = getTranslateEngineSwitches(contentRoot || undefined)
    agents = state.agents
    if (!explicitEngines) engines = state.enabled
  } catch {
    if (!explicitEngines) {
      /* Use default switches and order when no game is bound. */
      engines = TRANSLATE_ENGINE_IDS.filter((id) => DEFAULT_ENGINE_SWITCHES[id])
    }
  }

  trace?.(
    `Pipeline configured: items=${unique.length}, sourceChars=${unique.reduce((sum, src) => sum + Array.from(src).length, 0)}, engines=${engines.join(',')}, elapsedMs=${Math.round(performance.now() - started)}`
  )
  const bypassCache = opts?.cacheMode === 'bypass'
  let cacheStore: ReturnType<typeof openSharedCache> | undefined
  const getCache = () => (cacheStore ??= timed('Shared cache opened', () => (opts?.sharedCache ? opts.sharedCache() : openSharedCache())))
  if (!bypassCache) {
    getCache()
    if (!opts?.sharedCache && contentRoot && opts?.persist !== false) timed('Pending backfill flushed', () => getCache().flushBackfill(contentRoot))
  }
  const gameContext = timed('Game indexes loaded', () => (contentRoot && !bypassCache ? getGameCacheContext(contentRoot) : null))
  const localRecords = gameContext?.records || []
  const numericIndexes = new Map<string, ReturnType<typeof createNumericLabelIndex> | null>()
  let numericSignature = ''
  function numericIndex(src: string) {
    const signature = JSON.stringify([getCache().version(), contentRoot ? getGameCacheContext(contentRoot).stamp : ''])
    if (numericSignature !== signature) {
      numericIndexes.clear()
      numericSignature = signature
    }
    const from = detectCacheLang(src)
    const family = numericLabelFamily(src)
    if (!family) return null
    const key = JSON.stringify([from, family])
    if (!numericIndexes.has(key)) {
      const shared = getCache().numericRecords({ from, to: 'zh' }, src)
      const currentLocal = contentRoot ? getGameCacheContext(contentRoot).numericRecords(src) : []
      numericIndexes.set(key, shared.limited ? null : createNumericLabelIndex([...shared, ...currentLocal]))
    }
    return numericIndexes.get(key) || null
  }
  const items: LiveTranslateItem[] = []
  const toWrite: Array<[string, string]> = []
  /** Prefer this game's translations; the shared cache only fills missing entries. */
  const localLookup = gameContext?.lookup || null
  trace?.(`Pipeline ready: localRecords=${localRecords.length}, elapsedMs=${Math.round(performance.now() - started)}`)

  function lookupLocal(src: string): string | null {
    if (!localLookup) return null
    if (Object.prototype.hasOwnProperty.call(localLookup, src)) return localLookup[src] ?? null
    const norm = normalizeTranslateKey(src)
    if (norm !== src && Object.prototype.hasOwnProperty.call(localLookup, norm)) return localLookup[norm] ?? null
    return lookupTranslationRecord(localLookup, src)
  }

  /** Strip choice conditions during lookup to avoid legacy translations of executable keywords; preserve the full source when writing back. */
  function lookupCached(src: string): { zh: string; engine: 'cache:remote' | 'cache:local' } | null {
    return lookupGameTranslation(lookupLocal, (key) => getCache().get(key), src)
  }

  const force = Boolean(opts?.force) || bypassCache
  const persist = opts?.persist !== false

  try {
    items.push(
      ...(await mapTranslationBatch(
        unique,
        async (src) => {
          const itemId = unique.indexOf(src) + 1
          const itemStarted = performance.now()
          const parentSignal = opts?.local?.signal
          const itemSignal = opts?.itemTimeoutMs ? AbortSignal.any([AbortSignal.timeout(opts.itemTimeoutMs), ...(parentSignal ? [parentSignal] : [])]) : parentSignal
          let item: LiveTranslateItem
          try {
            item = await (async () => {
              const items: LiveTranslateItem[] = []
              itemSignal?.throwIfAborted()
              const { core: labelCore } = peelChoiceMetaShell(src)
              if (!force) {
                const pair = { from: detectCacheLang(src), to: 'zh' as const }
                const plan =
                  opts?.preparedPlan && unique.length === 1
                    ? opts.preparedPlan
                    : timed(`Item ${itemId} cache plan`, () => matchCache(() => getCache().plan(src, pair, gameContext?.resolver.select(src) || [])))
                trace?.(`Item ${itemId} cache result: status=${plan.status}, gaps=${plan.gaps.length}`)
                if (plan.status === 'full') {
                  items.push({ src, zh: plan.zh, engine: plan.matches.every((m) => m.record.local) ? 'cache:local' : 'cache:remote', status: 'full', plan })
                  if (persist && contentRoot) {
                    const records = plan.matches
                      .filter((m) => !m.record.local && m.kind === 'whole')
                      .map((m) => getCache().record(m.record.src, pair))
                      .filter((r) => r != null)
                    getCache().queueBackfill(contentRoot, records)
                  }
                  return items[0]
                }
                if (plan.limited) {
                  return { src, zh: null, status: 'miss' as const, plan, error: 'Cache candidate limit exceeded; translation deferred to preserve existing authority' }
                }
                if (plan.status === 'partial') {
                  const translated = new Map<string, string>()
                  // Submit independent gaps together so native adapters can batch them.
                  for (let offset = 0; offset < plan.gaps.length; offset += MAX_BATCH) {
                    const gaps = plan.gaps.slice(offset, offset + MAX_BATCH)
                    const result = await liveTranslateTexts(
                      gaps.map((gap) => gap.text),
                      {
                        ...opts,
                        onItem: undefined,
                        preparedPlan: undefined,
                        onTrace: trace ? (message) => trace(`Item ${itemId} gaps: ${message}`) : undefined,
                        local: { ...opts?.local, signal: itemSignal },
                        force: true,
                        persist,
                        engines,
                      }
                    )
                    for (const gap of gaps) {
                      const item = result.items.find((entry) => entry.src === gap.text)
                      if (item?.zh && !item.error) {
                        translated.set(gap.id, item.zh)
                      }
                    }
                  }
                  const deps = plan.matches.filter((m) => !m.record.local).map((m) => m.record)
                  const currentContext = contentRoot ? getGameCacheContext(contentRoot) : null
                  const currentLocal = currentContext?.records || []
                  const localCandidates = currentContext?.resolver.select(src) || []
                  const localChanged = plan.matches.some(
                    (m) => m.record.local && !currentLocal.some((r) => r.src === m.record.src && r.zh === m.record.zh && r.engine === m.record.engine)
                  )
                  const replanned = matchCache(() => getCache().plan(src, pair, localCandidates))
                  const matchSignature = (value: SentencePlan) => JSON.stringify(value.matches.map((m) => [m.start, m.end, m.record.id, m.record.revision, m.record.zh]))
                  if (!getCache().current(deps) || localChanged || matchSignature(replanned) !== matchSignature(plan)) {
                    // Replan once after an awaited engine call; force would bypass the new human decision.
                    const current = matchCache(() => getCache().plan(src, pair, localCandidates))
                    items.push({
                      src,
                      zh: current.zh,
                      engine: 'cache:changed',
                      status: current.status,
                      plan: current,
                      error: current.status === 'full' ? undefined : 'Translation library changed; retry missing segments',
                    })
                    return items[0]
                  }
                  const resolved = resolveSentenceGaps(plan, translated)
                  const full = resolved.status === 'full'
                  items.push({
                    src,
                    zh: resolved.zh ?? renderSentencePlan(resolved),
                    engine: 'cache:partial',
                    status: full ? 'full' : 'partial',
                    plan: resolved,
                    error: full ? undefined : 'Some text segments could not be translated',
                  })
                  return items[0]
                }
                const numeric =
                  (!opts?.targetLang || opts.targetLang === 'zh') && /[0-9]$/.test(src)
                    ? timed(`Item ${itemId} numeric lookup`, () => matchCache(() => numericIndex(src)?.resolve(src)))
                    : null
                if (numeric) return { src, zh: numeric, engine: 'cache:numeric', status: 'full' as const }
                // Keep specialized RM display/ruby restoration without word-coverage fallback.
                const cached = /\\(?:C\[|FS\[|RB\[|ruby\[)/i.test(src) ? lookupCached(src) : null
                if (cached != null) {
                  items.push({ src, zh: cached.zh, engine: cached.engine })
                  /* Populate the local library with validated cache hits, including explicit unchanged translations. */
                  if (persist && cached.engine === 'cache:local') {
                    if (lookupLocal(src) == null && isReusableTranslation(src, cached.zh)) toWrite.push([src, cached.zh])
                    if (labelCore && labelCore !== src) {
                      const labelZh = peelChoiceMetaShell(cached.zh).core || cached.zh
                      if (lookupLocal(labelCore) == null && isReusableTranslation(labelCore, labelZh)) {
                        toWrite.push([labelCore, labelZh])
                      }
                    }
                  }
                  return items[0]
                }
              }
              if (!shouldTranslate(labelCore || src, opts?.sourceLang)) {
                /* Return control-only or untranslated text unchanged without storing an identical cache entry. */
                items.push({ src, zh: src, engine: 'skip' })
                return items[0]
              }

              const guard = protectForTranslate(src)
              const sendText = guard.plain.trim() ? guard.plain : src
              const sensitive = isSensitiveForCloud(sendText)
              /** Send sensitive text only to agent engines; skip this item if none are enabled, without blocking the rest of the batch. */
              const tryEngines = sensitive ? engines.filter(engineAcceptsSensitive) : engines
              if (sensitive && !tryEngines.length) {
                items.push({ src, zh: null, engine: 'skip:sensitive', error: 'This text requires an enabled eligible translation engine' })
                return items[0]
              }
              if (!tryEngines.length) {
                items.push({ src, zh: null, error: engines.length ? 'No eligible translation engines' : 'No translation engines are enabled' })
                return items[0]
              }

              const langPair = { from: opts?.sourceLang || detectCacheLang(sendText), to: opts?.targetLang || 'zh' }
              try {
                const errors: Error[] = []
                let winner: { engine: TranslateRunEngine; rawZh: string; zhCore: string; zh: string } | undefined
                for (const engine of translationFallbackOrder(tryEngines)) {
                  itemSignal?.throwIfAborted()
                  const engineStarted = performance.now()
                  try {
                    const identity = `${engineSourceTag(engine, agents)}:${findAgentEntry(agents, engine)?.model || ''}`
                    const key = JSON.stringify([contentRoot, identity, langPair, sendText, Boolean(opts?.local?.interactive)])
                    const rawZh = await joinTranslationRequest(
                      key,
                      (signal) =>
                        withEngineCapacity(
                          engine,
                          identity,
                          () => {
                            opts?.onEngineDispatch?.()
                            trace?.(
                              `Item ${itemId} engine requested: engine=${engine}, sourceChars=${Array.from(sendText).length}, from=${langPair.from}, to=${langPair.to}, pipelineElapsedMs=${Math.round(performance.now() - started)}`
                            )
                            return translateWithEngine(
                              engine,
                              sendText,
                              { category: opts?.category, speaker: opts?.speaker, context: opts?.context, ...opts?.local, signal },
                              agents,
                              langPair
                            )
                          },
                          signal
                        ),
                      itemSignal,
                      () => {
                        opts?.onDuplicateInFlight?.()
                        trace?.(`Item ${itemId} engine request joined: engine=${engine}`)
                      }
                    )
                    trace?.(`Item ${itemId} engine returned: engine=${engine}, elapsedMs=${Math.round(performance.now() - engineStarted)}`)
                    itemSignal?.throwIfAborted()
                    const zhCore = translationCoreForCache(rawZh, guard)
                    const zh = restoreForTranslate(rawZh, guard)
                    if (!isUsefulTranslation(src, sendText, rawZh, zh, opts?.targetLang) || guard.tokens.some((_, index) => !rawZh.includes(`__C${index}__`))) {
                      throw new Error('No valid translation returned or control tokens missing')
                    }
                    winner = { engine, rawZh, zhCore, zh }
                    break
                  } catch (error) {
                    trace?.(`Item ${itemId} engine failed: engine=${engine}, elapsedMs=${Math.round(performance.now() - engineStarted)}`)
                    parentSignal?.throwIfAborted()
                    errors.push(new Error(`${engine}: ${error instanceof Error ? error.message : String(error)}`))
                  }
                }
                if (!winner) throw new AggregateError(errors, 'All translation engines failed')
                // Whole/alias authority only: never rerun sentence coverage on the dispatch lane.
                const currentAuthority = () => {
                  const local = contentRoot ? getGameCacheContext(contentRoot).lookup : null
                  const pair = resolveCacheLangPair({ ...langPair, src })
                  const used = new Map<string, NonNullable<ReturnType<ReturnType<typeof openSharedCache>['authority']>>>()
                  const hit = lookupGameTranslation(
                    (key) => local?.[key],
                    (key) => {
                      const value = getCache().get(key, pair)
                      const record = value != null ? getCache().authority(key, pair) : null
                      if (record) used.set(record.id!, record)
                      return value
                    },
                    src
                  )
                  if (hit && bypassCache && contentRoot && persist && used.size) getCache().queueBackfill(contentRoot, [...used.values()])
                  return hit
                }
                if (bypassCache) {
                  const current = timed(`Item ${itemId} authority checked`, currentAuthority)
                  if (current) return { src, zh: current.zh, engine: current.engine, status: 'full' as const }
                }
                const source = engineSourceTag(winner.engine, agents)
                const tag = sensitive ? `live:${source}:nsfw` : `live:${source}`
                const pairs: Array<[string, string]> = []
                const pushPair = (key: string, value: string) => {
                  if (!isStorableTranslation(key, value)) return
                  pairs.push([key, value])
                  if (hasRmDigitCodes(key)) {
                    const tplKey = toRmDigitTemplate(key)
                    const tplZh = toRmDigitTemplate(value)
                    if (tplKey !== key && isStorableTranslation(tplKey, tplZh)) {
                      pairs.push([tplKey, tplZh])
                    }
                  }
                }
                pushPair(guard.core || sendText, winner.zhCore)
                if (labelCore && labelCore !== src && guard.plain.trim()) {
                  const labelKey = peelControlShell(labelCore).core || labelCore
                  pushPair(labelKey, winner.zhCore)
                }
                if (pairs.length && persist) {
                  const written = timed(`Item ${itemId} shared cache write`, () => getCache().writeMany(pairs, tag, { from: detectCacheLang(src), to: 'zh' }))
                  if (contentRoot) timed(`Item ${itemId} backfill queued`, () => getCache().queueBackfill(contentRoot, written.records))
                  if (written.rejected.length) {
                    const current = currentAuthority()
                    if (current) return { src, zh: current.zh, engine: current.engine, status: 'full' as const }
                    return { src, zh: null, error: 'Translation result rejected by current authority; review conflicting cache entries' }
                  }
                }
                items.push({ src, zh: winner.zh, engine: tag })
              } catch (aggregateError) {
                itemSignal?.throwIfAborted()
                const errs = aggregateError instanceof AggregateError ? aggregateError.errors.map((e) => (e instanceof Error ? e.message : String(e))) : [String(aggregateError)]
                items.push({ src, zh: null, error: errs.join('; ') || (engines.length ? 'Translation failed' : 'No translation engines are enabled') })
              }
              return items[0]
            })()
          } catch (error) {
            parentSignal?.throwIfAborted()
            if (!itemSignal?.aborted) throw error
            item = { src, zh: null, error: 'Translation item deadline exceeded; saved results are retained' }
          }
          timed(`Item ${itemId} progress checkpoint`, () => opts?.onItem?.(item))
          trace?.(`Item ${itemId} finished: engine=${item.engine || 'none'}, success=${item.zh != null && !item.error}, elapsedMs=${Math.round(performance.now() - itemStarted)}`)
          return item
        },
        engines.length === 1 && engines[0] === 'apple' ? MAX_BATCH : 4
      ))
    )
  } finally {
    try {
      if (!opts?.sharedCache && cacheStore && contentRoot && opts?.persist !== false) timed('Final backfill flushed', () => cacheStore!.flushBackfill(contentRoot))
    } finally {
      if (!opts?.sharedCache && cacheStore) timed('Shared cache closed', () => cacheStore!.close())
    }
    // Preserve successful translations when a later item times out or is cancelled.
    if (contentRoot && toWrite.length) {
      try {
        timed('Game cache appended', () => appendGameNdjson(contentRoot, toWrite))
      } catch {
        /* 共享库已写入；本作文件失败不阻断 */
      }
    }
    trace?.(`Pipeline finished: elapsedMs=${Math.round(performance.now() - started)}`)
  }

  return { items, contentRoot, engines }
}
