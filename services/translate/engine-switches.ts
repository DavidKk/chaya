/** Translation engine switches and fill order. Store Bing and Google settings in each game's *-trans.switches.json; share agent entries across games in data/translate/agents.json. */
import fs from 'node:fs'

import { ensureGameContentDir, gameContentPath, gameContentReadPath } from '@/lib/game/content-files'
import { isBuiltinEngineId, mergeEngineState, type TranslateEngineId, type TranslateEnginePatch, type TranslateEngineState } from '@/lib/translate/engines'
import { getResolvedFromConfig } from '@/services/game/binding'

import { readSharedTranslateAgents, writeSharedTranslateAgents } from './shared-agents'

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
  apple: { label: 'Apple', desc: 'macOS 系统原生离线神经翻译（需离线语言包）' },
} as const

function resolveContentRoot(): string {
  const resolved = getResolvedFromConfig()
  if (!resolved.ok) throw new Error('Please bind a local game in the game library first')
  if (resolved.remote) throw new Error('Remote games must be bound locally before configuring translation engines')
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

function platformOrder(order: TranslateEngineId[]): TranslateEngineId[] {
  return order.filter((id) => isBuiltinEngineId(id))
}

/** Combine per-game platform switches with shared agent entries. Migrate legacy per-game agents only when the shared file does not exist. */
function combine(contentRoot: string, raw: unknown): TranslateEngineState {
  const local = mergeEngineState(raw)
  let shared = readSharedTranslateAgents()
  if (!shared.stored && local.agents.length) {
    shared = writeSharedTranslateAgents({ agents: local.agents, order: local.order })
    writePlatformFile(contentRoot, local)
  }
  return mergeEngineState({
    ...local.switches,
    agents: shared.agents,
    order: [...shared.order, ...platformOrder(local.order)],
  })
}

function writePlatformFile(contentRoot: string, state: TranslateEngineState) {
  const file = ensureGameContentDir(contentRoot, 'switches')
  fs.writeFileSync(file, `${JSON.stringify({ ...state.switches, order: platformOrder(state.order) }, null, 2)}\n`, 'utf8')
  return file
}

/** Read engine switches and order for the bound game, using defaults when no file exists. */
export function getTranslateEngineSwitches(contentRoot = resolveContentRoot()): EngineSwitchesState {
  const { file, raw } = readRaw(contentRoot)
  return { contentRoot, file, ...combine(contentRoot, raw) }
}

export type SetEngineSwitchesInput = TranslateEnginePatch

/** Merge engine switches, order and agents; all engines may be disabled, with validation deferred until a fill job starts. */
export function setTranslateEngineSwitches(input: SetEngineSwitchesInput): EngineSwitchesState {
  const contentRoot = resolveContentRoot()
  const { raw } = readRaw(contentRoot)
  const state = mergeEngineState(combine(contentRoot, raw), input)
  writeSharedTranslateAgents({ agents: state.agents, order: state.order })
  const file = writePlatformFile(contentRoot, state)
  return { contentRoot, file, ...state }
}
