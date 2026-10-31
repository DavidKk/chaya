import fs from 'node:fs'
import path from 'node:path'

import { GAME_AGENT_DIR } from '@/constants/paths'

export type CompanionResourcePolicy = {
  capacity: number
  maxRunningPerInstance: number
  maxQueuedPerInstance: number
}

export const COMPANION_RESOURCE_SETTINGS_PATH = path.join(GAME_AGENT_DIR, 'companion-resources.json')

const bounded = (value: unknown, fallback: number, max: number) => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback)

/** Owner-managed resource settings, never supplied by an individual inference request. */
export function readCompanionResourcePolicy(resourceKey: string): CompanionResourcePolicy {
  let value: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(COMPANION_RESOURCE_SETTINGS_PATH, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entry = (parsed as { resources?: Record<string, unknown> }).resources?.[resourceKey]
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) value = entry as Record<string, unknown>
    }
  } catch {
    // Missing or invalid configuration uses the conservative single-slot policy.
  }
  const capacity = bounded(value.capacity, 1, 8)
  return {
    capacity,
    maxRunningPerInstance: Math.min(capacity, bounded(value.maxRunningPerInstance, capacity, 8)),
    maxQueuedPerInstance: bounded(value.maxQueuedPerInstance, 4, 16),
  }
}
