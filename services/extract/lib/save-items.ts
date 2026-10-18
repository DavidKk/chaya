import fs from 'node:fs'

import { ensureGameContentDir, gameContentReadPath } from '@/lib/game/content-files'
import { appendGameNdjson } from '@/services/translate/live-translate'

export function saveExtractedItem(contentRoot: string, src: string, zh: string): { ok: boolean } {
  // 1. Update seed.json if present
  const seedPath = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (seedPath && fs.existsSync(seedPath)) {
    try {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
      seed[src] = zh
      fs.writeFileSync(seedPath, JSON.stringify(seed) + '\n', 'utf8')
    } catch (e) {
      console.warn('[save-items] Failed to update seed.json:', e)
    }
  }

  // 2. Append to cache.ndjson
  appendGameNdjson(contentRoot, [[src, zh]])

  return { ok: true }
}

export function resetExtractedItem(contentRoot: string, src: string): { ok: boolean } {
  // 1. Reset in seed.json
  const seedPath = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (seedPath && fs.existsSync(seedPath)) {
    try {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
      if (src in seed) {
        seed[src] = ''
        fs.writeFileSync(seedPath, JSON.stringify(seed) + '\n', 'utf8')
      }
    } catch (e) {
      console.warn('[save-items] Failed to reset seed.json:', e)
    }
  }

  // 2. Append tombstone / empty string to cache.ndjson
  const file = ensureGameContentDir(contentRoot, 'cacheNdjson')
  try {
    fs.appendFileSync(file, JSON.stringify({ s: src, t: null, at: Date.now(), engine: 'reset' }) + '\n')
  } catch (e) {
    console.warn('[save-items] Failed to write cache.ndjson reset record:', e)
  }

  return { ok: true }
}
