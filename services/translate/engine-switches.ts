/** Translation engine switches and fill order. Store Bing and Google settings in each game's *-trans.switches.json; share agent entries across games in data/translate/agents.json. */
import fs from 'node:fs'
import path from 'node:path'

import { ensureGameContentDir, gameContentPath, gameContentReadPath } from '@/lib/game/content-files'
import { toolkitDataDir } from '@/lib/game/toolkit-data'
import {
  assignMissingEngineEntryIds,
  DEFAULT_ENGINE_ORDER,
  DEFAULT_ENGINE_SETTINGS,
  DEFAULT_ENGINE_SWITCHES,
  isBuiltinEngineId,
  mergeEngineState,
  type TranslateBuiltinId,
  type TranslateEngineId,
  type TranslateEnginePatch,
  type TranslateEngineSettings,
  type TranslateEngineState,
  type TranslateEngineSwitches,
} from '@/lib/translate/engines'
import { getResolvedFromConfig } from '@/services/game/binding'
import { writePublicGameDocument } from '@/services/storage/game-files'

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
  bergamot: { label: 'Bergamot', desc: '跨平台本地离线工具翻译（需安装语言包）' },
} as const

function resolveContentRoot(required = true): string {
  try {
    const resolved = getResolvedFromConfig()
    if (!resolved.ok) {
      if (!required) return ''
      throw new Error('Please bind a local game in the game library first')
    }
    if (resolved.remote) {
      if (!required) return ''
      throw new Error('Remote games must be bound locally before configuring translation engines')
    }
    return resolved.contentRoot
  } catch (err) {
    if (!required) return ''
    throw err
  }
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

function sharedSwitchesFile() {
  return path.join(toolkitDataDir(), 'translate', 'switches.json')
}

function readSharedSwitches(): { switches?: Partial<TranslateEngineSwitches>; configs?: Record<TranslateBuiltinId, TranslateEngineSettings>; order?: TranslateEngineId[] } | null {
  const file = sharedSwitchesFile()
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeSharedSwitches(data: { switches?: Partial<TranslateEngineSwitches>; configs?: Record<TranslateBuiltinId, TranslateEngineSettings>; order?: TranslateEngineId[] }) {
  const file = sharedSwitchesFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/** Combine per-game platform switches with shared agent entries. Migrate legacy per-game agents only when the shared file does not exist. */
function withEntryIds(contentRoot: string, state: TranslateEngineState): TranslateEngineState {
  const assigned = assignMissingEngineEntryIds(state.configs)
  const next = assigned.changed ? { ...state, configs: assigned.configs } : state
  if (assigned.changed && contentRoot) writePlatformFile(contentRoot, next)
  return next
}

function combine(contentRoot: string, raw: unknown): TranslateEngineState {
  const local = mergeEngineState(raw)
  let shared = readSharedTranslateAgents()
  if (!shared.stored && local.agents.length) {
    shared = writeSharedTranslateAgents({ agents: local.agents, order: local.order })
    writePlatformFile(contentRoot, local)
  }
  const combined = mergeEngineState({
    ...local.switches,
    configs: local.configs,
    agents: shared.agents,
    order: [...shared.order, ...platformOrder(local.order)],
  })
  return withEntryIds(contentRoot, combined)
}

function writePlatformFile(contentRoot: string, state: TranslateEngineState) {
  const file = ensureGameContentDir(contentRoot, 'switches')
  writePublicGameDocument(contentRoot, 'switches', { ...state.switches, order: platformOrder(state.order), configs: state.configs })
  return file
}

/** Read engine switches and order for the bound game, using defaults when no file exists. */
export function getTranslateEngineSwitches(contentRoot = resolveContentRoot(false)): EngineSwitchesState {
  if (!contentRoot) {
    const sharedAgents = readSharedTranslateAgents() || { agents: [], order: [] }
    const sharedSwitches = readSharedSwitches()
    const initialConfigs = sharedSwitches?.configs || {
      ...DEFAULT_ENGINE_SETTINGS,
      bergamot: { ...DEFAULT_ENGINE_SETTINGS.bergamot, id: 'mvsd812nzmca' },
    }
    const combined = mergeEngineState({
      ...DEFAULT_ENGINE_SWITCHES,
      ...(sharedSwitches?.switches || {}),
      configs: initialConfigs,
      agents: sharedAgents.agents,
      order: sharedSwitches?.order || [...sharedAgents.order, ...DEFAULT_ENGINE_ORDER],
    })
    const assigned = assignMissingEngineEntryIds(combined.configs)
    if (assigned.changed || !sharedSwitches) {
      writeSharedSwitches({
        switches: combined.switches,
        configs: assigned.configs,
        order: platformOrder(combined.order),
      })
    }
    return { contentRoot: '', file: '', ...combined, configs: assigned.configs }
  }
  const { raw } = readRaw(contentRoot)
  const state = combine(contentRoot, raw)
  return { contentRoot, file: gameContentPath(contentRoot, 'switches'), ...state }
}

export type SetEngineSwitchesInput = TranslateEnginePatch

export function setTranslateEngineSwitches(input: SetEngineSwitchesInput, targetContentRoot?: string): EngineSwitchesState {
  const contentRoot = targetContentRoot || resolveContentRoot(false)
  if (!contentRoot) {
    const sharedAgents = readSharedTranslateAgents() || { agents: [], order: [] }
    const sharedSwitches = readSharedSwitches()
    const initialConfigs = sharedSwitches?.configs || {
      ...DEFAULT_ENGINE_SETTINGS,
      bergamot: { ...DEFAULT_ENGINE_SETTINGS.bergamot, id: 'mvsd812nzmca' },
    }
    const base = mergeEngineState({
      ...DEFAULT_ENGINE_SWITCHES,
      ...(sharedSwitches?.switches || {}),
      configs: initialConfigs,
      agents: sharedAgents.agents,
      order: sharedSwitches?.order || [...sharedAgents.order, ...DEFAULT_ENGINE_ORDER],
    })
    const state = withEntryIds('', mergeEngineState(base, input))
    writeSharedTranslateAgents({ agents: state.agents, order: state.order })
    writeSharedSwitches({
      switches: state.switches,
      configs: state.configs,
      order: platformOrder(state.order),
    })
    return { contentRoot: '', file: '', ...state }
  }
  const { raw } = readRaw(contentRoot)
  const state = withEntryIds(contentRoot, mergeEngineState(combine(contentRoot, raw), input))
  writeSharedTranslateAgents({ agents: state.agents, order: state.order })
  const file = writePlatformFile(contentRoot, state)
  return { contentRoot, file, ...state }
}
