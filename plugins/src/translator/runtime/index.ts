import { engineStateFileBody, mergeEngineState, TRANSLATE_ENGINE_IDS, type TranslateEngineSwitches } from '@/lib/translate/engines'
import { normalizePlaySettings, type TranslationPlaySettings } from '@/lib/translate/play-settings'
import type { TranslationRequest, TranslationRequestFn } from '@/lib/translate/runtime-api'
import { parseTranslateImportText } from '@/services/translate/import-text'
import { isStorableTranslation } from '@/services/translate/text-classify'

import { type NodeFsPath, tryNodeFsPath } from '../../helpers/node/node-require'
import { extractPluginSeed } from './extract'
import { createPluginTranslationJob } from './jobs'
import { createTranslationStore } from './store'
import { createPluginTranslator, type TranslateOptions } from './translator'

type Activity = { id: number; at: number; level: 'info' | 'ok' | 'warn' | 'fail'; text: string }

/** 一个游戏一个翻译运行时；局内面板和已连接的 Web/App 调用同一实例。 */
export function createTranslationRuntime(contentRoot: string, options: { mods?: NodeFsPath; onChange?: () => void } = {}) {
  const mods = options.mods || tryNodeFsPath()
  if (!mods) throw new Error('当前游戏无法访问本作翻译库，请使用 NW.js 游戏壳')
  const store = createTranslationStore(contentRoot, mods, options.onChange || (() => {}))
  const translator = createPluginTranslator(store)
  const activity: Activity[] = []
  let activityId = 0
  let activityStatus = ''
  let activityDone = 0
  function recordActivity(event: { level: Activity['level']; text: string; status?: string }) {
    activity.push({ id: ++activityId, at: Date.now(), level: event.level, text: event.text })
    if (activity.length > 120) activity.shift()
    if (event.status) activityStatus = event.status
    if (event.status === '已译') activityDone++
  }
  const lifetime = new AbortController()
  let settings = normalizePlaySettings(null)
  let settingsError: unknown = null
  let settingsCheckedAt = 0
  const initialize = store
    .readJson('translationPlay', null)
    .then((raw) => {
      settings = normalizePlaySettings(raw)
    })
    .catch((error) => {
      settingsError = error
    })
  let settingsPoll: Promise<void> | null = null
  function readSettings(): TranslationPlaySettings {
    if (!lifetime.signal.aborted && !settingsPoll && Date.now() - settingsCheckedAt > 1000) {
      settingsCheckedAt = Date.now()
      settingsPoll = store
        .readJson('translationPlay', null)
        .then((raw) => {
          settings = normalizePlaySettings(raw)
          settingsError = null
        })
        .catch((error) => {
          settingsError = error
        })
        .finally(() => {
          settingsPoll = null
        })
    }
    return settings
  }
  async function engineState(patch?: Record<string, unknown>) {
    const raw = await store.readJson<Record<string, unknown>>('switches', {})
    const provided = patch?.switches && typeof patch.switches === 'object' ? (patch.switches as Partial<TranslateEngineSwitches>) : undefined
    const switches = provided ? Object.fromEntries(TRANSLATE_ENGINE_IDS.filter((id) => typeof provided[id] === 'boolean').map((id) => [id, provided[id]])) : undefined
    const agents = Array.isArray(patch?.agents) ? patch.agents : undefined
    const writing = !!(switches || patch?.order || agents)
    const state = mergeEngineState(raw, writing ? { switches, order: patch?.order, agents } : undefined)
    if (writing) await store.writeJson('switches', engineStateFileBody(state))
    return state
  }
  async function translate(texts: string[], opts: TranslateOptions = {}) {
    await initialize
    if (settingsError) throw settingsError
    if (lifetime.signal.aborted || opts.signal?.aborted) throw new Error('翻译已取消')
    if (opts.interactive) job.preempt()
    const abort = new AbortController()
    const cancel = () => abort.abort()
    lifetime.signal.addEventListener('abort', cancel, { once: true })
    opts.signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, opts.interactive ? settings.timeoutMs : 30_000)
    try {
      const engines = await engineState()
      return await translator.translate(texts, {
        ...opts,
        model: opts.model ?? settings.model,
        signal: abort.signal,
        engines: opts.engines || engines.enabled,
        agents: opts.agents ?? engines.agents,
      })
    } finally {
      clearTimeout(timer)
      lifetime.signal.removeEventListener('abort', cancel)
      opts.signal?.removeEventListener('abort', cancel)
    }
  }
  const job = createPluginTranslationJob(store, (texts, signal) => translate(texts, { signal }))
  let extracting: Promise<unknown> | null = null

  async function execute(input: TranslationRequest, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (lifetime.signal.aborted || signal?.aborted) throw new Error('翻译已取消')
    if (!input || typeof input.path !== 'string' || !['GET', 'POST', 'PATCH', 'DELETE'].includes(input.method)) throw new Error('无效翻译操作')
    const url = new URL(input.path, 'http://game.local')
    const body = input.body || {}
    if (url.pathname === '/api/extract' && input.method === 'POST') {
      if (!extracting)
        extracting = extractPluginSeed(contentRoot, mods!, store, lifetime.signal).finally(() => {
          extracting = null
        })
      return (await extracting) as Record<string, unknown>
    }
    if (url.pathname === '/api/translate-cache') {
      await store.load()
      if (input.method === 'GET') return store.query(url.searchParams)
      if (input.method === 'POST') {
        if (typeof body.text !== 'string' || body.text.length > 16 * 1024 * 1024) throw new Error('翻译库文件无效或超过 16 MB')
        const parsed = parseTranslateImportText(body.text)
        const entries = Object.entries(parsed.map).filter(([src, zh]) => isStorableTranslation(src, zh))
        const pairs = entries.filter(([src]) => body.overwrite === true || !store.lookup(src))
        if (!entries.length) throw new Error('文件中没有有效译文')
        await store.put(pairs, 'import')
        return { inserted: pairs.length, total: entries.length, skippedExisting: entries.length - pairs.length, format: parsed.format }
      }
      if (typeof body.src !== 'string' || !body.src) throw new Error('缺少原文')
      if (input.method === 'DELETE') {
        await store.put([[body.src, null]], 'deleted')
        return { deleted: true }
      }
      if (input.method === 'PATCH') {
        if (typeof body.zh !== 'string' || !isStorableTranslation(body.src, body.zh)) throw new Error('译文不能与原文相同，也不能保留日文假名')
        await store.put([[body.src, body.zh.trim()]], 'manual')
        return { updated: true }
      }
    }
    if (url.pathname !== '/api/translate' || input.method !== 'POST') throw new Error('不支持的翻译操作')
    await initialize
    if (body.mode === 'play-settings') {
      if (body.settings !== undefined) {
        if (body.contentRoot !== contentRoot) throw new Error('当前游戏已变化，请重新加载设置')
        const next = normalizePlaySettings(body.settings)
        await store.writeJson('translationPlay', next)
        settings = next
        settingsError = null
      } else {
        settings = normalizePlaySettings(await store.readJson('translationPlay', null))
        settingsError = null
      }
      return { settings, contentRoot }
    }
    if (body.mode === 'switches') return engineState(body)
    if (body.mode === 'agents') return translator.listAgents(signal)
    if (body.mode === 'progress') return { ...(await job.snapshot()), activity: { logs: [...activity], liveStatus: activityStatus, sessionDone: activityDone } }
    if (body.mode === 'job') {
      if (body.action === 'pause') return job.pause()
      if (body.action === 'start') {
        if (!(await engineState()).enabled.length) throw new Error('未开启任何翻译平台')
        return job.start()
      }
      throw new Error('无效任务操作')
    }
    if (body.mode === 'benchmark') {
      const sample = 'この先の森には魔物がいる。夜になる前に村へ戻ろう。準備ができたら、宿屋の前で待っていてくれ。'
      const started = Date.now()
      const testSettings = normalizePlaySettings(body.settings)
      const items = await translate([sample], { signal, model: testSettings.model, force: true, persist: false, remote: false, interactive: true, engines: ['ollama'] })
      if (!items[0]?.zh) throw new Error(items[0]?.error || '本地模型没有返回有效译文')
      return { sample, translation: items[0].zh, characters: Array.from(sample).length, elapsedMs: Date.now() - started }
    }
    const texts = Array.isArray(body.texts) ? body.texts : typeof body.text === 'string' ? [body.text] : []
    if (!texts.length || texts.some((text) => typeof text !== 'string')) throw new Error('缺少有效原文')
    return { items: await translate(texts as string[], { signal, force: body.force === true, persist: body.persist !== false }) }
  }
  const request: TranslationRequestFn = async (input, signal) => {
    try {
      return { status: 200, data: { ...(await execute(input, signal)), ok: true } }
    } catch (error) {
      return { status: 400, data: { ok: false, error: { message: error instanceof Error ? error.message : '翻译操作失败' } } }
    }
  }
  return {
    request,
    translate,
    settings: readSettings,
    remoteOnline: translator.remoteOnline,
    recordActivity,
    dispose: () => {
      lifetime.abort()
      job.dispose()
    },
  }
}
