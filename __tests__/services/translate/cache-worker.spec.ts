jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { gameContentPath } from '@/lib/game/content-files'
import type { CacheScanResult } from '@/services/translate/scheduler/cache-scan'
import { openSharedCache } from '@/services/translate/shared-cache'

beforeAll(() => execFileSync(process.execPath, ['services/translate/build.mjs'], { cwd: process.cwd(), stdio: 'pipe' }))

it('runs the production bundle off-thread and reuses current shared, local and numeric indexes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cache-worker-'))
  const root = path.join(dir, 'game')
  const file = path.join(dir, 'cache.sqlite')
  const seed = gameContentPath(root, 'seed')
  fs.mkdirSync(path.dirname(seed), { recursive: true })
  fs.writeFileSync(seed, JSON.stringify({ Hello: '本作你好', Welcome: '', Thunder7: '' }))
  const cache = openSharedCache(file)
  cache.writeMany(
    [
      ['Welcome', '欢迎'],
      ['Thunder5', '雷霆5'],
      ['Thunder10', '雷霆10'],
    ],
    'manual',
    { from: 'en', to: 'zh' }
  )
  cache.close()
  const worker = new Worker(path.resolve('native/bin/chaya-cache-worker.mjs'), { workerData: { contentRoot: root, file }, env: { ...process.env, CHAYA_ROOT: process.cwd() } })
  try {
    const results = await new Promise<CacheScanResult[]>((resolve, reject) => {
      let started = false
      const items: CacheScanResult[] = []
      worker.on('error', reject)
      worker.on('exit', (code) => {
        if (code) reject(new Error(`Worker exit ${code}`))
      })
      worker.on('message', (message) => {
        if (message.type === 'failed') reject(new Error(message.error))
        if (message.type === 'item') items.push(message.result)
        if (message.type === 'ready' && !started) {
          started = true
          worker.postMessage(['Hello', 'Welcome', 'Thunder7', 'Goodbye'].map((src, id) => ({ src, id })))
        } else if (message.type === 'ready') resolve(items)
      })
    })
    expect(results.map((result) => result.plan.zh)).toEqual(['本作你好', '欢迎', '雷霆7', null])
    expect(results.map((result) => result.id)).toEqual([0, 1, 2, 3])
    expect(results.every((result) => result.elapsedMs >= 0 && result.stamp && result.authorityVersion && result.plan.corpusVersion)).toBe(true)
    expect(new Set(results.map((result) => result.authorityVersion)).size).toBe(1)
  } finally {
    await worker.terminate()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}, 15000)
