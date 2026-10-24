import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { resolveGame } from '@/lib/game'
import type { TranslateRunEngine } from '@/lib/translate/engines'
import { normalizeAiConfig } from '@/lib/translate/engines'
import { detectSourceLanguage } from '@/lib/translate/source-text'
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
  refreshSeedJobProgress,
  requireDisk,
  resumeSourcesJob,
  searchSourcesJob,
  setTranslateEngineSwitches,
  startSeedJob,
  type TranslateEngineId,
  type TranslateEngineSwitches,
} from '@/services/disk-ops'
import { pathEquals } from '@/services/game'
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
        | 'apple-status'
        | 'bergamot'
        | 'bergamot-status'
        | 'bergamot-packs'
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
        | 'rgss-preview'
        | 'reset-item'
        | 'import-locales-corpus'
        | 'sources'
        | 'optimize'
      settings?: unknown
      contentRoot?: string
      action?:
        | 'start'
        | 'pause'
        | 'resume'
        | 'import'
        | 'status'
        | 'search'
        | 'export'
        | 'plan'
        | 'install'
        | 'cancel'
        | 'scan'
        | 'apply-terms'
        | 'short-entities'
        | 'batch-optimize'
        | 'scan-names'
        | 'apply-names'
        | 'idle-status'
      scope?: 'short-entities' | 'all'
      includeChoices?: boolean
      planId?: string
      limit?: number
      /** 跳过缓存强制重译 */
      force?: boolean
      /** progress：显式重扫 seed 库存（轮询不得带此标记）；extract-items：轮询准备结果 */
      refresh?: boolean
      /** extract-items：仅查询单飞准备状态，不额外开新任务语义（与 refresh 等价） */
      poll?: boolean
      /** false：只返回译文不落盘（编辑预览） */
      persist?: boolean
      sourceLang?: string
      targetLang?: string
      source?: string
      target?: string
      category?: string
      speaker?: string
      context?: string
      translations?: Record<string, string>
      /** rgss-preview：只写 translation-preview.json；局内渲染时查表开/关（不动 Data） */
      view?: 'original' | 'translated'
      from?: string
      to?: string
      localesKey?: string
      targetFile?: string
      switches?: Partial<TranslateEngineSwitches>
      order?: TranslateEngineId[]
      engines?: TranslateRunEngine[]
      /** switches：Agent 翻译条目整表替换 */
      agents?: unknown
      configs?: Record<string, import('@/lib/translate/engines').TranslateEngineSettings>
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

    if (body.mode === 'bergamot-packs') {
      if (denied) return denied
      if (!hasManagementAccess(request)) return apiError(403, 'MANAGEMENT_REQUIRED', 'Open the local console to manage language packs')
      if (typeof body.from !== 'string' || typeof body.to !== 'string' || !/^[a-zA-Z-]{2,16}$/.test(body.from) || !/^[a-zA-Z-]{2,16}$/.test(body.to))
        return apiError(400, 'PACK_INVALID_PAIR', 'Choose a source and target language')
      const { packManager } = await import('@/services/translate/bergamot/manager')
      const manager = packManager()
      try {
        if (body.action === 'install' && typeof body.planId === 'string') return apiOk(await manager.install(body.from, body.to, body.planId))
        if (body.action === 'cancel' && typeof body.jobId === 'string') return apiOk(await manager.cancel(body.from, body.to, body.jobId))
        if (body.action === 'plan' || body.action === 'status') return apiOk(await manager.plan(body.from, body.to))
        return apiError(400, 'PACK_INVALID_ACTION', 'Invalid language pack action')
      } catch (error) {
        const code = error instanceof Error ? error.message : 'PACK_INSTALL_FAILED'
        return apiError(409, code, code)
      }
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
      if (body.settings !== undefined && !pathEquals(body.contentRoot || '', contentRoot)) return apiError(409, 'GAME_CHANGED', 'Game has changed, please reload settings')
      const settings = body.settings === undefined ? getTranslationPlaySettings(contentRoot) : setTranslationPlaySettings(contentRoot, body.settings)
      const { looksLikeRgssProject } = await import('@/services/extract/lib/rgss')
      const isRgss = looksLikeRgssProject(contentRoot)
      return apiOk({ contentRoot, settings, isRgss })
    }
    if (body.mode === 'benchmark') return apiOk(await benchmarkLocalModel(body.settings, request.signal))

    if (body.mode === 'progress') {
      if (body.refresh === true) return apiOk(refreshSeedJobProgress())
      return apiOk(getSeedJobSnapshot())
    }

    if (body.mode === 'job') {
      if (body.action === 'pause') return apiOk(pauseSeedJob())
      if (body.action === 'start') return apiOk(startSeedJob())
      return apiError(400, 'TRANSLATE_JOB_ACTION', 'Missing action: start | pause')
    }

    if (body.mode === 'optimize') {
      const { scanGameTranslationsForOptimization, applyGameTermFixes, batchOptimizeTranslations, runShortEntityOptimization, isSystemIdleForOptimization } =
        await import('@/services/translate/optimize-service')
      const { scanNameSentenceSync, applyNameSentenceSync } = await import('@/services/translate/name-sync-service')

      const action = body.action || 'scan'
      const scope = body.scope === 'short-entities' || body.scope === 'all' ? body.scope : undefined
      const includeChoices = body.includeChoices !== false
      if (action === 'scan') {
        return apiOk(scanGameTranslationsForOptimization(body.contentRoot, { scope, includeChoices }))
      }
      if (action === 'apply-terms') {
        return apiOk(applyGameTermFixes(body.contentRoot, { scope: scope || 'short-entities', includeChoices }))
      }
      if (action === 'short-entities') {
        const engines = Array.isArray(body.engines) ? (body.engines as any) : undefined
        return apiOk(
          await runShortEntityOptimization({
            contentRoot: body.contentRoot,
            limit: typeof body.limit === 'number' ? body.limit : undefined,
            engines,
            includeChoices,
            signal: request.signal,
          })
        )
      }
      if (action === 'batch-optimize') {
        const engines = Array.isArray(body.engines) ? (body.engines as any) : undefined
        return apiOk(
          await batchOptimizeTranslations({
            contentRoot: body.contentRoot,
            limit: typeof body.limit === 'number' ? body.limit : undefined,
            engines,
            signal: request.signal,
          })
        )
      }
      if (action === 'scan-names') {
        const names = Array.isArray((body as { names?: unknown }).names)
          ? (body as { names: unknown[] }).names.filter((name): name is string => typeof name === 'string' && !!name.trim())
          : undefined
        return apiOk(
          scanNameSentenceSync(body.contentRoot, {
            names,
            renameFrom: typeof (body as { renameFrom?: unknown }).renameFrom === 'string' ? (body as { renameFrom: string }).renameFrom : undefined,
            renameTo: typeof (body as { renameTo?: unknown }).renameTo === 'string' ? (body as { renameTo: string }).renameTo : undefined,
            targetLang: typeof body.targetLang === 'string' ? body.targetLang : undefined,
          })
        )
      }
      if (action === 'apply-names') {
        const names = Array.isArray((body as { names?: unknown }).names)
          ? (body as { names: unknown[] }).names.filter((name): name is string => typeof name === 'string' && !!name.trim())
          : undefined
        return apiOk(
          await applyNameSentenceSync({
            contentRoot: body.contentRoot,
            names,
            renameFrom: typeof (body as { renameFrom?: unknown }).renameFrom === 'string' ? (body as { renameFrom: string }).renameFrom : undefined,
            renameTo: typeof (body as { renameTo?: unknown }).renameTo === 'string' ? (body as { renameTo: string }).renameTo : undefined,
            targetLang: typeof body.targetLang === 'string' ? body.targetLang : undefined,
            limit: typeof body.limit === 'number' ? body.limit : undefined,
            signal: request.signal,
          })
        )
      }
      if (action === 'idle-status') {
        return apiOk(isSystemIdleForOptimization())
      }
      return apiError(400, 'OPTIMIZE_ACTION', 'action must be scan | apply-terms | short-entities | batch-optimize | scan-names | apply-names | idle-status')
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
      if (action === 'resume') {
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        if (!jobId.trim()) return apiError(400, 'SOURCES_JOB_ID', 'Missing jobId')
        return apiOk(resumeSourcesJob(jobId))
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
      return apiError(400, 'SOURCES_ACTION', 'action must be import | status | resume | search | export')
    }

    if (body.mode === 'switches') {
      if (body.switches?.apple === true || body.switches?.bergamot === true) {
        const current = getTranslateEngineSwitches()
        const { getSeedSourceLanguage } = await import('@/services/translate/fill-missing')
        for (const id of ['apple', 'bergamot'] as const) {
          if (body.switches[id] !== true || current.switches[id]) continue
          const translator =
            id === 'apple'
              ? (await import('@/services/translate/lib/macos-translate')).appleTranslator
              : (await import('@/services/translate/lib/bergamot-translate')).bergamotTranslator
          const status = await translator.checkStatus(getSeedSourceLanguage(), 'zh')
          if (!status.installed) return apiError(409, 'TRANSLATE_ENGINE_NOT_READY', status.message || `${id} translation is not ready`)
        }
      }
      const agents = Array.isArray(body.agents) ? body.agents : undefined
      if ((body.switches && typeof body.switches === 'object') || Array.isArray(body.order) || agents || (body.configs && typeof body.configs === 'object')) {
        return apiOk(setTranslateEngineSwitches({ switches: body.switches, order: body.order, agents, configs: body.configs }))
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
      const sourceLang = typeof body.sourceLang === 'string' ? body.sourceLang : undefined
      const targetLang = typeof body.targetLang === 'string' ? body.targetLang : undefined
      const { pollListExtract, requestListExtract } = await import('@/services/extract/list-extract-prepare')
      const poll = body.refresh === true || body.poll === true
      let snap = poll ? pollListExtract(root, { sourceLang, targetLang }) : requestListExtract(root, { sourceLang, targetLang })
      if (snap.preparing && process.env.NODE_ENV === 'test') {
        const { getListExtractFlightForTests } = await import('@/services/extract/list-extract-prepare')
        const flight = getListExtractFlightForTests(root, { sourceLang, targetLang })
        if (flight) {
          await flight
          snap = pollListExtract(root, { sourceLang, targetLang })
        }
      }
      if (snap.preparing) return apiOk({ preparing: true, contentRoot: root })
      if ('error' in snap && snap.error) return apiError(409, 'RGSS_DATA_UNAVAILABLE', snap.error)
      // Worker wrote the full apiOk JSON — stream bytes without JSON.parse on the main thread.
      if ('bodyPath' in snap && snap.bodyPath) {
        const { readFile } = await import('node:fs/promises')
        const buf = await readFile(snap.bodyPath)
        return new Response(buf, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
      }
      if (!('items' in snap) || !snap.items) return apiError(409, 'RGSS_DATA_UNAVAILABLE', 'empty extract result')
      return apiOk({
        preparing: false,
        items: snap.items,
        locales: snap.locales,
        engine: snap.engine ?? null,
        contentRoot: snap.contentRoot,
      })
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
      if (body.contentRoot && !pathEquals(body.contentRoot, root)) return apiError(409, 'GAME_CHANGED', 'Game has changed, please reload the translation list')
      const translations = body.translations && typeof body.translations === 'object' ? body.translations : null
      if (!translations || Array.isArray(translations)) return apiError(400, 'RGSS_WRITE_INPUT', 'Missing translations')
      if (Object.entries(translations).some(([source, target]) => typeof source !== 'string' || typeof target !== 'string')) {
        return apiError(400, 'RGSS_WRITE_INPUT', 'translations must contain only string keys and string values')
      }
      const resolved = resolveGame(root)
      if (!resolved.ok || (resolved.engine !== 'VX Ace' && resolved.engine !== 'VX')) {
        return apiError(400, 'RGSS_WRITE_ENGINE', 'RGSS writeback requires a VX Ace or VX project')
      }
      const { writeRgssTranslations } = await import('@/services/extract/lib/rgss')
      try {
        return apiOk({ engine: resolved.engine, ...writeRgssTranslations(root, translations as Record<string, string>) })
      } catch (error) {
        return apiError(409, 'RGSS_WRITE_FAILED', error instanceof Error ? error.message : String(error))
      }
    }

    if (body.mode === 'rgss-preview') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      if (body.contentRoot && !pathEquals(body.contentRoot, root)) return apiError(409, 'GAME_CHANGED', 'Game has changed, please reload the translation page')
      const { describeRgssPreview, setRgssPreviewView } = await import('@/services/translate/rgss-preview')
      if (body.view === undefined) return apiOk({ contentRoot: root, ...describeRgssPreview(root) })
      if (body.view !== 'original' && body.view !== 'translated') return apiError(400, 'RGSS_PREVIEW_VIEW', 'view must be original or translated')
      const resolved = resolveGame(root)
      if (!resolved.ok || (resolved.engine !== 'VX Ace' && resolved.engine !== 'VX')) {
        return apiError(400, 'RGSS_PREVIEW_ENGINE', 'RGSS preview toggle requires a VX Ace or VX project')
      }
      try {
        return apiOk({ contentRoot: root, engine: resolved.engine, ...setRgssPreviewView(root, body.view) })
      } catch (error) {
        return apiError(409, 'RGSS_PREVIEW_FAILED', error instanceof Error ? error.message : String(error))
      }
    }

    if (body.mode === 'reset-item') {
      const root = game?.ok ? game.contentRoot : resolveTranslateContentRoot()
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text) return apiError(400, 'RESET_ITEM_EMPTY', 'Missing source text')
      const { resetExtractedItem } = await import('@/services/extract/lib/save-items')
      return apiOk(resetExtractedItem(root, text))
    }

    if (body.mode === 'apple-status') {
      const { appleTranslator } = await import('@/services/translate/lib/macos-translate')
      const { getSeedSourceLanguage } = await import('@/services/translate/fill-missing')
      const source = typeof (body.from ?? body.source) === 'string' ? (body.from ?? body.source) : getSeedSourceLanguage(game?.ok ? game.contentRoot : undefined)
      const target = typeof (body.to ?? body.target) === 'string' ? (body.to ?? body.target) : 'zh-Hans'
      return apiOk({ ...(await appleTranslator.checkStatus(source, target)), source, target })
    }

    if (body.mode === 'bergamot' || body.mode === 'bergamot-status') {
      const source = typeof (body.from ?? body.source) === 'string' ? (body.from ?? body.source) : undefined
      const target = typeof (body.to ?? body.target) === 'string' ? (body.to ?? body.target) : undefined
      const { bergamotTranslator } = await import('@/services/translate/lib/bergamot-translate')
      if (body.mode === 'bergamot-status') {
        const { getSeedSourceLanguage } = await import('@/services/translate/fill-missing')
        const from = source || getSeedSourceLanguage(game?.ok ? game.contentRoot : undefined)
        const to = target || 'zh'
        return apiOk({ ...(await bergamotTranslator.checkStatus(from, to)), source: from, target: to })
      }
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
      return apiOk({
        text: await appleTranslate(text, { source: (body.from || body.source || detectSourceLanguage([text])) as string, target: (body.to || body.target || 'zh-Hans') as string }),
      })
    }
    if (body.mode === 'ai') {
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim() || text.length > 20_000) return apiError(400, 'TRANSLATE_AI_INPUT', 'AI translation requires text of 1-20000 characters')
      const { agentJaToZh } = await import('@/services/translate/agent-translate')
      return apiOk({
        text: await agentJaToZh(text, normalizeAiConfig(body.ai), {
          interactive: body.interactive === true,
          signal: request.signal,
          category: typeof body.category === 'string' ? body.category : undefined,
          speaker: typeof body.speaker === 'string' ? body.speaker : undefined,
          context: typeof body.context === 'string' ? body.context : undefined,
        }),
      })
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
      category: typeof body.category === 'string' ? body.category : undefined,
      speaker: typeof body.speaker === 'string' ? body.speaker : undefined,
      context: typeof body.context === 'string' ? body.context : undefined,
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
