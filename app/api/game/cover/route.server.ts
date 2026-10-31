import fs from 'node:fs/promises'
import path from 'node:path'

import { defineApiRoute } from '@/initializer/controller'
import { apiOk } from '@/initializer/response'
import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { loadConfig, resolveGame } from '@/services/game'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/game/cover', async () => {
  try {
    const config = loadConfig()
    if (!config.gameRoot) {
      return apiOk({ cover: null })
    }
    const resolved = resolveGame(config.gameRoot)
    if (!resolved.ok || resolved.remote) {
      return apiOk({ cover: null })
    }

    // 1. Search for recent save thumbnails
    const saveDirs = [
      path.join(resolved.contentRoot, 'chaya', 'saves', 'quick'),
      path.join(resolved.contentRoot, 'chaya', 'saves', 'auto'),
      path.join(toolkitDataDir(), 'game-saves', 'quick'),
      path.join(toolkitDataDir(), 'game-saves', 'auto'),
    ]

    for (const dir of saveDirs) {
      try {
        const files = await fs.readdir(dir)
        const thumbFile = files.find((f) => f.endsWith('.jpg') || f.endsWith('.png'))
        if (thumbFile) {
          const buf = await fs.readFile(path.join(dir, thumbFile))
          const mime = thumbFile.endsWith('.png') ? 'image/png' : 'image/jpeg'
          return apiOk({ cover: `data:${mime};base64,${buf.toString('base64')}` })
        }
      } catch {
        /* ignore */
      }
    }

    // 2. Search for game system images or icon
    const imageCandidates = [
      path.join(resolved.contentRoot, 'img', 'system', 'Loading.png'),
      path.join(resolved.contentRoot, 'img', 'titles1', 'Title.png'),
      path.join(resolved.contentRoot, 'img', 'titles1', 'Title1.png'),
      path.join(resolved.contentRoot, 'chaya', 'app-icon.png'),
      path.join(resolved.contentRoot, 'icon', 'icon.png'),
    ]

    for (const file of imageCandidates) {
      try {
        const buf = await fs.readFile(file)
        return apiOk({ cover: `data:image/png;base64,${buf.toString('base64')}` })
      } catch {
        /* ignore */
      }
    }

    return apiOk({ cover: null })
  } catch {
    return apiOk({ cover: null })
  }
})
