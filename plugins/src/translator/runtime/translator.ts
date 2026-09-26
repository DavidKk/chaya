import { createBingTranslator, requestGoogle, requestOllama } from '@/lib/translate/engine-http'
import { toRmDigitTemplate } from '@/lib/translate/rm-escape'
import { scheduleOllama } from '@/services/translate/ollama-queue'
import { isSensitiveForCloud } from '@/services/translate/sensitive-text'
import { isStorableTranslation, isUsefulTranslation, protectForTranslate, restoreForTranslate, shouldTranslate, translationCoreForCache } from '@/services/translate/text-classify'

import { resolveApiBase } from '../../helpers/env/env'
import { chayaFetch } from '../../helpers/net/http'
import { engineFetch } from './engine-fetch'
import type { TranslationStore } from './store'

export type EngineId = 'ollama' | 'bing' | 'google'
export type TranslateItem = { src: string; zh: string | null; engine?: string; error?: string }
export type TranslateOptions = { signal?: AbortSignal; model?: string; interactive?: boolean; engines?: EngineId[]; force?: boolean; persist?: boolean; remote?: boolean }
export const ENGINE_ORDER: EngineId[] = ['ollama', 'bing', 'google']

export function createPluginTranslator(store: TranslationStore, http = engineFetch) {
  const bing = createBingTranslator(http)
  let retryRemoteAt = 0
  let remoteOnline: boolean | null = null

  async function remoteLookup(texts: string[], signal: AbortSignal) {
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
        body: JSON.stringify({ mode: 'lookup', texts }),
      })
      if (!response.ok) throw new Error('共享翻译库不可用')
      const data = await response.json()
      if (data.available === false || !Array.isArray(data.items)) throw new Error('共享翻译库暂不可用')
      remoteOnline = true
      return (data.items as TranslateItem[]).filter(
        (item) => texts.includes(item.src) && typeof item.zh === 'string' && item.zh.length <= 20_000 && isStorableTranslation(item.src, item.zh)
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

  async function translate(texts: string[], options: TranslateOptions = {}): Promise<TranslateItem[]> {
    const signal = options.signal || new AbortController().signal
    await store.load()
    signal.throwIfAborted()
    const unique = [...new Set(texts)]
    if (unique.length > 40 || unique.some((text) => typeof text !== 'string') || unique.join('').length > 20_000) throw new Error('单次翻译最多 40 段、20000 字')
    const missing = unique.filter((src) => options.force || !store.lookup(src))
    const remote = !options.force && options.remote !== false && missing.length ? await remoteLookup(missing, signal) : []
    const items: TranslateItem[] = []
    for (const src of unique) {
      signal.throwIfAborted()
      const local = !options.force ? store.lookup(src, true) : null
      const shared = remote.find((item) => item.src === src)?.zh
      if (local || shared) {
        if (!local && shared && options.persist !== false) await store.put([[src, shared]], 'remote')
        items.push({ src, zh: local || shared || null, engine: local ? 'cache:local' : 'cache:remote' })
        continue
      }
      const guard = protectForTranslate(src)
      if (!shouldTranslate(guard.core)) {
        items.push({ src, zh: src, engine: 'skip' })
        continue
      }
      const engines = (options.engines || ['ollama']).filter((engine) => engine === 'ollama' || !isSensitiveForCloud(guard.plain))
      let result: TranslateItem = { src, zh: null, error: '未开启可用翻译引擎' }
      for (const engine of engines) {
        signal.throwIfAborted()
        try {
          const raw =
            engine === 'ollama'
              ? await scheduleOllama(
                  () => requestOllama(http, { text: guard.plain, model: options.model, interactive: options.interactive, signal }),
                  !!options.interactive,
                  signal
                )
              : engine === 'google'
                ? await requestGoogle(http, guard.plain, signal)
                : await bing(guard.plain, signal)
          signal.throwIfAborted()
          const zh = restoreForTranslate(raw, guard)
          if (!isUsefulTranslation(src, guard.plain, raw, zh) || guard.tokens.some((_, i) => !raw.includes(`__C${i}__`))) throw new Error('引擎未返回有效译文或丢失控制码')
          if (options.persist !== false) {
            const core = translationCoreForCache(raw, guard)
            const pairs: Array<[string, string]> = [
              [src, zh],
              [guard.core, core],
            ]
            const template = toRmDigitTemplate(guard.core)
            if (template !== guard.core) pairs.push([template, toRmDigitTemplate(core)])
            await store.put(pairs, `live:${engine}`)
          }
          result = { src, zh, engine: `live:${engine}` }
          break
        } catch (error) {
          signal.throwIfAborted()
          result = { src, zh: null, error: error instanceof Error ? error.message : '翻译失败' }
        }
      }
      items.push(result)
    }
    return items
  }
  return { translate, remoteOnline: () => remoteOnline }
}
