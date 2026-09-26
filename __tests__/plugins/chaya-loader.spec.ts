import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

import { transformSync } from 'esbuild'

import * as brand from '@/constants/brand'

const code = transformSync(fs.readFileSync(path.join(process.cwd(), 'plugins/src/chaya-loader.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code
const base = 'http://localhost:3927'
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
  await jest.advanceTimersByTimeAsync(0)
}

function boot() {
  const sources: Source[] = []
  class Source {
    listeners = new Map<string, (event: { data: string }) => void>()
    onerror = () => {}
    close = jest.fn()
    constructor(public url: string) {
      sources.push(this)
    }
    addEventListener(name: string, fn: (event: { data: string }) => void) {
      this.listeners.set(name, fn)
    }
    emit(name: string, data: unknown) {
      this.listeners.get(name)?.({ data: JSON.stringify(data) })
    }
  }
  const unload = jest.fn()
  const fetcher = jest.fn(async (_url: string, options: RequestInit) =>
    options.method === 'HEAD'
      ? new Response(null, { status: 204, headers: { 'X-Chaya-Plugin-Dev': '1' } })
      : new Response('globalThis.updates.push("Trans")', { headers: { ETag: 'v1' } })
  )
  const scope = vm.createContext({
    require: (id: string) => {
      if (id === '@/constants/brand') return brand
      if (id === './helpers/node/node-require') return { tryNodeFsPath: () => null }
      return {
        ensureLaunchEnvGlobals: jest.fn(),
        pinApiBaseFromUrl: jest.fn(),
        resolveApiBase: () => base,
        resolveApiBaseFallbacks: () => [base],
        restorePluginErrors: jest.fn(),
        showPluginError: jest.fn(),
      }
    },
    window: { location: { href: 'file:///game/index.html' }, addEventListener: unload },
    document: { getElementsByTagName: () => [] },
    XMLHttpRequest: class {
      status = 200
      responseText = 'void 0'
      open() {}
      send() {}
    },
    PluginManager: {},
    console: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    EventSource: Source,
    fetch: fetcher,
    AbortController,
    URL,
    setTimeout,
    clearTimeout,
    updates: [],
  })
  return { scope, fetcher, sources, run: () => vm.runInContext(code, scope), stop: () => unload.mock.calls[0]?.[1]() }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('ordinary installed loader subscribes to dev SSE, catches up on hello, deduplicates reconnect and cleans up', async () => {
  const app = boot()
  app.run()
  await flush()
  expect(app.sources).toHaveLength(1)
  const snapshot = { plugins: [{ name: 'ChayaTrans', etag: 'v1' }] }
  app.sources[0].emit('hello', snapshot)
  await flush()
  expect(app.scope.updates).toEqual(['Trans'])
  app.sources[0].emit('change', { name: 'ChayaTrans', etag: 'v1' })
  app.sources[0].onerror()
  await jest.advanceTimersByTimeAsync(2000)
  app.sources[1].emit('hello', snapshot)
  await flush()
  expect(app.scope.updates).toEqual(['Trans'])
  expect(app.fetcher.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(1)
  app.stop()
  expect(app.sources[1].close).toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
})

test('production capability disables SSE and plugin evaluation', async () => {
  const app = boot()
  app.fetcher.mockResolvedValue(new Response(null, { status: 204, headers: { 'X-Chaya-Plugin-Dev': '0' } }))
  app.run()
  await flush()
  expect(app.sources).toHaveLength(0)
  expect(app.scope.updates).toEqual([])
  expect(jest.getTimerCount()).toBe(0)
  app.stop()
})

test('server may start after game; temporary fetch failure retries without dropping the change', async () => {
  const app = boot()
  app.fetcher.mockRejectedValueOnce(new Error('offline'))
  app.run()
  await flush()
  await jest.advanceTimersByTimeAsync(5000)
  expect(app.sources).toHaveLength(1)
  app.fetcher.mockRejectedValueOnce(new Error('building'))
  app.sources[0].emit('hello', { plugins: [{ name: 'ChayaTrans', etag: 'v1' }] })
  await flush()
  expect(app.scope.updates).toEqual([])
  await jest.advanceTimersByTimeAsync(2000)
  expect(app.scope.updates).toEqual(['Trans'])
  app.stop()
})

test('reloads serially in dependency order and keeps updates received during an in-flight fetch', async () => {
  const app = boot()
  app.run()
  await flush()
  let finish!: (response: Response) => void
  app.fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      })
  )
  app.sources[0].emit('hello', {
    plugins: [
      { name: 'ChayaEdit', etag: 'e1' },
      { name: 'ChayaTrans', etag: 'v1' },
    ],
  })
  await flush()
  expect(app.fetcher.mock.calls[1][0]).toContain('ChayaTrans.js')
  expect(app.fetcher).toHaveBeenCalledTimes(2)
  app.sources[0].emit('change', { name: 'ChayaTrans', etag: 'v2' })
  app.sources[0].emit('change', { name: 'ChayaTrans', etag: 'v3' })
  app.fetcher.mockImplementation(
    async (url) => new Response(`globalThis.updates.push("${url.includes('ChayaEdit') ? 'Edit' : 'Trans3'}")`, { headers: { ETag: url.includes('ChayaEdit') ? 'e1' : 'v3' } })
  )
  finish(new Response('globalThis.updates.push("Trans1")', { headers: { ETag: 'v1' } }))
  for (let i = 0; i < 8; i++) {
    await flush()
    if (app.scope.updates.length >= 3) break
  }
  expect(app.scope.updates).toEqual(['Trans1', 'Edit', 'Trans3'])
  app.stop()
})

test('disconnect pauses pending script evaluation and rechecks development capability', async () => {
  const app = boot()
  app.run()
  await flush()
  let finish!: (response: Response) => void
  app.fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      })
  )
  app.sources[0].emit('change', { name: 'ChayaTrans', etag: 'v2' })
  await flush()
  app.sources[0].onerror()
  app.fetcher.mockResolvedValue(new Response(null, { status: 204, headers: { 'X-Chaya-Plugin-Dev': '0' } }))
  finish(new Response('globalThis.updates.push("stale")', { headers: { ETag: 'v2' } }))
  await flush()
  await jest.advanceTimersByTimeAsync(4000)
  expect(app.sources).toHaveLength(1)
  expect(app.scope.updates).toEqual([])
  expect(jest.getTimerCount()).toBe(0)
  app.stop()
})
