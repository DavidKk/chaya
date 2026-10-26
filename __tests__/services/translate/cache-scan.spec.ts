jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('@/services/translate/sensitive-text', () => ({ isNsfwCacheRow: () => false }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { createGameCoverage } from '@/services/translate/game-coverage'
import { createCacheScanner } from '@/services/translate/scheduler/cache-scan'
import { openSharedCache } from '@/services/translate/shared-cache'

describe('cache scan control and template coverage', () => {
  let dir: string, root: string, database: string
  let cache: ReturnType<typeof openSharedCache>
  let scanner: ReturnType<typeof createCacheScanner>

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cache-scan-'))
    root = path.join(dir, 'game')
    database = path.join(dir, 'shared.sqlite')
    const seed = gameContentPath(root, 'seed')
    fs.mkdirSync(path.dirname(seed), { recursive: true })
    fs.writeFileSync(seed, '{}')
    cache = openSharedCache(database)
    cache.writeMany(
      [
        ["\\n[#]'s First Customer", '\\n[#]的第一位顾客'],
        ['See hints (What to do next?)', '查看提示（下一步该怎么做？）'],
        ['See guide', '查看指南'],
      ],
      'import',
      { from: 'en', to: 'zh' }
    )
    scanner = createCacheScanner(root, database)
  })

  afterEach(() => {
    scanner.close()
    cache.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it.each([
    ["\\N[3]'s First Customer", '\\N[3]的第一位顾客', "\\n[#]'s First Customer"],
    ["\\N[12]'s First Customer", '\\N[12]的第一位顾客', "\\n[#]'s First Customer"],
    ['\\I[112]See hints (What to do next?)', '\\I[112]查看提示（下一步该怎么做？）', 'See hints (What to do next?)'],
    ['\\I[231]See guide', '\\I[231]查看指南', 'See guide'],
  ])('resolves %s on the cache lane with backfill dependencies', (src, zh, dependency) => {
    const result = scanner.scan(0, src)
    expect(result.plan).toMatchObject({ status: 'full', zh, gaps: [] })
    expect(result.records).toEqual(expect.arrayContaining([expect.objectContaining({ src: dependency })]))
    expect(cache.current(result.records!)).toBe(true)
  })

  it('does not count incomplete cache coverage as full', () => {
    expect(scanner.scan(0, '\\I[231]An unknown instruction').plan.status).not.toBe('full')
  })

  it('counts durable template and display mirrors after resuming', () => {
    const coverage = createGameCoverage(
      [
        { id: 'template', revision: 1, src: "\\n[#]'s First Customer", zh: '\\n[#]的第一位顾客', engine: 'import' },
        { id: 'guide', revision: 1, src: 'See guide', zh: '查看指南', engine: 'import' },
      ],
      { database }
    )
    try {
      expect(coverage.resolve("\\N[12]'s First Customer")).toBe('\\N[12]的第一位顾客')
      expect(coverage.resolve('\\I[231]See guide')).toBe('\\I[231]查看指南')
    } finally {
      coverage.close()
    }
  })

  it('honors explicit local deletions even when a shared template exists', () => {
    const file = gameContentPath(root, 'cacheNdjson')
    fs.writeFileSync(file, JSON.stringify({ s: '\\I[231]See guide', t: null }) + '\n')
    expect(scanner.scan(0, '\\I[231]See guide').plan.status).not.toBe('full')
  })
})
