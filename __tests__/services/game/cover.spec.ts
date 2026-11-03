import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import { resolveGame } from '@/lib/game'
import { loadConfig } from '@/services/game/config'
import { readGameCover } from '@/services/game/cover'
import { readOfflineGameSaves, readOfflineSaveThumbnail } from '@/services/game-saves/offline-list'

jest.mock('@/lib/game', () => ({ resolveGame: jest.fn() }))
jest.mock('@/services/game/config', () => ({ loadConfig: jest.fn() }))
jest.mock('@/services/game/library', () => ({ pathEquals: (a: string, b: string) => a === b }))
jest.mock('@/services/game-saves/offline-list', () => ({ readOfflineGameSaves: jest.fn(), readOfflineSaveThumbnail: jest.fn() }))

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'chaya-cover-'))
  jest.mocked(loadConfig).mockReturnValue({ gameRoot: root, shellSource: '', library: [{ id: 'game-a', gameRoot: root, name: 'A' }] } as ReturnType<typeof loadConfig>)
  jest.mocked(resolveGame).mockReturnValue({ ok: true, contentRoot: root } as ReturnType<typeof resolveGame>)
  jest.mocked(readOfflineGameSaves).mockResolvedValue(null)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function image(relative: string, color = '#cc5522') {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: color } })
    .png()
    .toFile(file)
}

it('uses the configured title image before save thumbnails and bounds its size', async () => {
  await fs.mkdir(path.join(root, 'data'))
  await fs.writeFile(path.join(root, 'data/System.json'), JSON.stringify({ title1Name: 'Forest' }))
  await image('img/titles1/Forest.png')
  const cover = await readGameCover('game-a')
  expect(cover).toMatch(/^data:image\/jpeg;base64,/)
  const metadata = await sharp(Buffer.from(cover!.split(',')[1], 'base64')).metadata()
  expect(metadata.width).toBe(1280)
  expect(readOfflineGameSaves).not.toHaveBeenCalled()
})

it('does not use the host-selected game for an unknown game id', async () => {
  await image('cover.png')
  expect(await readGameCover('unknown')).toBeNull()
  expect(resolveGame).not.toHaveBeenCalled()
})

it('skips unreadable artwork and uses the most recent game-scoped save thumbnail', async () => {
  await fs.writeFile(path.join(root, 'cover.png'), 'broken image')
  jest.mocked(readOfflineGameSaves).mockResolvedValue({
    game: { entries: [{ id: 'auto-1', list: 'auto', savedAt: 10, hasThumb: true, offlinePlace: 'game' }] },
    app: { entries: [{ id: 'quick-2', list: 'quick', savedAt: 20, hasThumb: true, offlinePlace: 'app' }] },
  } as Awaited<ReturnType<typeof readOfflineGameSaves>>)
  jest.mocked(readOfflineSaveThumbnail).mockResolvedValue('data:image/jpeg;base64,c2F2ZQ==')
  expect(await readGameCover('game-a')).toBe('data:image/jpeg;base64,c2F2ZQ==')
  expect(readOfflineSaveThumbnail).toHaveBeenCalledWith('game-a', 'app', 'quick', 'quick-2')
})

it('rejects artwork symlinks that escape the game directory', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'chaya-private-cover-'))
  try {
    await fs.writeFile(
      path.join(outside, 'private.png'),
      await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer()
    )
    await fs.symlink(path.join(outside, 'private.png'), path.join(root, 'cover.png'))
    expect(await readGameCover('game-a')).toBeNull()
  } finally {
    await fs.rm(outside, { recursive: true, force: true })
  }
})

it('returns no cover for a game without images or saves', async () => {
  expect(await readGameCover('game-a')).toBeNull()
})

it.each(['.rpgmvp', '.png_'])('decrypts standard title artwork in memory (%s)', async (extension) => {
  const key = Buffer.from('0123456789abcdef0123456789abcdef', 'hex')
  await fs.mkdir(path.join(root, 'data'))
  await fs.writeFile(path.join(root, 'data/System.json'), JSON.stringify({ title1Name: 'Forest', encryptionKey: key.toString('hex') }))
  await image('img/titles1/Forest.png')
  const plain = await fs.readFile(path.join(root, 'img/titles1/Forest.png'))
  const encrypted = Buffer.from(plain)
  for (let i = 0; i < 16; i++) encrypted[i] ^= key[i]
  await fs.writeFile(path.join(root, `img/titles1/Forest${extension}`), Buffer.concat([Buffer.from('5250474d560000000003010000000000', 'hex'), encrypted]))
  await fs.unlink(path.join(root, 'img/titles1/Forest.png'))
  expect(await readGameCover('game-a')).toMatch(/^data:image\/jpeg;base64,/)
  expect(await fs.readdir(path.join(root, 'img/titles1'))).toEqual([`Forest${extension}`])
})

it('rejects invalid encrypted headers and falls back to a plain second title layer', async () => {
  await fs.mkdir(path.join(root, 'data'))
  await fs.writeFile(path.join(root, 'data/System.json'), JSON.stringify({ title1Name: 'Broken', title2Name: 'Good', encryptionKey: '0'.repeat(32) }))
  await image('img/titles1/Broken.rpgmvp')
  await image('img/titles2/Good.png')
  expect(await readGameCover('game-a')).toMatch(/^data:image\/jpeg;base64,/)
})

it('uses a valid first title layer before searching the second layer', async () => {
  await fs.mkdir(path.join(root, 'data'))
  await fs.writeFile(path.join(root, 'data/System.json'), JSON.stringify({ title1Name: 'First', title2Name: 'Second' }))
  await image('img/titles1/First.png')
  await image('img/titles2/Second.png', '#0066cc')
  const cover = await readGameCover('game-a')
  const pixel = await sharp(Buffer.from(cover!.split(',')[1], 'base64'))
    .resize(1, 1)
    .raw()
    .toBuffer()
  expect(pixel[0]).toBeGreaterThan(pixel[2])
})

it('continues through corrupt loose RGSS artwork', async () => {
  await image('Graphics/Titles1/Forest.png')
  await fs.writeFile(path.join(root, 'Graphics/Titles1/Title.png'), 'broken')
  expect(await readGameCover('game-a')).toMatch(/^data:image\/jpeg;base64,/)
})

it('deduplicates concurrent work and expires successful and missing covers', async () => {
  let now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  const read = jest.spyOn(fs, 'readFile')
  expect(await Promise.all([readGameCover('game-a'), readGameCover('game-a')])).toEqual([null, null])
  const attempts = read.mock.calls.length
  await image('cover.png')
  expect(await readGameCover('game-a')).toBeNull()
  expect(read).toHaveBeenCalledTimes(attempts)
  now += 30_000
  const cover = await readGameCover('game-a')
  expect(cover).toMatch(/^data:image\/jpeg;base64,/)
  await fs.unlink(path.join(root, 'cover.png'))
  now += 179_999
  expect(await readGameCover('game-a')).toBe(cover)
  now += 1
  expect(await readGameCover('game-a')).toBeNull()
})
