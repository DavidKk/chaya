import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'

import type { OllamaModel } from './types'

type ModelCacheEntry = {
  endpoint: string
  models: OllamaModel[]
  updatedAt: number
}

type ModelCache = Record<string, ModelCacheEntry>

export const GAME_AGENT_MODEL_CACHE_PATH = path.join(DATA_DIR, 'game-agent', 'models.json')

function readCache(file = GAME_AGENT_MODEL_CACHE_PATH): ModelCache {
  try {
    if (!fs.existsSync(file)) return {}
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ModelCache
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function loadAgentModelCache(profiles: Array<{ id: string; endpoint: string }>, file = GAME_AGENT_MODEL_CACHE_PATH): Record<string, OllamaModel[]> {
  const cache = readCache(file)
  return Object.fromEntries(
    profiles.flatMap((profile) => {
      const entry = cache[profile.id]
      return entry?.endpoint === profile.endpoint && Array.isArray(entry.models) ? [[profile.id, entry.models]] : []
    })
  )
}

export function saveAgentModelCache(profile: { id: string; endpoint: string }, models: OllamaModel[], file = GAME_AGENT_MODEL_CACHE_PATH) {
  const cache = readCache(file)
  cache[profile.id] = { endpoint: profile.endpoint, models, updatedAt: Date.now() }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}
