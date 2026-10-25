import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import { localGameContentFile } from '@/lib/game/content-files'

const registryFile = path.join(DATA_DIR, 'runtime', 'game-directories.json')

describe('content-files local resolver', () => {
  let root: string
  let daemonRoot: string
  let gameDir: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-content-root-'))
    daemonRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-daemon-'))
    gameDir = path.join(daemonRoot, 'games', 'game-1')
    fs.mkdirSync(path.join(gameDir, 'translate'), { recursive: true })
    fs.mkdirSync(path.dirname(registryFile), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(daemonRoot, { recursive: true, force: true })
    try {
      fs.unlinkSync(registryFile)
    } catch {
      /* no registry written */
    }
  })

  it('resolves a storage-backed seed to the daemon read view over the stale in-game copy', () => {
    fs.writeFileSync(path.join(gameDir, 'translate', 'seed.json'), JSON.stringify({ こんにちは: '你好' }))
    fs.writeFileSync(registryFile, JSON.stringify({ [root]: { gameId: 'game-1', directory: gameDir } }))

    const gameLocal = path.join(root, 'chaya', 'translate', 'seed.json')
    fs.mkdirSync(path.dirname(gameLocal), { recursive: true })
    fs.writeFileSync(gameLocal, JSON.stringify({ こんにちは: '' }))

    expect(localGameContentFile(root, 'seed')).toBe(path.join(gameDir, 'translate', 'seed.json'))
  })

  it('falls back to the in-game copy when no daemon view is registered', () => {
    const gameLocal = path.join(root, 'chaya', 'translate', 'seed.json')
    fs.mkdirSync(path.dirname(gameLocal), { recursive: true })
    fs.writeFileSync(gameLocal, JSON.stringify({ こんにちは: '' }))

    expect(localGameContentFile(root, 'seed')).toBe(gameLocal)
  })
})
