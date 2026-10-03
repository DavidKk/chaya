import { etaSeconds, formatDuration, nextRate } from '@/lib/downloads/rate'
import { type DownloadItem, getDownloads, onDownloadFinished, patchDownload, removeDownload, resetDownloadsForTest, upsertDownload } from '@/lib/downloads/store'

const base = (id: string, patch: Partial<DownloadItem> = {}): DownloadItem => ({
  id,
  channel: 'server',
  kind: 'nw-shell',
  status: 'running',
  phase: 'download',
  startedAt: 1,
  ...patch,
})

let finished: DownloadItem[] = []

beforeEach(() => {
  resetDownloadsForTest()
  finished = []
  onDownloadFinished((item) => finished.push(item))
})

test('running → 结束只触发一次结束事件', () => {
  upsertDownload(base('a'))
  upsertDownload(base('a', { status: 'done' }))
  upsertDownload(base('a', { status: 'done' }))
  expect(finished.map((i) => i.id)).toEqual(['a'])
})

test('从未见过、首次出现即为终态：触发一次', () => {
  upsertDownload(base('b', { status: 'error', error: 'x' }))
  upsertDownload(base('b', { status: 'error', error: 'x' }))
  expect(finished.map((i) => i.id)).toEqual(['b'])
})

test('首次快照（baseline）里的终态项不触发，之后也不补发', () => {
  upsertDownload(base('c', { status: 'done' }), undefined, { baseline: true })
  upsertDownload(base('c', { status: 'done' }))
  expect(finished).toEqual([])
  expect(getDownloads()).toHaveLength(1)
})

test('patch / remove', () => {
  upsertDownload(base('f'))
  patchDownload('f', { receivedBytes: 10, totalBytes: 100 })
  expect(getDownloads()[0]).toMatchObject({ receivedBytes: 10 })
  removeDownload('f')
  expect(getDownloads()).toEqual([])
})

test('浏览器项最多 50 条，超出丢最早的已结束项', () => {
  for (let i = 0; i < 51; i++) upsertDownload(base(`web:${i}`, { channel: 'browser', status: 'done', startedAt: i, finishedAt: i }))
  expect(getDownloads()).toHaveLength(50)
  expect(getDownloads().some((i) => i.id === 'web:0')).toBe(false)
})

test('速度：首次只记基准，间隔 ≥500ms 才更新，指数平滑', () => {
  const s0 = nextRate(undefined, 0, 0)
  expect(s0.rate).toBeUndefined()
  expect(nextRate(s0, 100, 200)).toBe(s0)
  const s1 = nextRate(s0, 1000, 1000)
  expect(s1.rate).toBe(1000)
  const s2 = nextRate(s1, 3000, 2000)
  expect(s2.rate).toBeCloseTo(0.3 * 2000 + 0.7 * 1000)
})

test('剩余时间：低于 1 KB/s 或无总长不给', () => {
  expect(etaSeconds(0, 10_240, 1024)).toBe(10)
  expect(etaSeconds(0, 10_240, 500)).toBeUndefined()
  expect(etaSeconds(0, undefined, 4096)).toBeUndefined()
  expect(formatDuration(65)).toBe('1:05')
  expect(formatDuration(3725)).toBe('1:02:05')
})
