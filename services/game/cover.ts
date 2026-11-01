import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { resolveGame } from '@/lib/game'
import { readOfflineGameSaves, readOfflineSaveThumbnail } from '@/services/game-saves/offline-list'

import { loadConfig } from './config'
import { pathEquals } from './library'

const ENCRYPTED_HEADER = Buffer.from('5250474d560000000003010000000000', 'hex')
const cache = new Map<string, { value: string | null; expires: number }>()
const pending = new Map<string, Promise<string | null>>()
const CACHE_BYTES = 16 * 1024 * 1024

async function containedFile(file: string, root: string): Promise<string | null> {
  const [realFile, realRoot] = await Promise.all([fs.realpath(file), fs.realpath(root)])
  return realFile.startsWith(`${realRoot}${path.sep}`) ? realFile : null
}

async function imageData(file: string, contentRoot: string, keyHex?: string): Promise<string | null> {
  try {
    const realFile = await containedFile(file, contentRoot)
    if (!realFile || (await fs.stat(realFile)).size > 12 * 1024 * 1024) return null
    let buf = await fs.readFile(realFile)
    if (file.endsWith('.rpgmvp') || file.endsWith('.png_')) {
      if (!keyHex || !/^[a-f0-9]{32}$/i.test(keyHex) || buf.length <= 32 || !buf.subarray(0, 16).equals(ENCRYPTED_HEADER)) return null
      const key = Buffer.from(keyHex, 'hex')
      buf = Buffer.from(buf.subarray(16))
      for (let i = 0; i < 16; i++) {
        buf[i] ^= key[i]
      }
    }
    const image = await sharp(buf, { limitInputPixels: 32_000_000 })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer()
    return `data:image/jpeg;base64,${image.toString('base64')}`
  } catch {
    return null
  }
}

/** Resolve static artwork for a trusted library id without starting or capturing a game. */
export async function readGameCover(gameId?: string): Promise<string | null> {
  const config = loadConfig()
  const entry = gameId ? config.library.find((item) => item.id === gameId) : config.library.find((item) => pathEquals(item.gameRoot, config.gameRoot))
  // An unknown id must never fall back to the host's selected game.
  if (!entry || entry.remote) return null
  const resolved = resolveGame(entry.gameRoot)
  if (!resolved.ok || resolved.remote) return null
  const root = resolved.contentRoot
  const key = JSON.stringify([entry.id, root])
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  const inflight = pending.get(key)
  if (inflight) return inflight
  const task = resolveCover(root, entry.id)
    .catch(() => null)
    .then((value) => {
      cache.delete(key)
      cache.set(key, { value, expires: Date.now() + (value ? 180_000 : 30_000) })
      let bytes = Array.from(cache.values()).reduce((sum, item) => sum + (item.value?.length || 0) * 2, 0)
      while (cache.size > 32 || bytes > CACHE_BYTES) {
        const oldest = cache.keys().next().value!
        bytes -= (cache.get(oldest)?.value?.length || 0) * 2
        cache.delete(oldest)
      }
      return value
    })
    .finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}

async function resolveCover(root: string, gameId: string): Promise<string | null> {
  const candidates: string[] = []
  try {
    const systemFile = await containedFile(path.join(root, 'data', 'System.json'), root)
    if (!systemFile || (await fs.stat(systemFile)).size > 1024 * 1024) throw new Error('Invalid game system file')
    const system = JSON.parse(await fs.readFile(systemFile, 'utf8')) as {
      title1Name?: unknown
      title2Name?: unknown
      hasEncryptedImages?: boolean
      encryptionKey?: string
    }
    const key = typeof system.encryptionKey === 'string' && system.encryptionKey.trim() ? system.encryptionKey.trim() : undefined
    for (const [folder, name] of [
      ['titles1', system.title1Name],
      ['titles2', system.title2Name],
    ]) {
      if (typeof name === 'string' && name.trim()) {
        const base = path.join('img', folder as string, `${name}`)
        const plain = await imageData(path.resolve(root, `${base}.png`), root)
        if (plain) return plain
        if (key) {
          const enc1 = await imageData(path.resolve(root, `${base}.rpgmvp`), root, key)
          if (enc1) return enc1
          const enc2 = await imageData(path.resolve(root, `${base}.png_`), root, key)
          if (enc2) return enc2
        }
      }
    }
  } catch {
    /* Games without an MV/MZ system file use conventional artwork or save thumbnails. */
  }

  // Try every loose RGSS title candidate; a corrupt image must not hide valid artwork.
  for (const dir of ['Graphics/Titles1', 'Graphics/Titles2', 'Graphics/Titles']) {
    try {
      const fullDir = path.resolve(root, dir)
      const entries = await fs.readdir(fullDir)
      const pngs = entries.filter((f) => /\.(?:png|jpe?g)$/i.test(f)).sort()
      pngs.sort((a, b) => Number(/^title/i.test(b)) - Number(/^title/i.test(a)) || a.localeCompare(b))
      candidates.push(...pngs.map((name) => path.join(dir, name)))
    } catch {
      /* ignore */
    }
  }

  candidates.push('cover.jpg', 'cover.png', 'img/titles1/Title.png', 'img/titles1/Title1.png', 'Graphics/Titles/Title.png')
  for (const candidate of candidates) {
    const image = await imageData(path.resolve(root, candidate), root)
    if (image) return image
  }

  const saves = await readOfflineGameSaves(gameId)
  const thumbnails = [...(saves?.game.entries || []), ...(saves?.app.entries || [])].filter((save) => save.hasThumb).sort((a, b) => b.savedAt - a.savedAt)
  for (const save of thumbnails.slice(0, 8)) {
    const thumbnail = await readOfflineSaveThumbnail(gameId, save.offlinePlace, save.list, save.id)
    if (thumbnail) return thumbnail
  }
  for (const candidate of ['chaya/app-icon.png', 'icon/icon.png']) {
    const image = await imageData(path.join(root, candidate), root)
    if (image) return image
  }
  return null
}
