/**
 * 翻译引擎开关与补译顺序（游戏内容根 `*-trans.switches.json`）。
 * Web 与 CLI 共用；默认 Ollama → Bing → Google，三引擎全开。
 */
import fs from 'node:fs'

import { ensureGameContentDir, gameContentPath, gameContentReadPath } from '@/lib/game/content-files'
import { getResolvedFromConfig } from '@/services/game/binding'

export const TRANSLATE_ENGINE_IDS = ['ollama', 'bing', 'google'] as const
export type TranslateEngineId = (typeof TRANSLATE_ENGINE_IDS)[number]

export type TranslateEngineSwitches = Record<TranslateEngineId, boolean>

export const DEFAULT_ENGINE_ORDER: TranslateEngineId[] = [...TRANSLATE_ENGINE_IDS]

export const DEFAULT_ENGINE_SWITCHES: TranslateEngineSwitches = {
  ollama: true,
  bing: true,
  google: true,
}

export const TRANSLATE_ENGINE_META: Record<TranslateEngineId, { label: string; desc: string }> = {
  ollama: { label: 'Ollama', desc: '本机模型' },
  bing: { label: 'Bing', desc: '公网微软翻译（可选依赖）' },
  google: { label: 'Google', desc: '公网 gtx' },
}

function isEngineId(v: unknown): v is TranslateEngineId {
  return v === 'ollama' || v === 'bing' || v === 'google'
}

function normalizeSwitches(raw: unknown): TranslateEngineSwitches {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    google: src.google !== false,
    bing: src.bing !== false,
    ollama: src.ollama !== false,
  }
}

/** 规范化顺序：只保留合法 id，缺的按默认补到末尾 */
export function normalizeEngineOrder(raw: unknown): TranslateEngineId[] {
  const seen = new Set<TranslateEngineId>()
  const out: TranslateEngineId[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isEngineId(item) || seen.has(item)) continue
      seen.add(item)
      out.push(item)
    }
  }
  for (const id of DEFAULT_ENGINE_ORDER) {
    if (seen.has(id)) continue
    out.push(id)
  }
  return out
}

function resolveContentRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('请先在游戏库绑定本地游戏')
  if (resolved.remote) throw new Error('远程游戏请在本机绑定后配置翻译引擎')
  return resolved.contentRoot
}

export type EngineSwitchesState = {
  contentRoot: string
  file: string
  switches: TranslateEngineSwitches
  order: TranslateEngineId[]
  /** 按 order 过滤后的已开启引擎（补译尝试顺序） */
  enabled: TranslateEngineId[]
}

function toState(contentRoot: string, file: string, switches: TranslateEngineSwitches, order: TranslateEngineId[]): EngineSwitchesState {
  return {
    contentRoot,
    file,
    switches,
    order,
    enabled: order.filter((id) => switches[id]),
  }
}

function writeState(contentRoot: string, switches: TranslateEngineSwitches, order: TranslateEngineId[]): EngineSwitchesState {
  const file = ensureGameContentDir(contentRoot, 'switches')
  const body = {
    ...switches,
    order,
  }
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  return toState(contentRoot, file, switches, order)
}

/** 读取当前绑定游戏的引擎开关与顺序；无文件时返回默认。 */
export function getTranslateEngineSwitches(contentRoot = resolveContentRoot()): EngineSwitchesState {
  const existing = gameContentReadPath(contentRoot, 'switches', { alsoParent: true })
  const file = existing || gameContentPath(contentRoot, 'switches')
  if (!existing || !fs.existsSync(existing)) {
    return toState(contentRoot, file, { ...DEFAULT_ENGINE_SWITCHES }, [...DEFAULT_ENGINE_ORDER])
  }
  try {
    const raw = JSON.parse(fs.readFileSync(existing, 'utf8')) as unknown
    return toState(contentRoot, existing, normalizeSwitches(raw), normalizeEngineOrder((raw as { order?: unknown })?.order))
  } catch {
    return toState(contentRoot, existing, { ...DEFAULT_ENGINE_SWITCHES }, [...DEFAULT_ENGINE_ORDER])
  }
}

export type SetEngineSwitchesInput = {
  switches?: Partial<TranslateEngineSwitches>
  order?: TranslateEngineId[]
}

/** 合并写入引擎开关与/或顺序；至少保留一个开启。 */
export function setTranslateEngineSwitches(input: SetEngineSwitchesInput | Partial<TranslateEngineSwitches>): EngineSwitchesState {
  const current = getTranslateEngineSwitches()
  const hasNested = input && typeof input === 'object' && ('switches' in input || 'order' in input)
  const partialSwitches = hasNested ? ((input as SetEngineSwitchesInput).switches ?? {}) : (input as Partial<TranslateEngineSwitches>)
  const nextOrder = hasNested && (input as SetEngineSwitchesInput).order ? normalizeEngineOrder((input as SetEngineSwitchesInput).order) : current.order
  const nextSwitches = normalizeSwitches({ ...current.switches, ...partialSwitches })
  if (!TRANSLATE_ENGINE_IDS.some((id) => nextSwitches[id])) {
    throw new Error('至少开启一个翻译平台')
  }
  return writeState(current.contentRoot, nextSwitches, nextOrder)
}
