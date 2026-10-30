/** Server-side Japanese-to-Chinese live translation using enabled Google, Bing, Ollama or AI agent engines. Used for plugin cache misses and translation-page fill jobs. */

import { randomUUID } from 'node:crypto'

import { detectCacheLang, resolveCacheLangPair } from '@/lib/translate/cache-lang'
import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import { createNumericLabelIndex, numericLabelFamily } from '@/lib/translate/dynamic-template'
import { requestGoogle } from '@/lib/translate/engine-http'
import {
  engineAcceptsSensitive,
  engineSourceTag,
  findAgentEntry,
  mapTranslationBatch,
  resolveEngineCapacitySettings,
  type TranslateAgentEntry,
  type TranslateBuiltinId,
  type TranslateEngineSettings,
  type TranslateRunEngine,
  translationFallbackOrder,
} from '@/lib/translate/engines'
import { lookupTranslationRecord } from '@/lib/translate/lookup'
import type { TranslationObservation } from '@/lib/translate/observation'
import { replannedResultSources, resultSources, type ResultWrite, type TranslationProvenance } from '@/lib/translate/result-sources'
import { hasRmDigitCodes, toRmDigitTemplate } from '@/lib/translate/rm-escape'
import { renderSentencePlan, resolveSentenceGaps, type SentencePlan, type SentenceRecord } from '@/lib/translate/sentence-plan'
import { createSentenceResolver } from '@/lib/translate/sentence-plan'
import { getResolvedFromConfig } from '@/services/game/binding'
import { measureOperation } from '@/services/log/operation'
import { appendPublicGameCache, publicGameFiles } from '@/services/storage/game-files'

import { agentJaToZh } from './agent-translate'
import { lookupGameTranslation } from './cache-lookup'
import { DEFAULT_ENGINE_SWITCHES, getTranslateEngineSwitches, TRANSLATE_ENGINE_IDS } from './engine-switches'
import { getGameCacheContext } from './game-cache-context'
import { normalizeTranslateKey } from './game-lookup'
import { bergamotTranslate } from './lib/bergamot-translate'
import { appleTranslate } from './lib/macos-translate'
import { trackLiveTranslateRequest } from './live-activity'
import { loadGameNameEntries } from './name-glossary-game'
import { planLockedNames, stitchLockedNamePlan } from './name-lock'
import { spoolTranslationObservations } from './observations/spool'
import { type LocalTranslateOptions, ollamaJaToZh } from './ollama-translate'
import { loadResourceMatcher } from './resources/snapshot'
import { logTranslationEvent } from './runtime-log'
import { withEngineCapacity } from './scheduler/engine-capacity'
import { joinTranslationRequest } from './scheduler/in-flight'
import { isSensitiveForCloud } from './sensitive-text'
import { openSharedCache } from './shared-cache'
import { writeTranslationBatch } from './shared-cache/batch-writes'
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
  return measureOperation('translate', 'platform.request', { engine: 'google', sourceChars: Array.from(q).length, ...pair }, () =>
    requestGoogle(fetch, q, signal || AbortSignal.timeout(30_000), pair)
  )
}

export async function googleJaToZh(text: string): Promise<string> {
  return googleTranslateText(text, { from: 'ja', to: 'zh' })
}

export async function bingTranslateText(text: string, pair?: { from?: string; to?: string }): Promise<string> {
  return measureOperation('translate', 'platform.request', { engine: 'bing', sourceChars: Array.from(text).length, ...pair }, () => bingTranslateOnce(text, pair))
}

async function bingTranslateOnce(text: string, pair?: { from?: string; to?: string }): Promise<string> {
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
  if (engine === 'apple') return appleTranslate(text, { source: pair?.from, target: pair?.to, onTrace: options?.onTrace, ...(options?.signal ? { signal: options.signal } : {}) })
  if (engine === 'bergamot') return bergamotTranslate(text, { source: pair?.from, target: pair?.to })
  if (engine === 'ollama') return ollamaJaToZh(text, options)
  const entry = findAgentEntry(agents, engine)
  if (!entry) throw new Error('Agent translation entry removed')
  const capacity = resolveEngineCapacitySettings(engine, undefined, agents)
  return agentJaToZh(text, entry, {
    interactive: options?.interactive,
    signal: options?.signal,
    category: options?.category,
    speaker: options?.speaker,
    context: options?.context,
    concurrency: capacity.allowConcurrency === false ? 1 : (capacity.concurrencyLimit ?? 1),
    maxChars: capacity.maxConcurrentChars ?? 3000,
    lane: `agent:${entry.profileId}`,
    batchScope: options?.batchScope,
    onTrace: options?.onTrace,
  })
}

/** Append reusable pairs (incl. 原文===译文 labels) to the bound game's cache.ndjson. */
export function appendGameNdjson(contentRoot: string, pairs: Array<[string, string]>): number {
  const valid = pairs.filter(([src, zh]) => isReusableTranslation(src, zh))
  if (!valid.length) return 0
  appendPublicGameCache(contentRoot, valid)
  return valid.length
}

/** Local bound game content root, or null when unbound / remote. */
export function resolveBoundContentRoot(): string | null {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) return null
  if (resolved.remote) return null
  return resolved.contentRoot || null
}

export type LiveTranslateItem = TranslationProvenance & {
  src: string
  zh: string | null
  error?: string
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
    /** Short-name optimization may replace a whole name's own glossary entry. */
    optimizeWholeName?: boolean
    /** Dispatch without cache search; append the result as a new candidate. */
    cacheMode?: 'bypass'
    /** Internal, dependency-validated plan from the independent cache lane. */
    preparedPlan?: SentencePlan
    /** Borrow the job's writer; only the owning session flushes/closes it. */
    sharedCache?: () => ReturnType<typeof openSharedCache>
    persist?: boolean
    local?: LocalTranslateOptions
    sourceLang?: string
    targetLang?: string
    gameId?: string
    scene?: string
    category?: string
    speaker?: string
    context?: string
    itemTimeoutMs?: number
    onItem?: (item: LiveTranslateItem) => void
    onTrace?: (message: string) => void
    onCacheMatch?: (elapsedMs: number) => void
    onEngineDispatch?: (engine: TranslateRunEngine) => void
    /** Internal provenance for records a nested call may immediately read back. */
    onCacheWrite?: (records: SentenceRecord[], sources: string[]) => void
    onDuplicateInFlight?: () => void
    /** When false, skip idle-gate activity tracking (nested / optimize polish calls). Default true. */
    trackLiveActivity?: boolean
  }
): Promise<{
  items: LiveTranslateItem[]
  contentRoot: string | null
  engines: TranslateRunEngine[]
  collectionError?: string
}> {
  if (opts?.trackLiveActivity !== false) {
    return trackLiveTranslateRequest(() => liveTranslateTexts(texts, { ...opts, trackLiveActivity: false }))
  }
  const started = performance.now()
  const requestId = randomUUID()
  const trace = (message: string) => {
    const submitted = /^(Agent|Apple) request submitted: items=(\d+), sourceChars=(\d+)$/.exec(message)
    if (submitted) {
      logTranslationEvent('info', message, {
        requestId,
        contentRoot: opts?.contentRoot,
        engine: submitted[1] === 'Apple' ? 'apple' : 'agent',
        items: Number(submitted[2]),
        sourceChars: Number(submitted[3]),
      })
    } else if (!/engine (requested|returned|failed):/.test(message)) {
      logTranslationEvent('debug', message, { requestId, contentRoot: opts?.contentRoot })
    }
    opts?.onTrace?.(message)
  }
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
  let configs: Partial<Record<TranslateBuiltinId, TranslateEngineSettings>> | undefined
  try {
    const state = getTranslateEngineSwitches(contentRoot || undefined)
    agents = state.agents
    configs = state.configs
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
  const pairFor = (src: string) => resolveCacheLangPair({ from: opts?.sourceLang, to: opts?.targetLang, src })
  const chineseTarget = pairFor('').to === 'zh'
  let cacheStore: ReturnType<typeof openSharedCache> | undefined
  const getCache = () => (cacheStore ??= timed('Shared cache opened', () => (opts?.sharedCache ? opts.sharedCache() : openSharedCache())))
  const items: LiveTranslateItem[] = []
  const observations: TranslationObservation[] = []
  let collectionError: string | undefined
  const toWrite: Array<[string, string]> = []
  try {
    if (!bypassCache) {
      getCache()
      if (!opts?.sharedCache && contentRoot && opts?.persist !== false) timed('Pending backfill flushed', () => getCache().flushBackfill(contentRoot))
    }
    const gameContext = timed('Game indexes loaded', () => (contentRoot && !bypassCache && chineseTarget ? getGameCacheContext(contentRoot) : null))
    const resourceMatcher = !opts?.force && !bypassCache ? loadResourceMatcher(getCache().path) : null
    const resourceGameId = opts?.gameId ?? (contentRoot && resourceMatcher ? publicGameFiles(contentRoot).gameId : undefined)
    const localRecords = gameContext?.records || []
    const numericIndexes = new Map<string, ReturnType<typeof createNumericLabelIndex> | null>()
    let numericSignature = ''
    function numericIndex(src: string) {
      const signature = JSON.stringify([getCache().version(), contentRoot ? getGameCacheContext(contentRoot).stamp : ''])
      if (numericSignature !== signature) {
        numericIndexes.clear()
        numericSignature = signature
      }
      const from = pairFor(src).from
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
      if (gameContext?.blocked(src)) return null
      return lookupGameTranslation(lookupLocal, (key) => getCache().get(key, pairFor(src)), src, { resources: false })
    }

    const force = Boolean(opts?.force) || bypassCache
    const persist = opts?.persist !== false

    items.push(
      ...(await mapTranslationBatch(
        unique,
        async (src) => {
          const itemId = unique.indexOf(src) + 1
          const itemStarted = performance.now()
          const parentSignal = opts?.local?.signal
          const itemSignal = opts?.itemTimeoutMs ? AbortSignal.any([AbortSignal.timeout(opts.itemTimeoutMs), ...(parentSignal ? [parentSignal] : [])]) : parentSignal
          let engineWork = false
          let exactBackfillQueued = false
          const onEngineDispatch = (engine: TranslateRunEngine) => {
            engineWork = true
            opts?.onEngineDispatch?.(engine)
          }
          let item: LiveTranslateItem
          try {
            item = await (async () => {
              const items: LiveTranslateItem[] = []
              itemSignal?.throwIfAborted()
              const { core: labelCore } = peelChoiceMetaShell(src)
              if (!force) {
                const pair = pairFor(src)
                const plan = gameContext?.blocked(src)
                  ? createSentenceResolver([]).plan(src)
                  : opts?.preparedPlan && unique.length === 1
                    ? opts.preparedPlan
                    : timed(`Item ${itemId} cache plan`, () => matchCache(() => getCache().plan(src, pair, gameContext?.resolver.select(src) || [])))
                trace?.(`Item ${itemId} cache result: status=${plan.status}, gaps=${plan.gaps.length}`)
                if (plan.status === 'full') {
                  items.push({ src, zh: plan.zh, engine: plan.matches.every((m) => m.record.local) ? 'cache:local' : 'cache:remote', status: 'full', plan })
                  if (persist && contentRoot && chineseTarget) {
                    const records = plan.matches
                      .filter((m) => !m.record.local)
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
                  const sources = new Set<string>(['cache'])
                  const writes: ResultWrite[] = []
                  // Submit independent gaps together so native adapters can batch them.
                  for (let offset = 0; offset < plan.gaps.length; offset += MAX_BATCH) {
                    const gaps = plan.gaps.slice(offset, offset + MAX_BATCH)
                    const result = await liveTranslateTexts(
                      gaps.map((gap) => gap.text),
                      {
                        ...opts,
                        onEngineDispatch,
                        onCacheWrite: (records, sources) => {
                          writes.push(...records.map((record) => ({ record, sources })))
                          opts?.onCacheWrite?.(records, sources)
                        },
                        onItem: undefined,
                        preparedPlan: undefined,
                        onTrace: trace ? (message) => trace(`Item ${itemId} gaps: ${message}`) : undefined,
                        local: { ...opts?.local, onTrace: opts?.local?.onTrace || trace, signal: itemSignal },
                        force: true,
                        persist,
                        engines,
                        trackLiveActivity: false,
                      }
                    )
                    engineWork ||= result.items.some((entry) => entry.engineWork)
                    for (const gap of gaps) {
                      const item = result.items.find((entry) => entry.src === gap.text)
                      if (item?.zh && !item.error) {
                        translated.set(gap.id, item.zh)
                        if (item.engine !== 'skip') for (const source of resultSources(item)) sources.add(source)
                      }
                    }
                  }
                  const deps = plan.matches.filter((m) => !m.record.local).map((m) => m.record)
                  const currentContext = contentRoot && chineseTarget ? getGameCacheContext(contentRoot) : null
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
                      resultSources: replannedResultSources(current, writes),
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
                    resultSources: [...sources],
                    status: full ? 'full' : 'partial',
                    plan: resolved,
                    error: full ? undefined : 'Some text segments could not be translated',
                  })
                  return items[0]
                }
                const numeric =
                  !gameContext?.blocked(src) && (!opts?.targetLang || opts.targetLang === 'zh') && /[0-9]$/.test(src)
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
              if (!force && !gameContext?.blocked(src)) {
                const pair = pairFor(src)
                const resource = resourceMatcher?.match(src, {
                  sourceLanguage: pair.from,
                  targetLanguage: pair.to,
                  gameId: resourceGameId,
                  category: opts?.category,
                  speaker: opts?.speaker,
                  scene: opts?.scene,
                })
                if (resource) return { src, zh: resource.targetText, engine: 'resource', resource, status: 'full' as const }
              }
              const nameEntries = contentRoot ? await loadGameNameEntries(contentRoot, opts?.targetLang || 'zh') : []
              const namePlan = planLockedNames(src, nameEntries, { sourceLang: opts?.sourceLang, targetLang: opts?.targetLang || 'zh' })
              if (namePlan && (!namePlan.wholeName || !opts?.optimizeWholeName)) {
                const gapZh = new Map<string, string>()
                const sources = new Set<string>(['cache'])
                let remainderEngine = ''
                if (namePlan.translatable.length) {
                  const remainder = await liveTranslateTexts(
                    namePlan.translatable.map((gap) => gap.text),
                    {
                      ...opts,
                      onEngineDispatch,
                      onItem: undefined,
                      preparedPlan: undefined,
                      onTrace: trace ? (message) => trace(`Item ${itemId} name gaps: ${message}`) : undefined,
                      local: { ...opts?.local, onTrace: opts?.local?.onTrace || trace, signal: itemSignal },
                      force: false,
                      persist: false,
                      cacheMode: undefined,
                      trackLiveActivity: false,
                    }
                  )
                  engineWork ||= remainder.items.some((entry) => entry.engineWork)
                  for (const gap of namePlan.translatable) {
                    const hit = remainder.items.find((entry) => entry.src === gap.text)
                    if (!hit?.zh || hit.error) {
                      items.push({ src, zh: null, error: hit?.error || 'Name-locked remainder could not be translated' })
                      return items[0]
                    }
                    gapZh.set(gap.id, hit.zh)
                    if (hit.engine) remainderEngine = hit.engine
                    if (hit.engine !== 'skip') for (const source of resultSources(hit)) sources.add(source)
                  }
                }
                const zh = stitchLockedNamePlan(src, namePlan, gapZh)
                const tag = remainderEngine || 'live:optimize:names'
                if (persist && isStorableTranslation(src, zh, opts?.targetLang)) {
                  const written = timed(`Item ${itemId} name-lock write`, () => getCache().writeMany([[src, zh]], tag, { ...pairFor(src), category: opts?.category }))
                  opts?.onCacheWrite?.(written.records, [...sources])
                  if (contentRoot && chineseTarget) timed(`Item ${itemId} backfill queued`, () => getCache().queueBackfill(contentRoot, written.records))
                  exactBackfillQueued = written.records.some((record) => record.src === src)
                  if (written.rejected.length) {
                    return { src, zh: null, error: 'Translation result did not pass storage validation' }
                  }
                }
                items.push({ src, zh, engine: tag, resultSources: [...sources], status: 'full' })
                return items[0]
              }

              if (!shouldTranslate(labelCore || src, opts?.sourceLang)) {
                /* Return control-only or untranslated text unchanged without storing an identical cache entry. */
                items.push({ src, zh: src, engine: 'skip' })
                return items[0]
              }

              const guard = protectForTranslate(src)
              const sendText = guard.plain.trim() ? guard.plain : src
              const sensitive = isSensitiveForCloud(sendText)
              /** Keep sensitive text on configured agents or offline engines. */
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
                    const sourceChars = Array.from(sendText).length
                    engineWork = true
                    const rawZh = await joinTranslationRequest(
                      key,
                      (signal) => {
                        const execute = () => {
                          onEngineDispatch(engine)
                          trace?.(
                            `Item ${itemId} engine requested: engine=${engine}, sourceChars=${sourceChars}, from=${langPair.from}, to=${langPair.to}, pipelineElapsedMs=${Math.round(performance.now() - started)}`
                          )
                          logTranslationEvent('info', 'Translation engine requested', {
                            requestId,
                            itemId,
                            engine,
                            contentRoot,
                            sourceChars,
                            ...langPair,
                            pipelineElapsedMs: Math.round(performance.now() - started),
                          })
                          return translateWithEngine(
                            engine,
                            sendText,
                            { category: opts?.category, speaker: opts?.speaker, context: opts?.context, onTrace: trace, ...opts?.local, signal },
                            agents,
                            langPair
                          )
                        }
                        // Agent admission collects source items; scheduleOllama limits the packed HTTP requests.
                        return engine.startsWith('agent:')
                          ? execute()
                          : withEngineCapacity(engine, identity, execute, signal, { ...resolveEngineCapacitySettings(engine, configs, agents), chars: sourceChars })
                      },
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
                    if (guard.tokens.some((_, index) => !rawZh.includes(`__C${index}__`))) {
                      throw new Error('Translation control tokens missing')
                    }
                    if (!isUsefulTranslation(src, sendText, rawZh, zh, opts?.targetLang)) {
                      throw new Error('No valid translation returned')
                    }
                    logTranslationEvent('ok', 'Translation engine completed', {
                      requestId,
                      itemId,
                      engine,
                      contentRoot,
                      sourceChars,
                      ...langPair,
                      elapsedMs: Math.round(performance.now() - engineStarted),
                    })
                    winner = { engine, rawZh, zhCore, zh }
                    break
                  } catch (error) {
                    const interrupted = parentSignal?.aborted
                    logTranslationEvent(interrupted ? 'info' : 'warn', interrupted ? 'Translation engine interrupted' : 'Translation engine failed', {
                      requestId,
                      itemId,
                      engine,
                      contentRoot,
                      sourceChars: Array.from(sendText).length,
                      ...langPair,
                      elapsedMs: Math.round(performance.now() - engineStarted),
                      error: error instanceof Error ? error.message : String(error),
                    })
                    trace?.(
                      `Item ${itemId} engine failed: engine=${engine}, elapsedMs=${Math.round(performance.now() - engineStarted)}, error=${error instanceof Error ? error.message : String(error)}`
                    )
                    parentSignal?.throwIfAborted()
                    errors.push(new Error(`${engine}: [${langPair.from} -> ${langPair.to}] ${error instanceof Error ? error.message : String(error)}`))
                  }
                }
                if (!winner) throw new AggregateError(errors, 'All translation engines failed')
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
                  const writeOpts = { ...pairFor(src), category: opts?.category }
                  const backfillRoot = contentRoot && chineseTarget ? contentRoot : undefined
                  const writeStarted = performance.now()
                  const written = opts?.sharedCache
                    ? await writeTranslationBatch(getCache(), pairs, tag, writeOpts, backfillRoot)
                    : timed(`Item ${itemId} shared cache write`, () => getCache().writeMany(pairs, tag, writeOpts))
                  if (opts?.sharedCache) trace?.(`Item ${itemId} shared cache batch write: elapsedMs=${Math.round(performance.now() - writeStarted)}`)
                  opts?.onCacheWrite?.(written.records, [tag])
                  if (!opts?.sharedCache && backfillRoot) timed(`Item ${itemId} backfill queued`, () => getCache().queueBackfill(backfillRoot, written.records))
                  exactBackfillQueued = written.records.some((record) => record.src === src)
                  if (written.rejected.length) {
                    return { src, zh: null, error: 'Translation result did not pass storage validation' }
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
          item = { ...item, resultSources: resultSources(item), engineWork }
          if (persist && contentRoot && chineseTarget && !exactBackfillQueued && item.zh != null && !item.error && item.status !== 'partial') {
            getCache().queueGameProjections(contentRoot, [{ src, pair: pairFor(src) }])
          }
          if (persist && item.error) {
            const pair = pairFor(src)
            observations.push({
              eventId: randomUUID(),
              occurredAt: Date.now(),
              sourceText: src,
              targetText: item.zh,
              sourceLanguage: pair.from,
              targetLanguage: pair.to,
              engine: item.engine,
              gameId: resourceGameId,
              contentRoot: contentRoot || undefined,
              speaker: opts?.speaker,
              context: opts?.context,
              error: item.error,
              resource: item.resource,
            })
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
      spoolTranslationObservations(observations)
    } catch (error) {
      collectionError = `Translation evidence could not be saved: ${error instanceof Error ? error.message : String(error)}`
      trace?.(collectionError)
    }
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

  return { items, contentRoot, engines, ...(collectionError ? { collectionError } : {}) }
}
