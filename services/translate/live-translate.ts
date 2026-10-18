/** Server-side Japanese-to-Chinese live translation using enabled Google, Bing, Ollama or AI agent engines. Used for plugin cache misses and translation-page fill jobs. */
import fs from 'node:fs'

import { ensureGameContentDir } from '@/lib/game/content-files'
import { appendCacheLines, lockCacheFile } from '@/lib/translate/cache-file-lock'
import { detectCacheLang } from '@/lib/translate/cache-lang'
import { peelChoiceMetaShell } from '@/lib/translate/choice-meta'
import { requestGoogle } from '@/lib/translate/engine-http'
import { engineAcceptsSensitive, engineSourceTag, findAgentEntry, type TranslateAgentEntry, type TranslateRunEngine } from '@/lib/translate/engines'
import { lookupTranslationRecord } from '@/lib/translate/lookup'
import { hasRmDigitCodes, toRmDigitTemplate } from '@/lib/translate/rm-escape'
import { renderSentencePlan, resolveSentenceGaps, type SentencePlan } from '@/lib/translate/sentence-plan'
import { getResolvedFromConfig } from '@/services/game/binding'

import { agentJaToZh } from './agent-translate'
import { lookupGameTranslation } from './cache-lookup'
import { DEFAULT_ENGINE_SWITCHES, getTranslateEngineSwitches, TRANSLATE_ENGINE_IDS } from './engine-switches'
import { loadGameTranslateLookup, normalizeTranslateKey } from './game-lookup'
import { loadGameTranslationRecords } from './game-records'
import { appleTranslate } from './lib/macos-translate'
import { type LocalTranslateOptions, ollamaJaToZh } from './ollama-translate'
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

export async function googleJaToZh(text: string): Promise<string> {
  const q = String(text ?? '')
  if (!q.trim()) return q
  return requestGoogle(fetch, q, AbortSignal.timeout(30_000))
}

async function bingJaToZh(text: string): Promise<string> {
  // Build the optional dependency name dynamically to avoid static bundler resolution; report a clear error if it is missing.
  const pkg = ['bing', 'translate', 'api'].join('-')
  let translate: ((...args: unknown[]) => Promise<{ translation?: string }>) | undefined
  try {
    const dependency = await import(/* webpackIgnore: true */ pkg)
    translate = dependency.translate || dependency.default?.translate
  } catch {
    throw new Error('未安装 bing-translate-api（可选依赖），请关闭 Bing 或安装该包')
  }
  if (!translate) throw new Error('Bing 翻译模块未提供 translate')
  const res = await translate(text, 'auto-detect', 'zh-Hans', false, false)
  if (!res?.translation) throw new Error('empty translation')
  return res.translation
}

async function translateWithEngine(engine: TranslateRunEngine, text: string, options: LocalTranslateOptions | undefined, agents: TranslateAgentEntry[]): Promise<string> {
  if (engine === 'google') return googleJaToZh(text)
  if (engine === 'bing') return bingJaToZh(text)
  if (engine === 'apple') return appleTranslate(text, { source: 'ja', target: 'zh-Hans' })
  if (engine === 'ollama') return ollamaJaToZh(text, options)
  const entry = findAgentEntry(agents, engine)
  if (!entry) throw new Error('Agent 翻译条目已移除')
  return agentJaToZh(text, entry, { interactive: options?.interactive, signal: options?.signal })
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
  opts?: { contentRoot?: string | null; engine?: string; engines?: TranslateRunEngine[]; force?: boolean; persist?: boolean; local?: LocalTranslateOptions }
): Promise<{
  items: LiveTranslateItem[]
  contentRoot: string | null
  engines: TranslateRunEngine[]
}> {
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
  const fromOpts = opts?.engines?.filter(Boolean)
  let engines: TranslateRunEngine[] = fromOpts?.length ? fromOpts : []
  let agents: TranslateAgentEntry[] = []
  try {
    const state = getTranslateEngineSwitches(contentRoot || undefined)
    agents = state.agents
    if (!engines.length) engines = state.enabled
  } catch {
    if (!engines.length) {
      /* Use default switches and order when no game is bound. */
      engines = TRANSLATE_ENGINE_IDS.filter((id) => DEFAULT_ENGINE_SWITCHES[id])
    }
  }

  const cache = openSharedCache()
  if (contentRoot && opts?.persist !== false) cache.flushBackfill(contentRoot)
  const localRecords = contentRoot ? loadGameTranslationRecords(contentRoot, (origin) => origin.database === cache.path && cache.current([{ ...origin, src: '', zh: '' }])) : []
  const items: LiveTranslateItem[] = []
  const toWrite: Array<[string, string]> = []
  /** Prefer this game's translations; the shared cache only fills missing entries. */
  const localLookup = contentRoot ? loadGameTranslateLookup(contentRoot) : null

  function lookupLocal(src: string): string | null {
    if (!localLookup) return null
    if (Object.prototype.hasOwnProperty.call(localLookup, src)) return localLookup[src] ?? null
    const norm = normalizeTranslateKey(src)
    if (norm !== src && Object.prototype.hasOwnProperty.call(localLookup, norm)) return localLookup[norm] ?? null
    return lookupTranslationRecord(localLookup, src)
  }

  /** Strip choice conditions during lookup to avoid legacy translations of executable keywords; preserve the full source when writing back. */
  function lookupCached(src: string): { zh: string; engine: 'cache:remote' | 'cache:local' } | null {
    return lookupGameTranslation(lookupLocal, (key) => cache.get(key), src)
  }

  const force = Boolean(opts?.force)
  const persist = opts?.persist !== false

  try {
    for (const src of unique) {
      opts?.local?.signal?.throwIfAborted()
      const { core: labelCore } = peelChoiceMetaShell(src)
      if (!force) {
        const pair = { from: detectCacheLang(src), to: 'zh' as const }
        const plan = cache.plan(src, pair, localRecords)
        if (plan.status === 'full') {
          items.push({ src, zh: plan.zh, engine: plan.matches.every((m) => m.record.local) ? 'cache:local' : 'cache:remote', status: 'full', plan })
          if (persist && contentRoot) {
            const records = plan.matches
              .filter((m) => !m.record.local && m.kind === 'whole')
              .map((m) => cache.record(m.record.src, pair))
              .filter((r) => r != null)
            cache.queueBackfill(contentRoot, records)
          }
          continue
        }
        if (plan.status === 'partial') {
          const translated = new Map<string, string>()
          const completed: Array<{ src: string; zh: string; engine: string }> = []
          for (const gap of plan.gaps) {
            const result = await liveTranslateTexts([gap.text], { ...opts, force: true, persist: false, engines })
            const item = result.items[0]
            if (item?.zh && !item.error) {
              translated.set(gap.id, item.zh)
              if (item.engine?.startsWith('live:')) completed.push({ src: gap.text, zh: item.zh, engine: item.engine })
            }
          }
          const deps = plan.matches.filter((m) => !m.record.local).map((m) => m.record)
          const currentLocal = contentRoot
            ? loadGameTranslationRecords(contentRoot, (origin) => origin.database === cache.path && cache.current([{ ...origin, src: '', zh: '' }]))
            : []
          const localChanged = plan.matches.some((m) => m.record.local && !currentLocal.some((r) => r.src === m.record.src && r.zh === m.record.zh && r.engine === m.record.engine))
          if (!cache.current(deps) || cache.version() !== plan.corpusVersion || localChanged || JSON.stringify(currentLocal) !== JSON.stringify(localRecords)) {
            // Replan once after an awaited engine call; force would bypass the new human decision.
            const current = cache.plan(src, pair, currentLocal)
            items.push({
              src,
              zh: current.zh,
              engine: 'cache:changed',
              status: current.status,
              plan: current,
              error: current.status === 'full' ? undefined : '翻译库已更新，请重试缺口',
            })
            continue
          }
          if (persist)
            for (const item of completed) {
              const written = cache.writeMany([[item.src, item.zh]], item.engine, pair)
              if (contentRoot) cache.queueBackfill(contentRoot, written.records)
            }
          const resolved = resolveSentenceGaps(plan, translated)
          const full = resolved.status === 'full'
          items.push({
            src,
            zh: resolved.zh ?? renderSentencePlan(resolved),
            engine: 'cache:partial',
            status: full ? 'full' : 'partial',
            plan: resolved,
            error: full ? undefined : '部分短句未完成翻译',
          })
          continue
        }
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
          continue
        }
      }
      if (!shouldTranslate(labelCore || src)) {
        /* Return control-only or untranslated text unchanged without storing an identical cache entry. */
        items.push({ src, zh: src, engine: 'skip' })
        continue
      }

      const guard = protectForTranslate(src)
      const sendText = guard.plain.trim() ? guard.plain : src
      const sensitive = isSensitiveForCloud(sendText)
      /** Send sensitive text only to agent engines; skip this item if none are enabled, without blocking the rest of the batch. */
      const tryEngines = sensitive ? engines.filter(engineAcceptsSensitive) : engines
      if (sensitive && !tryEngines.length) {
        items.push({ src, zh: null, engine: 'skip:sensitive', error: '此文本需要开启 Agent 翻译' })
        continue
      }

      /* Translate remotely, then persist body-only translations to shared and local caches; restore shells for in-game output. */
      const errors: string[] = []
      let done = false
      for (const engine of tryEngines) {
        try {
          const rawZh = await translateWithEngine(engine, sendText, opts?.local, agents)
          const zhCore = translationCoreForCache(rawZh, guard)
          const zh = restoreForTranslate(rawZh, guard)
          if (!isUsefulTranslation(src, sendText, rawZh, zh)) {
            errors.push(`${engine}: 未得到译文`)
            continue
          }
          const source = engineSourceTag(engine, agents)
          const tag = sensitive ? `live:${source}:nsfw` : `live:${source}`
          const pairs: Array<[string, string]> = []
          const pushPair = (key: string, value: string) => {
            if (!isStorableTranslation(key, value)) return
            pairs.push([key, value])
            /* Different numbered actor controls share a template key; restore the original numeric codes during lookup. */
            if (hasRmDigitCodes(key)) {
              const tplKey = toRmDigitTemplate(key)
              const tplZh = toRmDigitTemplate(value)
              if (tplKey !== key && isStorableTranslation(tplKey, tplZh)) {
                pairs.push([tplKey, tplZh])
              }
            }
          }
          /* Store body keys without boundary controls, but return the full shell for immediate in-game replacement. */
          pushPair(guard.core || sendText, zhCore)
          if (labelCore && labelCore !== src && guard.plain.trim()) {
            const labelKey = peelControlShell(labelCore).core || labelCore
            pushPair(labelKey, zhCore)
          }
          if (pairs.length && persist) {
            const written = cache.writeMany(pairs, tag, { from: detectCacheLang(src), to: 'zh' })
            if (contentRoot) cache.queueBackfill(contentRoot, written.records)
          }
          items.push({ src, zh, engine: tag })
          done = true
          break
        } catch (err) {
          errors.push(`${engine}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (!done) {
        items.push({ src, zh: null, error: errors.join('；') || (engines.length ? '翻译失败' : '未开启任何翻译平台') })
      }
    }
  } finally {
    try {
      if (contentRoot && opts?.persist !== false) cache.flushBackfill(contentRoot)
    } finally {
      cache.close()
    }
    // Preserve successful translations when a later item times out or is cancelled.
    if (contentRoot && toWrite.length) {
      try {
        appendGameNdjson(contentRoot, toWrite)
      } catch {
        /* 共享库已写入；本作文件失败不阻断 */
      }
    }
  }

  return { items, contentRoot, engines }
}
