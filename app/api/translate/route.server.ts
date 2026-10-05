import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiError, apiOk } from '@/initializer/response'
import { resolveGame } from '@/lib/game'
import { normalizeAiConfig } from '@/lib/translate/engines'
import { hasManagementAccess } from '@/services/access/management'
import {
  fillMissingFromSeed,
  getSeedJobSnapshot,
  getTranslateEngineSwitches,
  liveTranslateTexts,
  pauseSeedJob,
  requireDisk,
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
 * - `{ mode: 'switches' }`：读引擎开关/顺序/Agent 条目；带 `switches` / `order` / `agents` 则写入
 * - `{ mode: 'agents' }`：列出可选的 Agent 实例（名称 / 模型，不含端点与 token）
 * - `{ mode: 'ai', text, ai }`：用选定 Agent 实例翻译一段（插件 AI 引擎走这里，token 不出服务端）
 *
 * 迁移期：整路由属 DiskOps（未拆无盘核心前 vercel 一律 501）。
 */
export const POST = defineApiRoute('post:/api/translate', async ({ request }) => {
  const denied = requireDisk()

  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string
      texts?: string[]
      mode?: 'lookup' | 'live' | 'realtime' | 'ai' | 'agents' | 'play-settings' | 'benchmark' | 'seed' | 'progress' | 'switches' | 'job'
      settings?: unknown
      contentRoot?: string
      action?: 'start' | 'pause'
      limit?: number
      /** 跳过缓存强制重译 */
      force?: boolean
      /** false：只返回译文不落盘（编辑预览） */
      persist?: boolean
      switches?: Partial<TranslateEngineSwitches>
      order?: TranslateEngineId[]
      /** switches：Agent 翻译条目整表替换 */
      agents?: unknown
      /** ai：本次翻译用的实例 / 模型 */
      ai?: unknown
      interactive?: boolean
    }

    // 插件可选共享库查询：不绑定服务端当前游戏，也绝不触发推理或写游戏文件。
    if (body.mode === 'lookup') {
      const texts = body.texts
      if (!Array.isArray(texts) || texts.length > 40 || texts.some((text) => typeof text !== 'string') || texts.join('').length > 20_000) return apiBadLookup()
      if (denied) return apiOk({ available: false, items: [] })
      const { lookupSharedTranslations } = await import('@/services/translate/shared-lookup')
      return apiOk({ available: true, items: lookupSharedTranslations(texts) })
    }
    if (denied) return denied

    if (body.mode === 'play-settings') {
      const contentRoot = resolveTranslateContentRoot()
      if (body.settings !== undefined && body.contentRoot !== contentRoot) return apiError(409, 'GAME_CHANGED', '当前游戏已变化，请重新加载设置')
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
      return apiError(400, 'TRANSLATE_JOB_ACTION', '缺少 action: start | pause')
    }

    if (body.mode === 'switches') {
      const agents = Array.isArray(body.agents) ? body.agents : undefined
      if ((body.switches && typeof body.switches === 'object') || Array.isArray(body.order) || agents) {
        return apiOk(setTranslateEngineSwitches({ switches: body.switches, order: body.order, agents }))
      }
      return apiOk(getTranslateEngineSwitches())
    }

    if (body.mode === 'agents') {
      const { listTranslateAgents } = await import('@/services/translate/agent-translate')
      return apiOk(listTranslateAgents())
    }

    if (body.mode === 'seed') {
      const result = await fillMissingFromSeed({ limit: body.limit })
      return apiOk(result)
    }

    const texts = Array.isArray(body.texts) ? body.texts : body.text != null ? [body.text] : []
    if (!texts.length) {
      return apiError(400, 'TRANSLATE_EMPTY', '缺少 text / texts')
    }

    const session = !hasManagementAccess(request) ? peekLaunchToken(request.headers.get('x-chaya-launch-token')) : null
    const game = session ? resolveGame(session.gameRoot) : null
    if (session && (!game?.ok || game.remote)) return apiError(400, 'GAME_UNAVAILABLE', '游戏路径不可用')
    if (body.mode === 'ai') {
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim() || text.length > 20_000) return apiError(400, 'TRANSLATE_AI_INPUT', 'AI 翻译需要 1–20000 字的 text')
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
    })
    const okCount = items.filter((i) => i.zh).length
    return apiOk({ items, translated: okCount, total: items.length, contentRoot, engines }, { headers: { 'Access-Control-Allow-Origin': '*' } })
  } catch (err) {
    return apiError(500, 'TRANSLATE_FAILED', err instanceof Error ? err.message : String(err))
  }
})

export type { TranslateEngineId }

function apiBadLookup() {
  return apiError(400, 'TRANSLATE_LOOKUP_INPUT', '翻译库查询最多 40 段、20000 字')
}
