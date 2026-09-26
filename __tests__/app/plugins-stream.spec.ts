import { GET, HEAD } from '@/app/api/plugins/stream/route'
import { pluginHotSnapshot, subscribePluginHot } from '@/services/game/plugin-hot-bus'

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/game/plugin-hot-bus', () => ({ pluginHotSnapshot: jest.fn(), subscribePluginHot: jest.fn() }))

const context = { params: Promise.resolve({}) }
const unsubscribe = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  jest.mocked(subscribePluginHot).mockReturnValue(unsubscribe)
  jest.mocked(pluginHotSnapshot).mockReturnValue([{ name: 'ChayaTrans', etag: 'v1', ts: 1 }])
})
afterEach(() => jest.useRealTimers())

test('production never starts a plugin stream or file watcher', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'production' })
  const head = await HEAD(new Request('http://localhost/api/plugins/stream', { method: 'HEAD' }), context)
  expect(head.headers.get('X-Chaya-Plugin-Dev')).toBe('0')
  const response = await GET(new Request('http://localhost/api/plugins/stream'), context)
  expect(response.status).toBe(204)
  expect(subscribePluginHot).not.toHaveBeenCalled()
})

test('development exposes capability, snapshot and changes; cancel releases subscription and ping', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'development' })
  const head = await HEAD(new Request('http://localhost/api/plugins/stream', { method: 'HEAD' }), context)
  expect(head.headers.get('X-Chaya-Plugin-Dev')).toBe('1')
  expect(head.headers.get('Access-Control-Expose-Headers')).toContain('X-Chaya-Plugin-Dev')
  const response = await GET(new Request('http://localhost/api/plugins/stream'), context)
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"plugins":[{"name":"ChayaTrans","etag":"v1","ts":1}]')
  jest.mocked(subscribePluginHot).mock.calls[0][0]({ name: 'ChayaTrans', etag: 'v2', ts: 2 })
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: change')
  await reader.cancel()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('already aborted development requests close without leaked subscriptions', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'development' })
  const abort = new AbortController()
  abort.abort()
  const response = await GET(new Request('http://localhost/api/plugins/stream', { signal: abort.signal }), context)
  await response.text()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})
