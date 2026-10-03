import { DELETE, GET, POST } from '@/app/api/logs/route'
import { GET as STREAM } from '@/app/api/logs/stream/route'
import * as files from '@/services/log/file-store'

const mode = { disk: false }
jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/lib/service-mode', () => ({ canUseDisk: () => mode.disk }))
jest.mock('@/services/log/file-store', () => ({
  appendLogToFile: jest.fn(),
  clearLogFiles: jest.fn(),
  loadLogsFromFiles: jest.fn(() => []),
  pluginLogFileStats: jest.fn(() => ({})),
  resolvePluginLogDir: jest.fn(),
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
