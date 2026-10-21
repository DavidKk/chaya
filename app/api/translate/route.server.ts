import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { resolveGame } from '@/lib/game'
import type { TranslateRunEngine } from '@/lib/translate/engines'
import { normalizeAiConfig } from '@/lib/translate/engines'
import { hasManagementAccess } from '@/services/access/management'
import {
  exportSourcesJob,
  fillMissingFromSeed,
  getSeedJobSnapshot,
  getSourcesJobStatus,
  getTranslateEngineSwitches,
  importSourcesJob,
  liveTranslateTexts,
  pauseSeedJob,
  requireDisk,
  searchSourcesJob,
  setTranslateEngineSwitches,
  startSeedJob,
  type TranslateEngineId,
  type TranslateEngineSwitches,
} from '@/services/disk-ops'
import { peekLaunchToken } from '@/services/runtime/launch-token'
import { resolveTranslateContentRoot } from '@/services/translate/fill-missing'
import { getTranslationPlaySettings, setTranslationPlaySettings } from '@/services/translate/play-settings'
import { benchmarkLocalModel, translateDialogue } from '@/services/translate/realtime'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Chaya-Launch-Token' },
  })
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 服务内翻译（插件 miss / 页面补齐）：
 * - `{ text }` / `{ texts }`：即时日→中
 * - `{ mode: 'seed' }`：对当前绑定游戏 seed 缺词补一轮（单批）
 * - `{ mode: 'progress' }`：只读进度 + 后台任务快照
 * - `{ mode: 'job', action: 'start' | 'pause' }`：启停服务端补译循环
 * - `{ mode: 'sources', action: 'import' | 'status' | 'search' | 'export' }`：异步源文字符串包（登记 key → 后台译 → 搜索/整包导出）
 * - `{ mode: 'switches' }`：读引擎开关/顺序/Agent 条目；带 `switches` / `order` / `agents` 则写入。Agent 条目全游戏共用
 * - `{ mode: 'translate-agents' }`：只读写共用 Agent 条目（游戏内插件用；平台开关仍留在该游戏）
 * - `{ mode: 'agents' }`：列出可选的 Agent 实例（名称 / 模型，不含端点与 token）
 * - `{ mode: 'ai', text, ai }`：用选定 Agent 实例翻译一段（插件 AI 引擎走这里，token 不出服务端）
 *
 * 迁移期：整路由属 DiskOps（未拆无盘核心前 remote 一律 501）。
 */
export const POST = defineApiRoute('post:/api/translate', async ({ request }) => {
  const denied = requireDisk()

  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string
      texts?: string[]
      zh?: string
      mode?:
        | 'lookup'
        | 'live'
        | 'realtime'
        | 'cache'
        | 'apple'
        | 'bergamot'
        | 'bergamot-status'
        | 'ai'
        | 'agents'
        | 'play-settings'
        | 'benchmark'
        | 'seed'
        | 'progress'
        | 'switches'
        | 'job'
        | 'translate-agents'
        | 'extract-items'
        | 'save-item'
        | 'rgss-write'
        | 'reset-item'
        | 'import-locales-corpus'
        | 'sources'
      settings?: unknown
      contentRoot?: string
      action?: 'start' | 'pause' | 'import' | 'status' | 'search' | 'export'
      limit?: number
      /** 跳过缓存强制重译 */
      force?: boolean
      /** false：只返回译文不落盘（编辑预览） */
      persist?: boolean
      sourceLang?: string
      targetLang?: string
      source?: string
      target?: string
      translations?: Record<string, string>
      from?: string
      to?: string
      localesKey?: string
      targetFile?: string
      switches?: Partial<TranslateEngineSwitches>
      order?: TranslateEngineId[]
      engines?: TranslateRunEngine[]
      /** switches：Agent 翻译条目整表替换 */
      agents?: unknown
      /** ai：本次翻译用的实例 / 模型 */
      ai?: unknown
      interactive?: boolean
      origins?: unknown
      /** sources job id */
      jobId?: string
      key?: string
      q?: string
      page?: number
      pageSize?: number
      onlyDone?: boolean
    }

    // 插件可选共享库查询：不绑定服务端当前游戏，也绝不触发推理或写游戏文件。
    if (body.mode === 'lookup') {
      const texts = body.texts
      if (!Array.isArray(texts) || texts.length > 40 || texts.some((text) => typeof text !== 'string') || texts.join('').length > 20_000) return apiBadLookup()
      if (body.origins != null && (!Array.isArray(body.origins) || body.origins.length > 500)) return apiBadLookup()
      if (denied) return apiOk({ available: false, items: [] })
      const { lookupSharedTranslationSnapshot } = await import('@/services/translate/shared-lookup')
      return apiOk({ available: true, ...lookupSharedTranslationSnapshot(texts, body.origins) })
    }
    if (denied) return denied

    if (body.mode === 'play-settings') {
      const contentRoot = resolveTranslateContentRoot()
      if (body.settings !== undefined && body.contentRoot !== contentRoot) return apiError(409, 'GAME_CHANGED', 'Game has changed, please reload settings')
      const settings = body.settings === undefined ? getTranslationPlaySettings(contentRoot) : setTranslationPlaySettings(contentRoot, body.settings)
      return apiOk({ contentRoot, settings })
    }
    if (body.mode === 'benchmark') return apiOk(await benchmarkLocalModel(body.settings, request.signal))

    if (body.mode === 'progress') {
      return apiOk(getSeedJobSnapshot())
    }

    if (body.mode === 'job') {
      if (body.action === 'pause') return apiOk(pauseSeedJob())
      if (body.action === 'start') return apiOk(startSeedJob())
      return apiError(400, 'TRANSLATE_JOB_ACTION', 'Missing action: start | pause')
    }

    if (body.mode === 'sources') {
      const action = body.action || 'status'
      if (action === 'import') {
        const text = typeof body.text === 'string' ? body.text : ''
        if (!text.trim()) return apiError(400, 'SOURCES_IMPORT_EMPTY', 'Missing text JSON for sources import')
        return apiOk(importSourcesJob(text, { force: Boolean(body.force) }))
      }
      if (action === 'status') {
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        if (!jobId.trim()) return apiError(400, 'SOURCES_JOB_ID', 'Missing jobId')
        return apiOk(getSourcesJobStatus(jobId))
      }
      if (action === 'search') {
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        if (!jobId.trim()) return apiError(400, 'SOURCES_JOB_ID', 'Missing jobId')
        return apiOk(
          searchSourcesJob(jobId, {
            key: typeof body.key === 'string' ? body.key : undefined,
            q: typeof body.q === 'string' ? body.q : undefined,
            page: typeof body.page === 'number' ? body.page : undefined,
            pageSize: typeof body.pageSize === 'number' ? body.pageSize : undefined,
          })
        )
      }
      if (action === 'export') {
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        if (!jobId.trim()) return apiError(400, 'SOURCES_JOB_ID', 'Missing jobId')
        return apiOk(exportSourcesJob(jobId, { onlyDone: Boolean(body.onlyDone) }))
      }
      return apiError(400, 'SOURCES_ACTION', 'action must be import | status | search | export')
    }

    if (body.mode === 'switches') {
      const agents = Array.isArray(body.agents) ? body.agents : undefined
      if ((body.switches && typeof body.switches === 'object') || Array.isArray(body.order) || agents) {
        return apiOk(setTranslateEngineSwitches({ switches: body.switches, order: body.order, agents }))
      }
      return apiOk(getTranslateEngineSwitches())
    }

    if (body.mode === 'translate-agents') {
      const { readSharedTranslateAgents, writeSharedTranslateAgents } = await import('@/services/translate/shared-agents')
      if (Array.isArray(body.agents) || Array.isArray(body.order)) return apiOk(writeSharedTranslateAgents({ agents: body.agents, order: body.order }))
      return apiOk(readSharedTranslateAgents())
    }

    if (body.mode === 'agents') {
      const { listTranslateAgents } = await import('@/services/translate/agent-translate')
      return apiOk(listTranslateAgents())
    }

    if (body.mode === 'seed') {
      const result = await fillMissingFromSeed({ limit: body.limit })
      return apiOk(result)
    }

    const session = !hasManagementAccess(request) ? peekLaunchToken(request.headers.get('x-chaya-launch-token')) : null
    const game = session ? resolveGame(session.gameRoot) : null
    if (session && (!game?.ok || game.remote)) return apiError(400, 'GAME_UNAVAILABLE', 'Game path unavailable')

    if (body.mode === 'extract-items') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      const { loadExtractedItemsWithLocales } = await import('@/services/extract/lib/extract-items')
      const sourceLang = typeof body.sourceLang === 'string' ? body.sourceLang : undefined
      const targetLang = typeof body.targetLang === 'string' ? body.targetLang : undefined
      const res = loadExtractedItemsWithLocales(root, { sourceLang, targetLang })
      return apiOk(res)
    }

    if (body.mode === 'import-locales-corpus') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      const { importGameLocalesCorpus } = await import('@/services/translate/locales-corpus')
      const limit = typeof body.limit === 'number' ? body.limit : undefined
      const result = importGameLocalesCorpus(root, { limit })
      return apiOk(result)
    }

    if (body.mode === 'save-item') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      const text = typeof body.text === 'string' ? body.text : ''
      const zh = typeof body.zh === 'string' ? body.zh : ''
      if (!text && !body.localesKey) return apiError(400, 'SAVE_ITEM_EMPTY', 'Missing source text or localesKey')

      if (typeof body.localesKey === 'string' && body.localesKey) {
        const { saveLocalesItem } = await import('@/services/extract/lib/save-locales-item')
        const result = saveLocalesItem({
          contentRoot: root,
          localesKey: body.localesKey,
          text,
          zh,
          sourceLang: typeof body.sourceLang === 'string' ? body.sourceLang : undefined,
          targetLang: typeof body.targetLang === 'string' ? body.targetLang : undefined,
          targetFile: typeof body.targetFile === 'string' ? body.targetFile : undefined,
        })
        return apiOk(result)
      }

      const { saveExtractedItem } = await import('@/services/extract/lib/save-items')
      return apiOk(saveExtractedItem(root, text, zh))
    }

    if (body.mode === 'rgss-write') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      const translations = body.translations && typeof body.translations === 'object' ? body.translations : null
      if (!translations || Array.isArray(translations)) return apiError(400, 'RGSS_WRITE_INPUT', 'Missing translations')
      const resolved = resolveGame(root)
      if (!resolved.ok || (resolved.engine !== 'VX Ace' && resolved.engine !== 'VX')) {
        return apiError(400, 'RGSS_WRITE_ENGINE', 'RGSS writeback requires a VX Ace or VX project')
      }
      const { writeRgssTranslations } = await import('@/services/extract/lib/rgss')
      return apiOk({ engine: resolved.engine, ...writeRgssTranslations(root, translations as Record<string, string>) })
    }

    if (body.mode === 'reset-item') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text) return apiError(400, 'RESET_ITEM_EMPTY', 'Missing source text')
      const { resetExtractedItem } = await import('@/services/extract/lib/save-items')
      return apiOk(resetExtractedItem(root, text))
    }

    if (body.mode === 'bergamot' || body.mode === 'bergamot-status') {
      const source = typeof (body.from ?? body.source) === 'string' ? (body.from ?? body.source) : undefined
      const target = typeof (body.to ?? body.target) === 'string' ? (body.to ?? body.target) : undefined
      const { bergamotTranslator } = await import('@/services/translate/lib/bergamot-translate')
      if (body.mode === 'bergamot-status') return apiOk(await bergamotTranslator.checkStatus(source, target))
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim() || text.length > 20_000) return apiError(400, 'TRANSLATE_BERGAMOT_INPUT', 'Bergamot offline translation requires text of 1-20000 characters')
      return apiOk({ text: await bergamotTranslator.translate(text, { source, target }) })
    }

    const texts = Array.isArray(body.texts) ? body.texts : body.text != null ? [body.text] : []
    if (!texts.length) {
      return apiError(400, 'TRANSLATE_EMPTY', 'Missing text / texts')
    }

    if (body.mode === 'cache') {
      const text = typeof body.text === 'string' ? body.text : texts[0] || ''
      if (!text.trim()) return apiError(400, 'TRANSLATE_CACHE_INPUT', 'Missing query text')
      let root: string | null = null
      try {
        root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      } catch {
        root = null
      }
      const { openSharedCache } = await import('@/services/translate/shared-cache')
      const { loadGameTranslationRecords } = await import('@/services/translate/game-records')
      const { loadGameTranslateLookup } = await import('@/services/translate/game-lookup')
      const { lookupGameTranslation } = await import('@/services/translate/cache-lookup')
      const { detectCacheLang } = await import('@/lib/translate/cache-lang')
      const cache = openSharedCache()
      try {
        const localRecords = root ? loadGameTranslationRecords(root, (origin) => origin.database === cache.path && cache.current([{ ...origin, src: '', zh: '' }])) : []
        const localLookup = root ? loadGameTranslateLookup(root) : null
        const pair = { from: detectCacheLang(text), to: 'zh' as const }
        const plan = cache.plan(text, pair, localRecords)
        if (plan.status === 'full' && plan.zh) {
          return apiOk({ items: [{ src: text, zh: plan.zh, engine: 'cache:full' }] })
        }
        const cached = root
          ? lookupGameTranslation(
              (k: string) => (localLookup ? (localLookup[k] ?? null) : null),
              (k: string) => cache.get(k),
              text
            )
          : null
        if (cached?.zh) {
          return apiOk({ items: [{ src: text, zh: cached.zh, engine: cached.engine }] })
        }
        return apiOk({ items: [{ src: text, zh: null, error: '未在缓存中命中翻译' }] })
      } finally {
        cache.close()
      }
    }
    if (body.mode === 'apple') {
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim() || text.length > 20_000) return apiError(400, 'TRANSLATE_APPLE_INPUT', 'Apple offline translation requires text of 1-20000 characters')
      const { appleTranslate } = await import('@/services/translate/lib/macos-translate')
      return apiOk({ text: await appleTranslate(text, { source: (body.from || body.source || 'ja') as string, target: (body.to || body.target || 'zh-Hans') as string }) })
    }
    if (body.mode === 'ai') {
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim() || text.length > 20_000) return apiError(400, 'TRANSLATE_AI_INPUT', 'AI translation requires text of 1-20000 characters')
      const { agentJaToZh } = await import('@/services/translate/agent-translate')
      return apiOk({ text: await agentJaToZh(text, normalizeAiConfig(body.ai), { interactive: body.interactive === true, signal: request.signal }) })
    }
    if (body.mode === 'realtime') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      return apiOk(await translateDialogue(root, texts, request.signal))
    }
    const { items, contentRoot, engines } = await liveTranslateTexts(texts, {
      contentRoot: game?.ok ? game.contentRoot : undefined,
      force: Boolean(body.force),
      persist: body.persist !== false,
      engines: Array.isArray(body.engines) ? body.engines : undefined,
      sourceLang: typeof body.sourceLang === 'string' ? body.sourceLang : typeof body.from === 'string' ? body.from : undefined,
      targetLang: typeof body.targetLang === 'string' ? body.targetLang : typeof body.to === 'string' ? body.to : undefined,
    })
    const okCount = items.filter((i) => i.zh).length
    return apiOk({ items, translated: okCount, total: items.length, contentRoot, engines }, { headers: { 'Access-Control-Allow-Origin': '*' } })
  } catch (err) {
    return apiError(500, 'TRANSLATE_FAILED', err instanceof Error ? err.message : String(err))
  }
})

export type { TranslateEngineId }

function apiBadLookup() {
  return apiError(400, 'TRANSLATE_LOOKUP_INPUT', 'Translation lookup supports up to 40 segments and 20000 characters')
}
