jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath, localGameContentFile } from '@/lib/game/content-files'
import { requestListExtract, resetListExtractForTests } from '@/services/extract/list-extract-prepare'
import * as storageClient from '@/services/storage/client'
import { seedProgressStamp } from '@/services/translate/scheduler/seed-inventory'

describe('main-thread offload smoke', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-offload-smoke-'))
    fs.mkdirSync(path.dirname(gameContentPath(root, 'seed')), { recursive: true })
    fs.writeFileSync(gameContentPath(root, 'seed'), JSON.stringify({ こんにちは: '' }))
    fs.writeFileSync(gameContentPath(root, 'cacheNdjson'), '')
    resetListExtractForTests()
  })

  afterEach(() => {
    resetListExtractForTests()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('localGameContentFile and seedProgressStamp never call storageCall', () => {
    const spy = jest.spyOn(storageClient, 'storageCall')
    expect(localGameContentFile(root, 'seed')).toContain('seed.json')
    expect(seedProgressStamp(root)).toContain('seed.json')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('requestListExtract returns preparing immediately (no sync RGSS parse)', () => {
    const started = performance.now()
    const snap = requestListExtract(root)
    expect(performance.now() - started).toBeLessThan(50)
    expect(snap).toEqual({ preparing: true })
  })
})
