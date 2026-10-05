/**
 * 翻译引擎开关、补译顺序与 Agent 翻译条目（游戏内容根 `*-trans.switches.json`）。
 * Web 与 CLI 共用；引擎定义见 `lib/translate/engines.ts`。
 */
import fs from 'node:fs'

import { ensureGameContentDir, gameContentPath, gameContentReadPath } from '@/lib/game/content-files'
import { engineStateFileBody, mergeEngineState, type TranslateEnginePatch, type TranslateEngineState } from '@/lib/translate/engines'
import { getResolvedFromConfig } from '@/services/game/binding'

export {
  DEFAULT_ENGINE_ORDER,
  DEFAULT_ENGINE_SWITCHES,
  normalizeEngineOrder,
  TRANSLATE_ENGINE_IDS,
  type TranslateAgentEntry,
  type TranslateEngineId,
  type TranslateEngineSwitches,
} from '@/lib/translate/engines'

export const TRANSLATE_ENGINE_META = {
  bing: { label: 'Bing', desc: '公网微软翻译（可选依赖）' },
  google: { label: 'Google', desc: '公网 gtx' },
} as const

function resolveContentRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('请先在游戏库绑定本地游戏')
  if (resolved.remote) throw new Error('远程游戏请在本机绑定后配置翻译引擎')
  return resolved.contentRoot
}

export type EngineSwitchesState = TranslateEngineState & {
  contentRoot: string
  file: string
}

function readRaw(contentRoot: string): { file: string; raw: unknown } {
  const existing = gameContentReadPath(contentRoot, 'switches', { alsoParent: true })
  const file = existing || gameContentPath(contentRoot, 'switches')
  if (!existing || !fs.existsSync(existing)) return { file, raw: null }
  try {
    return { file, raw: JSON.parse(fs.readFileSync(existing, 'utf8')) as unknown }
  } catch {
    return { file, raw: null }
  }
}

/** 读取当前绑定游戏的引擎开关与顺序；无文件时返回默认。 */
export function getTranslateEngineSwitches(contentRoot = resolveContentRoot()): EngineSwitchesState {
  const { file, raw } = readRaw(contentRoot)
  return { contentRoot, file, ...mergeEngineState(raw) }
}

export type SetEngineSwitchesInput = TranslateEnginePatch

/** 合并写入引擎开关 / 顺序 / Agent 条目；允许全部关闭（补译任务启动时再拦）。 */
export function setTranslateEngineSwitches(input: SetEngineSwitchesInput): EngineSwitchesState {
  const contentRoot = resolveContentRoot()
  const { raw } = readRaw(contentRoot)
  const state = mergeEngineState(raw, input)
  const file = ensureGameContentDir(contentRoot, 'switches')
  fs.writeFileSync(file, `${JSON.stringify(engineStateFileBody(state), null, 2)}\n`, 'utf8')
  return { contentRoot, file, ...state }
}
