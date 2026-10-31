import { DELETE, GET, POST } from '@/app/api/logs/route'
import { GET as STREAM } from '@/app/api/logs/stream/route'
import { appendLog, logBusStats, MAX_LOG_SUBSCRIBERS, subscribeLogs } from '@/services/log/bus'
import * as files from '@/services/log/file-store'

const mode = { disk: false }
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ canUseDisk: () => mode.disk }))
jest.mock('@/services/log/file-store', () => ({
  appendLogToFile: jest.fn(),
  clearLogFiles: jest.fn(),
  loadLogsFromFiles: jest.fn(() => []),
  pluginLogFileStats: jest.fn(() => ({})),
  resolvePluginLogDir: jest.fn(() => '/test/logs'),
}))

const ctx = { params: Promise.resolve({}) }
const post = (body: unknown) => POST(new Request('http://localhost/api/logs', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), ctx)

beforeEach(() => {
  mode.disk = false
  jest.clearAllMocks()
})

test('browser mode drops plugin reports and exposes nothing to other visitors', async () => {
  const response = await post({ source: 'ChayaLink', message: 'secret game text' })
  expect(response.status).toBe(200)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(await response.json()).toMatchObject({ ok: true, count: 0 })

  const read = await (await GET(new Request('http://localhost/api/logs'), ctx)).json()
  expect(read.entries).toEqual([])
  const slow = await (await GET(new Request('http://localhost/api/logs?view=slow'), ctx)).json()
  expect(slow.entries).toEqual([])
  expect(slow.requests).toBeUndefined()

  expect((await DELETE(new Request('http://localhost/api/logs', { method: 'DELETE' }), ctx)).status).toBe(200)

  const abort = new AbortController()
  const stream = await STREAM(new Request('http://localhost/api/logs/stream', { signal: abort.signal }), ctx)
  const reader = stream.body!.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  expect(first).toContain('event: hello')
  expect(first).not.toContain('secret game text')
  abort.abort()
  await reader.cancel()

  for (const fn of [files.appendLogToFile, files.clearLogFiles, files.loadLogsFromFiles]) expect(fn).not.toHaveBeenCalled()
})

test('server mode keeps storing and returning plugin logs', async () => {
  mode.disk = true
  await post({ source: 'ChayaLink', message: 'state delivered' })
  const read = await (await GET(new Request('http://localhost/api/logs'), ctx)).json()
  expect(read.entries).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'state delivered' })]))
  expect(files.appendLogToFile).toHaveBeenCalled()
})

test('server mode returns a compact slow-request view with filtering and no cache', async () => {
  mode.disk = true
  jest.mocked(files.loadLogsFromFiles).mockReturnValueOnce([
    {
      id: 'request-record',
      ts: Date.now(),
      level: 'warn',
      source: 'http.slow',
      message: 'Slow HTTP request: completed',
      meta: { id: 'request-record', requestId: 'slow-test', method: 'GET', path: '/game', startedAt: Date.now() - 2500, elapsedMs: 2500, state: 'completed', status: 200 },
    },
  ])
  const response = await GET(new Request('http://localhost/api/logs?view=slow&requestId=slow-test&minMs=2000&limit=1'), ctx)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ ok: true, thresholdMs: 1000, matched: 1, returned: 1, requests: [{ requestId: 'slow-test', elapsedMs: 2500 }] })
  expect(files.loadLogsFromFiles).toHaveBeenLastCalledWith({ logDir: '/test/logs/slow-http', limit: 2000 })
})

test('bounds an unread SSE queue and releases the subscriber on reader cancellation', async () => {
  mode.disk = true
  const initial = logBusStats().listeners
  const response = await STREAM(new Request('http://localhost/api/logs/stream?backlog=0'), ctx)
  expect(logBusStats().listeners).toBe(initial + 1)
  for (let i = 0; i < 1000; i++) appendLog({ source: 'stream-test', level: 'debug', message: `${i}: ${'x'.repeat(1900)}` })
  const reader = response.body!.getReader()
  let bytes = 0
  try {
    while (bytes <= 64 * 1024) {
      const result = await Promise.race([reader.read(), new Promise<undefined>((resolve) => setTimeout(resolve, 10))])
      if (!result || result.done) break
      bytes += result.value.byteLength
    }
    expect(bytes).toBeLessThanOrEqual(64 * 1024)
  } finally {
    await reader.cancel()
  }
  expect(logBusStats().listeners).toBe(initial)
})

test('rejects excess SSE subscribers and removes an already-aborted subscription', async () => {
  mode.disk = true
  const releases = Array.from({ length: MAX_LOG_SUBSCRIBERS }, () => subscribeLogs(() => {}))
  try {
    const response = await STREAM(new Request('http://localhost/api/logs/stream'), ctx)
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')
  } finally {
    for (const release of releases) release()
  }
  const abort = new AbortController()
  abort.abort()
  await STREAM(new Request('http://localhost/api/logs/stream', { signal: abort.signal }), ctx)
  expect(logBusStats().listeners).toBe(0)
})
