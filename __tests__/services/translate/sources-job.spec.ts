import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mockLive = jest.fn()
const mockImportCache = jest.fn()
const mockCacheGet = jest.fn()

jest.mock('@/services/translate/live-translate', () => ({
  liveTranslateTexts: (...args: unknown[]) => mockLive(...args),
}))

jest.mock('@/services/translate/cache-api', () => ({
  importSharedTranslateCache: (...args: unknown[]) => mockImportCache(...args),
}))

jest.mock('@/services/translate/shared-cache', () => ({
  openSharedCache: () => ({
    get: (src: string) => mockCacheGet(src),
    close: jest.fn(),
  }),
}))

jest.mock('@/constants/paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-sources-jobs-'))
  return { TRANSLATE_JOBS_DIR: dir }
})

import { exportSourcesJob, getSourcesJobStatus, importSourcesJob, resetSourcesJobsForTests, searchSourcesJob } from '@/services/translate/sources-job'

function waitFor(predicate: () => boolean, ms = 2000) {
  const start = Date.now()
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > ms) return reject(new Error('timeout'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

beforeEach(() => {
  resetSourcesJobsForTests()
  mockLive.mockReset()
  mockImportCache.mockReset()
  mockCacheGet.mockReset()
  mockCacheGet.mockReturnValue(null)
})

describe('importSourcesJob', () => {
  it('returns immediately with jobId and does not wait for translation', async () => {
    let resolveBatch!: (v: unknown) => void
    mockLive.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBatch = resolve
        })
    )

    const snap = importSourcesJob(JSON.stringify(['あ', 'い']))
    expect(snap.jobId).toMatch(/^[a-f0-9]{16}$/)
    expect(snap.status).toBe('running')
    expect(snap.total).toBe(2)
    expect(snap.pending).toBe(2)
    expect(mockLive).toHaveBeenCalled()

    resolveBatch({
      items: [
        { src: 'あ', zh: '啊' },
        { src: 'い', zh: '咦' },
      ],
      contentRoot: null,
      engines: [],
    })
    await waitFor(() => getSourcesJobStatus(snap.jobId).status === 'done')
    expect(getSourcesJobStatus(snap.jobId).done).toBe(2)
  })

  it('marks cache hits and prefilled object values without calling engines', () => {
    mockCacheGet.mockImplementation((src: string) => (src === 'キャッシュ' ? '缓存命中' : null))
    const snap = importSourcesJob(JSON.stringify({ キャッシュ: '', 预设: '已有译文' }))
    expect(snap.status).toBe('done')
    expect(snap.pending).toBe(0)
    expect(snap.cached).toBe(1)
    expect(mockLive).not.toHaveBeenCalled()
    expect(mockImportCache).toHaveBeenCalled()

    const exported = exportSourcesJob(snap.jobId)
    expect(exported.payload).toEqual({ キャッシュ: '缓存命中', 预设: '已有译文' })
  })
})

describe('search and export', () => {
  it('searches by key and exports AST shape', async () => {
    mockLive.mockResolvedValue({
      items: [{ src: '私は白雨。', zh: '我是白雨。' }],
      contentRoot: null,
      engines: ['google'],
    })
    const snap = importSourcesJob(JSON.stringify([{ id: 'main_001', key: 'message', text: '私は白雨。', line: 22 }]))
    await waitFor(() => getSourcesJobStatus(snap.jobId).status === 'done')

    const found = searchSourcesJob(snap.jobId, { key: 'main_001' })
    expect(found.items).toEqual([expect.objectContaining({ key: 'main_001', src: '私は白雨。', zh: '我是白雨。', state: 'done' })])

    const exported = exportSourcesJob(snap.jobId)
    expect(exported.format).toBe('ast')
    expect(exported.payload).toEqual([expect.objectContaining({ id: 'main_001', key: 'message', text: '私は白雨。', zh: '我是白雨。', line: 22 })])
  })
})
