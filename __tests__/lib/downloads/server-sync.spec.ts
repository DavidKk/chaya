/** @jest-environment jsdom */
import { resetServerSyncForTest, serverDownloadsEnabled, startServerDownloadSync } from '@/lib/downloads/server-sync'
import { type DownloadItem, getDownloads, LOCAL_FINISHED_TTL_MS, onDownloadFinished, resetDownloadsForTest } from '@/lib/downloads/store'
import type { ServerDownloadJob } from '@/lib/downloads/types'

const target = { value: 'local' }
jest.mock('@/lib/service-mode/target', () => ({
  get BUILD_TARGET() {
    return target.value
  },
}))

class FakeEventSource {
  static OPEN = 1
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.OPEN
  closed = false
  private handlers = new Map<string, Array<(e: MessageEvent) => void>>()
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb])
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  emit(type: string, data: unknown) {
    for (const cb of this.handlers.get(type) ?? []) cb(new MessageEvent(type, { data: JSON.stringify(data) }))
  }
}

const job = (id: string, patch: Partial<ServerDownloadJob> = {}): ServerDownloadJob => ({ id, kind: 'nw-shell', status: 'running', phase: 'download', startedAt: 1, ...patch })
const latest = () => FakeEventSource.instances.at(-1)!
let finished: DownloadItem[] = []
let fetchMock: jest.Mock

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  Object.assign(globalThis, { EventSource: FakeEventSource })
  FakeEventSource.instances = []
  target.value = 'local'
  resetServerSyncForTest()
  resetDownloadsForTest()
  finished = []
  onDownloadFinished((i) => finished.push(i))
  fetchMock = jest.fn()
  globalThis.fetch = fetchMock
  setVisibility('visible')
})

test('启用条件：edge 不连；/api/status 报告 canUseDisk 才启用', async () => {
  target.value = 'edge'
  await expect(serverDownloadsEnabled()).resolves.toBe(false)
  expect(fetchMock).not.toHaveBeenCalled()

  target.value = 'local'
  fetchMock.mockResolvedValueOnce({ json: async () => ({ canUseDisk: false }) })
  await expect(serverDownloadsEnabled()).resolves.toBe(false)
  fetchMock.mockResolvedValueOnce({ json: async () => ({ canUseDisk: true }) })
  await expect(serverDownloadsEnabled()).resolves.toBe(true)
})

test('首次快照不通知；后续快照移除服务端已不存在的终态项', () => {
  const stop = startServerDownloadSync()
  latest().emit('snapshot', { jobs: [job('a', { status: 'done' }), job('b', { status: 'error' })] })
  expect(finished).toEqual([])
  expect(getDownloads()).toHaveLength(2)

  latest().emit('snapshot', { jobs: [job('b', { status: 'error' })] })
  expect(getDownloads().map((i) => i.id)).toEqual(['srv:b'])
  stop()
})

test('同步完全停止后重新挂载，第一份快照重新作为基线', () => {
  const stopFirst = startServerDownloadSync()
  latest().emit('snapshot', { jobs: [] })
  stopFirst()

  const stopSecond = startServerDownloadSync()
  latest().emit('snapshot', { jobs: [job('historical', { status: 'done' })] })
  expect(finished).toEqual([])
  stopSecond()
})

test('隐藏时断开、可见时重连；期间新建并结束的任务补发结束事件', () => {
  const stop = startServerDownloadSync()
  latest().emit('snapshot', { jobs: [] })
  setVisibility('hidden')
  expect(latest().closed).toBe(true)

  setVisibility('visible')
  expect(FakeEventSource.instances).toHaveLength(2)
  latest().emit('snapshot', { jobs: [job('mcp', { status: 'done', version: 'v1' })] })
  expect(finished.map((i) => i.id)).toEqual(['srv:mcp'])
  stop()
})

test('服务重启：本地 running 项变为合成中断项，一小时后自动移除', () => {
  jest.useFakeTimers()
  try {
    const stop = startServerDownloadSync()
    latest().emit('snapshot', { jobs: [job('x')] })
    latest().emit('snapshot', { jobs: [] })
    expect(getDownloads()[0]).toMatchObject({ id: 'srv:x', status: 'error', interrupted: true })
    expect(finished.map((i) => i.id)).toEqual(['srv:x'])

    latest().emit('snapshot', { jobs: [] })
    expect(getDownloads()).toHaveLength(1)

    jest.advanceTimersByTime(LOCAL_FINISHED_TTL_MS)
    expect(getDownloads()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    stop()
  } finally {
    jest.useRealTimers()
  }
})

test('服务端推 removed 时从列表移除', () => {
  const stop = startServerDownloadSync()
  latest().emit('snapshot', { jobs: [job('a', { status: 'done' }), job('b', { status: 'done' })] })
  latest().emit('removed', { id: 'a' })
  expect(getDownloads().map((i) => i.id)).toEqual(['srv:b'])
  stop()
})
