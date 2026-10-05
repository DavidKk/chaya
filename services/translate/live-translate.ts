/**
 * 服务内日→中实时翻译，按引擎开关选用 Google / Bing / Ollama / AI Agent。
 * 供插件 miss 回填与翻译页补齐使用。
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

import { ensureGameContentDir } from '@/lib/game/content-files'
import { peelChoiceMetaTrail } from '@/lib/translate/choice-meta'
import { requestGoogle } from '@/lib/translate/engine-http'
import { engineAcceptsSensitive, engineSourceTag, findAgentEntry, type TranslateAgentEntry, type TranslateRunEngine } from '@/lib/translate/engines'
import { hasRmDigitCodes, toRmDigitTemplate } from '@/lib/translate/rm-escape'
import { getResolvedFromConfig } from '@/services/game/binding'

import { agentJaToZh } from './agent-translate'
import { lookupGameTranslation } from './cache-lookup'
import { DEFAULT_ENGINE_SWITCHES, getTranslateEngineSwitches, TRANSLATE_ENGINE_IDS } from './engine-switches'
import { loadGameTranslateLookup, normalizeTranslateKey } from './game-lookup'
import { type LocalTranslateOptions, ollamaJaToZh } from './ollama-translate'
import { isSensitiveForCloud } from './sensitive-text'
import { openSharedCache } from './shared-cache'
import { isStorableTranslation, isUsefulTranslation, peelProtectShell, protectForTranslate, restoreForTranslate, shouldTranslate, translationCoreForCache } from './text-classify'

const require = createRequire(import.meta.url)
const MAX_BATCH = 40

export { type LocalTranslateOptions, ollamaJaToZh }

export async function googleJaToZh(text: string): Promise<string> {
  const q = String(text ?? '')
  if (!q.trim()) return q
  return requestGoogle(fetch, q, AbortSignal.timeout(30_000))
}

async function bingJaToZh(text: string): Promise<string> {
  // 可选依赖：用拼接包名避免 bundler 静态解析；未安装时明确报错
  const pkg = ['bing', 'translate', 'api'].join('-')
  let translate: ((...args: unknown[]) => Promise<{ translation?: string }>) | undefined
  try {
    translate = require(pkg).translate as (...args: unknown[]) => Promise<{ translation?: string }>
  } catch {
    throw new Error('未安装 bing-translate-api（可选依赖），请关闭 Bing 或安装该包')
  }
  const res = await translate(text, 'ja', 'zh-Hans', false, false)
  if (!res?.translation) throw new Error('empty translation')
  return res.translation
}

async function translateWithEngine(engine: TranslateRunEngine, text: string, options: LocalTranslateOptions | undefined, agents: TranslateAgentEntry[]): Promise<string> {
  if (engine === 'google') return googleJaToZh(text)
  if (engine === 'bing') return bingJaToZh(text)
  if (engine === 'ollama') return ollamaJaToZh(text, options)
  const entry = findAgentEntry(agents, engine)
  if (!entry) throw new Error('Agent 翻译条目已移除')
  return agentJaToZh(text, entry, { interactive: options?.interactive, signal: options?.signal })
}

function appendGameNdjson(contentRoot: string, pairs: Array<[string, string]>) {
  const valid = pairs.filter(([src, zh]) => isStorableTranslation(src, zh))
  if (!valid.length) return
  const file = ensureGameContentDir(contentRoot, 'cacheNdjson')
  const lines = valid.map(([s, t]) => JSON.stringify([s, t])).join('\n') + '\n'
  fs.appendFileSync(file, lines, 'utf8')
}

function resolveBoundContentRoot(): string | null {
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
}

/** 翻译一批原文；优先复用本作译文，再查共享库，最后按开关启用的引擎翻译并落盘。
 * `force: true` 跳过查表，强制走引擎重译（缓存页「重新翻译」）。
 * `persist: false` 只返回译文，不写入共享库 / 本地（编辑弹窗预览）。
 */
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
      /* 未绑定游戏时走默认开关与顺序 */
      engines = TRANSLATE_ENGINE_IDS.filter((id) => DEFAULT_ENGINE_SWITCHES[id])
    }
  }
  if (!engines.length) {
    return {
      items: unique.map((src) => ({ src, zh: null, error: '未开启任何翻译平台' })),
      contentRoot,
      engines: [],
    }
  }

  const cache = openSharedCache()
  const items: LiveTranslateItem[] = []
  const toWrite: Array<[string, string]> = []
  /** 本作译文优先；共享库只补本作未收录的文本。 */
  const localLookup = contentRoot ? loadGameTranslateLookup(contentRoot) : null

  function lookupLocal(src: string): string | null {
    if (!localLookup) return null
    if (Object.prototype.hasOwnProperty.call(localLookup, src)) return localLookup[src] ?? null
    const norm = normalizeTranslateKey(src)
    if (norm !== src && Object.prototype.hasOwnProperty.call(localLookup, norm)) return localLookup[norm] ?? null
    return null
  }

  /** 查表时剥 if/en，避免命中「如果/启用」毒化整句；回写仍用完整 src。 */
  function lookupCached(src: string): { zh: string; engine: 'cache:remote' | 'cache:local' } | null {
    return lookupGameTranslation(lookupLocal, (key) => cache.get(key), src)
  }

  const force = Boolean(opts?.force)
  const persist = opts?.persist !== false

  try {
    for (const src of unique) {
      opts?.local?.signal?.throwIfAborted()
      const { core: labelCore } = peelChoiceMetaTrail(src)
      if (!force) {
        const cached = lookupCached(src)
        if (cached != null) {
          items.push({ src, zh: cached.zh, engine: cached.engine })
          /* 反哺本游戏本地（完整句 + 标题）；原文=译文跳过 */
          if (persist) {
            if (lookupLocal(src) == null && isStorableTranslation(src, cached.zh)) toWrite.push([src, cached.zh])
            if (labelCore && labelCore !== src) {
              const labelZh = peelChoiceMetaTrail(cached.zh).core || cached.zh
              if (lookupLocal(labelCore) == null && isStorableTranslation(labelCore, labelZh)) {
                toWrite.push([labelCore, labelZh])
              }
            }
          }
          continue
        }
      }
      if (!shouldTranslate(labelCore || src)) {
        /* 纯控制码 / 无假名：原样返回，不入库（原文=译文无意义） */
        items.push({ src, zh: src, engine: 'skip' })
        continue
      }

      const guard = protectForTranslate(src)
      const sendText = guard.plain.trim() ? guard.plain : src
      const sensitive = isSensitiveForCloud(sendText)
      /** 敏感句不送公网平台，只走 Agent 组；未开则本条软跳过，不挡同批其他条 */
      const tryEngines = sensitive ? engines.filter(engineAcceptsSensitive) : engines
      if (sensitive && !tryEngines.length) {
        items.push({ src, zh: null, engine: 'skip:sensitive', error: '此文本需要开启 Agent 翻译' })
        continue
      }

      /* 3) 远程翻译 → 4) 双写远程 + 本地（只存剥壳正文，壳留给局内切段拼回） */
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
            /* `\n[1]` 与 `\n[3]` 共用模板键，查表时再还原具体数字码 */
            if (hasRmDigitCodes(key)) {
              const tplKey = toRmDigitTemplate(key)
              const tplZh = toRmDigitTemplate(value)
              if (tplKey !== key && isStorableTranslation(tplKey, tplZh)) {
                pairs.push([tplKey, tplZh])
              }
            }
          }
          /* 入库键用剥掉首尾 `\C[n]` 的正文；局内返回值仍带壳，便于当帧精确替换 */
          pushPair(guard.core || sendText, zhCore)
          if (labelCore && labelCore !== src && guard.plain.trim()) {
            const labelKey = peelProtectShell(labelCore).core || labelCore
            pushPair(labelKey, zhCore)
          }
          if (pairs.length && persist) {
            cache.upsertMany(pairs, tag)
            toWrite.push(...pairs)
          }
          items.push({ src, zh, engine: tag })
          done = true
          break
        } catch (err) {
          errors.push(`${engine}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (!done) {
        items.push({ src, zh: null, error: errors.join('；') || '翻译失败' })
      }
    }
  } finally {
    cache.close()
    // 后续选项超时/取消时，保留本批已经成功翻译的台词。
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
