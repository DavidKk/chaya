import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ChayaConfig, ResolvedGame } from '@/lib/game/types'
import { GameSavesAppStore } from '@/services/game-saves/app-store'
import { readOfflineGameSaves } from '@/services/game-saves/offline-list'

const entry = (id: string, savedAt: number) => ({
  id,
  list: id.startsWith('quick-') ? ('quick' as const) : ('auto' as const),
  ...(id.startsWith('quick-') ? { slot: 1 } : {}),
  tag: id.startsWith('quick-') ? ('quick' as const) : ('auto' as const),
  unsafe: false,
  savedAt,
  playtimeFrames: 1,
  mapId: 1,
  mapName: 'Town',
  partyNames: [],
  versionId: 1,
  engine: 'mz' as const,
  bytes: 10,
  hasThumb: false,
})

describe('offline game saves', () => {
  let root = ''
  let dataDir = ''
  let gameRoot = ''
  let contentRoot = ''
  const libraryId = '11111111-1111-4111-8111-111111111111'

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'chaya-offline-saves-'))
    dataDir = path.join(root, 'data')
    gameRoot = path.join(root, 'game')
    contentRoot = path.join(gameRoot, 'www')
    await fs.mkdir(path.join(contentRoot, 'chaya', 'saves'), { recursive: true })
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  const deps = (): Parameters<typeof readOfflineGameSaves>[1] => ({
    dataDir,
    config: { gameRoot: '', shellSource: '', library: [{ id: libraryId, gameRoot, name: 'Game', addedAt: 1, lastOpenedAt: 1 }] } as ChayaConfig,
    resolve: () =>
      ({
        ok: true,
        selected: gameRoot,
        contentRoot,
        projectRoot: gameRoot,
        kind: 'www',
        shellApp: '',
        hasShell: false,
        hasWwwLayout: true,
        bundled: false,
      }) as ResolvedGame,
  })

  it('reads game and app indices and prefers the library id on equal timestamps', async () => {
    await fs.writeFile(path.join(contentRoot, 'chaya', 'saves', 'index.json'), JSON.stringify({ version: 1, revision: 1, entries: [entry('auto-aaaaaa', 1)] }))
    const libraryStore = new GameSavesAppStore(libraryId, dataDir)
    const pathStore = new GameSavesAppStore(`path:${path.resolve(gameRoot)}`, dataDir)
    await fs.mkdir(libraryStore.root, { recursive: true })
    await fs.mkdir(pathStore.root, { recursive: true })
    await fs.writeFile(path.join(libraryStore.root, 'index.json'), JSON.stringify({ version: 1, revision: 1, entries: [entry('quick-1', 20)] }))
    await fs.writeFile(path.join(pathStore.root, 'index.json'), JSON.stringify({ version: 1, revision: 1, entries: [entry('quick-1', 20), entry('auto-bbbbbb', 2)] }))

    const result = await readOfflineGameSaves(libraryId, deps())
    expect(result?.game.entries.map((item) => item.id)).toEqual(['auto-aaaaaa'])
    expect(result?.app.entries.map((item) => item.id)).toEqual(['quick-1', 'auto-bbbbbb'])
  })

  it('isolates a corrupt source and rejects unknown library ids', async () => {
    await fs.writeFile(path.join(contentRoot, 'chaya', 'saves', 'index.json'), '{bad')
    const result = await readOfflineGameSaves(libraryId, deps())
    expect(result?.game).toMatchObject({ status: 'corrupt', entries: [] })
    await expect(readOfflineGameSaves('unknown', deps())).resolves.toBeNull()
  })
})
