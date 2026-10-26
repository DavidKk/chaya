import { detectCacheLang } from '@/lib/translate/cache-lang'
import { createBingTranslator, requestGoogle, requestOllama } from '@/lib/translate/engine-http'
import {
  DEFAULT_ENGINE_ORDER,
  engineAcceptsSensitive,
  engineSourceTag,
  findAgentEntry,
  mapTranslationBatch,
  type TranslateAgentEntry,
  type TranslateAiConfig,
  type TranslateEngineId,
  type TranslateRunEngine,
  translationFallbackOrder,
} from '@/lib/translate/engines'
import { nameEntriesFromLookup } from '@/lib/translate/name-glossary'
import type { ResourceHit } from '@/lib/translate/resource-types'
import { toRmDigitTemplate } from '@/lib/translate/rm-escape'
import { planSentenceTranslation, renderSentencePlan, resolveSentenceGaps, type SentencePlan, validateAlignments } from '@/lib/translate/sentence-plan'
import { planLockedNames, stitchLockedNamePlan } from '@/services/translate/name-lock'
import { scheduleOllama } from '@/services/translate/ollama-queue'
import { isSensitiveForCloud } from '@/services/translate/sensitive-text'
import {
  isReusableTranslation,
  isUsefulTranslation,
  protectSentenceForTranslate as protectForTranslate,
  restoreForTranslate,
  shouldTranslate,
  translationCoreForCache,
} from '@/services/translate/text-classify'

import { resolveApiBase } from '../../helpers/env/env'
import { chayaFetch } from '../../helpers/net/http'
import { collectGameNameSources } from '../lookup/lookup-enrich'
import { engineFetch } from './engine-fetch'
import type { TranslationStore } from './store'

export type EngineId = TranslateEngineId
export type TranslateItem = { src: string; zh: string | null; engine?: string; error?: string; plan?: SentencePlan; status?: SentencePlan['status']; resource?: ResourceHit }
export type TranslateOptions = {
  signal?: AbortSignal
  model?: string
  interactive?: boolean
  engines?: TranslateRunEngine[]
  force?: boolean
  persist?: boolean
  sourceLang?: string
  targetLang?: string
  remote?: boolean
  agents?: TranslateAgentEntry[]
}
export const ENGINE_ORDER: EngineId[] = DEFAULT_ENGINE_ORDER

export function createPluginTranslator(store: TranslationStore, http = engineFetch) {
  const bing = createBingTranslator(http)
  let retryRemoteAt = 0
  let remoteOnline: boolean | null = null

  async function remoteLookup(texts: string[], signal: AbortSignal, options: TranslateOptions = {}) {
    if (typeof window !== 'undefined' && (window as Window & { CHAYA_LOG_TRANSPORT?: string }).CHAYA_LOG_TRANSPORT === 'link') return [] as TranslateItem[]
    if (Date.now() < retryRemoteAt) return [] as TranslateItem[]
    const abort = new AbortController()
    const cancel = () => abort.abort()
    signal.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, 500)
    try {
      const response = await chayaFetch(`${resolveApiBase()}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({ mode: 'lookup', texts, origins: store.references(texts), from: options.sourceLang, to: options.targetLang }),
      })
      if (!response.ok) throw new Error('共享翻译库不可用')
      const data = await response.json()
      if (data.available === false || !Array.isArray(data.items)) throw new Error('共享翻译库暂不可用')
      remoteOnline = true
      if (Array.isArray(data.invalidOrigins))
        await store.invalidateOrigins(
          data.invalidOrigins.filter(
            (r: { id?: unknown; revision?: unknown; database?: unknown }) => typeof r?.id === 'string' && Number.isInteger(r.revision) && typeof r.database === 'string'
          )
        )
      return (data.items as TranslateItem[]).filter(
        (item) =>
          texts.includes(item.src) &&
          ((typeof item.zh === 'string' &&
            item.zh.length <= 20_000 &&
            (options.targetLang && options.targetLang !== 'zh' ? !!item.resource : isReusableTranslation(item.src, item.zh))) ||
            item.plan?.status === 'partial')
      )
    } catch {
      remoteOnline = false
      retryRemoteAt = Date.now() + 60_000
      return [] as TranslateItem[]
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    }
  }

  async function systemStatus(engine: 'apple' | 'bergamot', source: string, signal: AbortSignal, target = 'zh') {
    const response = await chayaFetch(`${resolveApiBase()}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ mode: `${engine}-status`, from: source, to: target }),
    })
    const data = await response.json()
    if (!response.ok || data.ok === false) throw new Error('Translation readiness check failed')
    return data as { installed: boolean; status: string; message?: string }
  }

  async function requestSystem(engine: 'apple' | 'bergamot', text: string, signal: AbortSignal, source?: string, target = 'zh'): Promise<string> {
    const response = await chayaFetch(`${resolveApiBase()}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ mode: engine, text, from: source || detectCacheLang(text), to: target }),
    })
    const data = (await response.json().catch(() => null)) as { ok?: boolean; text?: unknown; error?: { message?: unknown } } | null
    if (!response.ok || !data || data.ok === false || typeof data.text !== 'string') {
      const message = typeof data?.error?.message === 'string' ? data.error.message : `${engine} translation service unavailable (${response.status})`
      throw new Error(message)
    }
    return data.text
  }

  /** Agent endpoints and tokens remain in the local service; the plugin requests translation through that service. */
  async function requestAgent(text: string, ai: TranslateAiConfig, interactive: boolean | undefined, signal: AbortSignal) {
    const response = await chayaFetch(`${resolveApiBase()}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ mode: 'ai', text, ai: { profileId: ai.profileId, model: ai.model }, interactive: !!interactive }),
    })
    const data = (await response.json().catch(() => null)) as { ok?: boolean; text?: unknown; error?: { message?: unknown } } | null
    if (!response.ok || !data || data.ok === false || typeof data.text !== 'string') {
      const message = typeof data?.error?.message === 'string' ? data.error.message : `AI 翻译服务不可用（${response.status}）`
      throw new Error(message)
    }
    return data.text
  }

  async function sharedAgents(signal: AbortSignal | undefined, patch?: { agents?: unknown; order?: unknown }) {
    const writing = patch != null && (patch.agents !== undefined || patch.order !== undefined)
    try {
      const response = await chayaFetch(`${resolveApiBase()}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ mode: 'translate-agents', ...(writing ? { agents: patch?.agents, order: patch?.order } : {}) }),
      })
      const data = (await response.json().catch(() => null)) as { ok?: boolean; agents?: TranslateAgentEntry[]; order?: TranslateEngineId[]; stored?: boolean } | null
      if (!response.ok || !data || data.ok === false || !Array.isArray(data.agents)) return null
      return { agents: data.agents, order: Array.isArray(data.order) ? data.order : [], stored: data.stored !== false }
    } catch {
      return null
    }
  }

  async function listAgents(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await chayaFetch(`${resolveApiBase()}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ mode: 'agents' }),
    })
    const data = (await response.json().catch(() => null)) as { ok?: boolean; profiles?: unknown; models?: unknown; error?: { message?: unknown } } | null
    if (!response.ok || !data || data.ok === false || !Array.isArray(data.profiles)) {
      throw new Error(typeof data?.error?.message === 'string' ? data.error.message : `Agent 实例需要 Chaya 本机服务（${response.status}）`)
    }
    return { profiles: data.profiles, models: data.models && typeof data.models === 'object' ? data.models : {} }
  }

  async function translate(texts: string[], options: TranslateOptions = {}): Promise<TranslateItem[]> {
    const target = options.targetLang || 'zh'
    const chinese = ['zh', 'ch', 'zh-cn', 'zh-hans'].includes(target.toLowerCase())
    const resourceLookup = !options.force && options.remote !== false
    if (!chinese) options = { ...options, force: true, persist: false, remote: false, engines: options.engines?.filter((engine) => engine === 'apple' || engine === 'bergamot') }
    const signal = options.signal || new AbortController().signal
    await store.load()
    signal.throwIfAborted()
    const unique = [...new Set(texts)]
    if (unique.length > 40 || unique.some((text) => typeof text !== 'string') || unique.join('').length > 20_000) throw new Error('单次翻译最多 40 段、20000 字')
    const missing = unique.filter((src) => options.force || !store.lookup(src))
    const hasBackfills = store.references(unique).length > 0
    const remoteTexts = (hasBackfills ? unique : missing).filter((src) => !store.blocked(src))
    const remote = resourceLookup && remoteTexts.length ? await remoteLookup(remoteTexts, signal, options) : []
    const lookup: Record<string, string> = Object.create(null)
    for (const record of store.records()) lookup[record.src] = record.zh
    const nameEntries = nameEntriesFromLookup(collectGameNameSources(), lookup, target)
    return mapTranslationBatch(unique, async (src) => {
      const items: TranslateItem[] = []
      signal.throwIfAborted()
      if (!options.force) {
        const remotePlan = remote.find((item) => item.src === src)?.plan
        const remoteRecords = (Array.isArray(remotePlan?.matches) ? remotePlan.matches.slice(0, 500) : [])
          .map((m) => m?.record)
          .filter(
            (r) =>
              typeof r?.id === 'string' &&
              Number.isInteger(r.revision) &&
              (r.engine == null || typeof r.engine === 'string') &&
              typeof r.src === 'string' &&
              typeof r.zh === 'string' &&
              r.src.length <= 20_000 &&
              r.zh.length <= 20_000 &&
              (!r.alignments || validateAlignments(r, r.alignments))
          )
          .map((r) => ({ ...r, local: false }))
        const plan = remoteRecords.length ? planSentenceTranslation(src, [...store.records(), ...remoteRecords]) : store.plan(src)
        if (plan.status === 'full') {
          items.push({ src, zh: plan.zh, engine: plan.matches.every((m) => m.record.local) ? 'cache:local' : 'cache:remote', status: 'full', plan })
          return items[0]
        }
        if (plan.status === 'partial') {
          const before = JSON.stringify(store.records())
          const completed: Array<{ src: string; zh: string; engine: string }> = []
          const gaps = new Map<string, string>()
          for (const gap of plan.gaps) {
            const result = (await translate([gap.text], { ...options, force: false, persist: false, remote: false }))[0]
            if (result?.zh && !result.error) {
              gaps.set(gap.id, result.zh)
              if (result.engine?.startsWith('live:')) completed.push({ src: gap.text, zh: result.zh, engine: result.engine })
            }
          }
          await store.load()
          let freshRemote = remoteRecords
          let remoteChanged = false
          if (remoteRecords.length && options.remote !== false) {
            const refreshed = await remoteLookup([src], signal, options)
            if (remoteOnline) {
              freshRemote = (refreshed.find((r) => r.src === src)?.plan?.matches || []).map((m) => ({ ...m.record, local: false }))
              remoteChanged = remoteRecords.some((r) => !freshRemote.some((n) => n.id === r.id && n.revision === r.revision && n.zh === r.zh))
            }
          }
          if (JSON.stringify(store.records()) !== before || remoteChanged) {
            const fresh = freshRemote.length ? planSentenceTranslation(src, [...store.records(), ...freshRemote]) : store.plan(src)
            items.push({
              src,
              zh: fresh.zh ?? renderSentencePlan(fresh),
              engine: 'cache:changed',
              status: fresh.status,
              plan: fresh,
              error: fresh.status === 'full' ? undefined : '翻译库已更新，请重试缺口',
            })
            return items[0]
          }
          if (options.persist !== false) for (const item of completed) await store.put([[item.src, item.zh]], item.engine)
          const resolved = resolveSentenceGaps(plan, gaps)
          const full = resolved.status === 'full'
          items.push({
            src,
            zh: resolved.zh ?? renderSentencePlan(resolved),
            engine: 'cache:partial',
            status: full ? 'full' : 'partial',
            plan,
            error: full ? undefined : '部分短句未完成翻译',
          })
          return items[0]
        }
      }
      const local = !options.force ? store.lookup(src, true) : null
      const remoteItem = remote.find((item) => item.src === src)
      const shared = remoteItem?.zh
      if (local || shared) {
        // Remote results remain server-owned; do not persist an unversioned local copy.
        items.push({
          src,
          zh: local || shared || null,
          engine: local ? 'cache:local' : remoteItem?.resource ? 'resource' : 'cache:remote',
          resource: local ? undefined : remoteItem?.resource,
        })
        return items[0]
      }
      const namePlan = planLockedNames(src, nameEntries, {
        sourceLang: options.sourceLang,
        targetLang: target,
      })
      if (namePlan) {
        const gapZh = new Map<string, string>()
        let remainderEngine = ''
        if (namePlan.translatable.length) {
          const remainder = await translate(
            namePlan.translatable.map((gap) => gap.text),
            { ...options, force: false, persist: false, remote: false }
          )
          for (const gap of namePlan.translatable) {
            const hit = remainder.find((entry) => entry.src === gap.text)
            if (!hit?.zh || hit.error) {
              items.push({ src, zh: null, error: hit?.error || '未译完专名锁定后的剩余文本' })
              return items[0]
            }
            gapZh.set(gap.id, hit.zh)
            if (hit.engine) remainderEngine = hit.engine
          }
        }
        const zh = stitchLockedNamePlan(src, namePlan, gapZh)
        const tag = remainderEngine || 'live:optimize:names'
        if (options.persist !== false) await store.put([[src, zh]], tag)
        items.push({ src, zh, engine: tag, status: 'full' })
        return items[0]
      }
      const guard = protectForTranslate(src)
      if (!shouldTranslate(guard.core)) {
        items.push({ src, zh: src, engine: 'skip' })
        return items[0]
      }
      const sensitive = isSensitiveForCloud(guard.plain)
      const engines = translationFallbackOrder((options.engines || []).filter((engine) => !sensitive || engineAcceptsSensitive(engine)))
      let result: TranslateItem = { src, zh: null, error: '未开启可用翻译引擎' }
      const errors: string[] = []
      for (const engine of engines) {
        signal.throwIfAborted()
        try {
          const agent = findAgentEntry(options.agents, engine)
          if (!agent && engine.startsWith('agent:')) throw new Error('Agent 翻译条目已移除')
          const raw =
            engine === 'ollama'
              ? await scheduleOllama(
                  () => requestOllama(http, { text: guard.plain, model: options.model, interactive: options.interactive, signal }),
                  !!options.interactive,
                  signal
                )
              : agent
                ? await requestAgent(guard.plain, agent, options.interactive, signal)
                : engine === 'apple' || engine === 'bergamot'
                  ? await requestSystem(engine, guard.plain, signal, options.sourceLang, target)
                  : engine === 'google'
                    ? await requestGoogle(http, guard.plain, signal)
                    : await bing(guard.plain, signal)
          signal.throwIfAborted()
          const zh = restoreForTranslate(raw, guard)
          if (!isUsefulTranslation(src, guard.plain, raw, zh, target) || guard.tokens.some((_, i) => !raw.includes(`__C${i}__`))) throw new Error('引擎未返回有效译文或丢失控制码')
          if (options.persist !== false) {
            const core = translationCoreForCache(raw, guard)
            const pairs: Array<[string, string]> = [
              [src, zh],
              [guard.core, core],
            ]
            const template = toRmDigitTemplate(guard.core)
            if (template !== guard.core) pairs.push([template, toRmDigitTemplate(core)])
            await store.put(pairs, `live:${engineSourceTag(engine, options.agents)}`)
          }
          result = { src, zh, engine: `live:${engineSourceTag(engine, options.agents)}` }
          break
        } catch (error) {
          signal.throwIfAborted()
          errors.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`)
          result = { src, zh: null, error: errors.join('; ') }
        }
      }
      items.push(result)
      return items[0]
    })
  }
  return { translate, listAgents, sharedAgents, systemStatus, remoteOnline: () => remoteOnline }
}
