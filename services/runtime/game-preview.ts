import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { findRgssSessionByRoomId } from '@/services/game/rgss-runtime'

import { callAgentGame } from './agent-bridge'

export type GamePreview = { mimeType: string; data: string; width: number; height: number }
const previews = new Map<string, { expires: number; result: Promise<GamePreview | null> }>()
const TTL_MS = 180_000

export function clearGamePreviews(): void {
  previews.clear()
}

/** Share one low-frequency capture across tabs and width variants, including failed captures. */
export function captureGamePreview(roomId = 'default', maxWidth = 800): Promise<GamePreview | null> {
  const room = roomId.replace(/:observer$/, '')
  const now = Date.now()
  for (const [key, item] of previews) if (item.expires <= now) previews.delete(key)
  const cached = previews.get(room)
  if (cached) return cached.result
  const width = Number.isFinite(maxWidth) ? Math.min(1280, Math.max(160, Math.round(maxWidth))) : 800
  const result = capture(room, width).catch(() => null)
  previews.set(room, { expires: now + TTL_MS, result })
  while (previews.size > 32) previews.delete(previews.keys().next().value!)
  return result
}

async function capture(roomId: string, maxWidth: number): Promise<GamePreview | null> {
  const rgss = findRgssSessionByRoomId(roomId)
  if (rgss?.session?.logPath) {
    const directory = path.dirname(rgss.session.logPath)
    for (const name of ['current_frame.jpg', 'current_frame.png']) {
      try {
        const file = path.join(directory, name)
        if ((await fs.stat(file)).size > 12 * 1024 * 1024) continue
        const { data, info } = await sharp(await fs.readFile(file), { limitInputPixels: 32_000_000 })
          .resize({ width: maxWidth, withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toBuffer({ resolveWithObject: true })
        if (data.length > 750_000) continue
        return { mimeType: 'image/jpeg', data: data.toString('base64'), width: info.width, height: info.height }
      } catch {
        /* A missing preview is not a reason to poll a nonexistent Web Agent. */
      }
    }
    return null
  }
  const shot = (await callAgentGame(roomId, 'game.snap', { maxWidth }, 3000)) as GamePreview | null
  if (!shot || !/^image\/(?:jpeg|png|webp)$/.test(shot.mimeType) || !shot.data || shot.data.length > 1024 * 1024) return null
  return shot.width > 0 && shot.height > 0 ? shot : null
}
