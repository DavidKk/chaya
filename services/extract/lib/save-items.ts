import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { appendPublicGameCache, writePublicGameDocument } from '@/services/storage/game-files'
import { writeSeedFailure } from '@/services/translate/seed-failures'

export function saveExtractedItem(contentRoot: string, src: string, zh: string): { ok: boolean } {
  const seedPath = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (seedPath && fs.existsSync(seedPath)) {
    try {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
      seed[src] = zh
      fs.writeFileSync(seedPath, JSON.stringify(seed) + '\n', 'utf8')
      try {
        writePublicGameDocument(contentRoot, 'seed', seed)
      } catch {}
    } catch (e) {
      console.warn('[save-items] Failed to update seed.json:', e)
    }
  }
  appendPublicGameCache(contentRoot, [{ s: src, t: zh, engine: 'manual', at: Date.now() }])
  if (zh.trim()) writeSeedFailure(contentRoot, src, null)
  return { ok: true }
}

export function resetExtractedItem(contentRoot: string, src: string): { ok: boolean } {
  const seedPath = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (seedPath && fs.existsSync(seedPath)) {
    try {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
      if (src in seed) {
        seed[src] = ''
        fs.writeFileSync(seedPath, JSON.stringify(seed) + '\n', 'utf8')
        try {
          writePublicGameDocument(contentRoot, 'seed', seed)
        } catch {}
      }
    } catch (e) {
      console.warn('[save-items] Failed to reset seed.json:', e)
    }
  }
  appendPublicGameCache(contentRoot, [{ s: src, t: null, engine: 'reset', at: Date.now() }])
  return { ok: true }
}
