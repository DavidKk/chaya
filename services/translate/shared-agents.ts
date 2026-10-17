/** Share agent translation instances, models, switches and group order across games in data/translate/agents.json. Keep Bing and Google switches in each game. */
import fs from 'node:fs'
import path from 'node:path'

import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { isBuiltinEngineId, normalizeAgentEntries, normalizeEngineOrder, type TranslateAgentEntry, type TranslateEngineId } from '@/lib/translate/engines'

export type SharedTranslateAgents = {
  agents: TranslateAgentEntry[]
  /** Ordering for the agent group only, using agent:<id> keys. */
  order: TranslateEngineId[]
  /** An existing shared file is authoritative, including an empty list, and must not be overwritten by legacy per-game entries. */
  stored: boolean
}

function filePath() {
  return path.join(toolkitDataDir(), 'translate', 'agents.json')
}

function agentOrder(order: unknown, agents: TranslateAgentEntry[]): TranslateEngineId[] {
  return normalizeEngineOrder(order, agents).filter((id) => !isBuiltinEngineId(id))
}

export function readSharedTranslateAgents(): SharedTranslateAgents {
  const file = filePath()
  if (!fs.existsSync(file)) return { agents: [], order: [], stored: false }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { agents?: unknown; order?: unknown }
    const agents = normalizeAgentEntries(raw.agents)
    return { agents, order: agentOrder(raw.order, agents), stored: true }
  } catch {
    return { agents: [], order: [], stored: true }
  }
}

export function writeSharedTranslateAgents(input: { agents?: unknown; order?: unknown } = {}): SharedTranslateAgents {
  const current = readSharedTranslateAgents()
  const agents = input.agents !== undefined ? normalizeAgentEntries(input.agents) : current.agents
  const order = agentOrder(input.order !== undefined ? input.order : current.order, agents)
  const file = filePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ agents, order }, null, 2)}\n`, 'utf8')
  return { agents, order, stored: true }
}
