import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'

import { uniqueOllamaModels } from './ollama-client'
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

type CacheProfile = { id: string; endpoint: string; provider?: string }

/** Ollama lists depend on the endpoint; CLI lists depend on the account, so they are cleared on auth changes instead. */
function cacheKey(profile: CacheProfile) {
  return profile.provider && profile.provider !== 'ollama' ? `${profile.provider}:${profile.id}` : profile.endpoint
}

function writeCache(cache: ModelCache, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
}

export function loadAgentModelCache(profiles: CacheProfile[], file = GAME_AGENT_MODEL_CACHE_PATH): Record<string, OllamaModel[]> {
  const cache = readCache(file)
  return Object.fromEntries(
    profiles.flatMap((profile) => {
      const entry = cache[profile.id]
      return entry?.endpoint === cacheKey(profile) && Array.isArray(entry.models) ? [[profile.id, uniqueOllamaModels(entry.models)]] : []
    })
  )
}

export function saveAgentModelCache(profile: CacheProfile, models: OllamaModel[], file = GAME_AGENT_MODEL_CACHE_PATH) {
  const cache = readCache(file)
  cache[profile.id] = { endpoint: cacheKey(profile), models, updatedAt: Date.now() }
  writeCache(cache, file)
}

export function clearAgentModelCache(profileIds: readonly string[], file = GAME_AGENT_MODEL_CACHE_PATH) {
  const cache = readCache(file)
  const present = profileIds.filter((id) => id in cache)
  if (!present.length) return
  for (const id of present) delete cache[id]
  writeCache(cache, file)
}
