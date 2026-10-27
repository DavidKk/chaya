import { GET, POST } from '@/app/api/dev/rgss-sync/route.dev'
import { getResolvedFromConfig } from '@/services/game/binding'
import { detectRgssPlugins, installRgssPlugins, listRgssPluginOutdatedFiles, syncRgssHotReloadFiles } from '@/services/game/rgss-plugins'
import { rgssRuntimeStatus } from '@/services/game/rgss-runtime'

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: jest.fn() }))
jest.mock('@/services/game/rgss-plugins', () => ({
  RGSS_HOT_RELOAD_FILES: ['translation.rb'],
  detectRgssPlugins: jest.fn(),
  installRgssPlugins: jest.fn(),
  listRgssPluginOutdatedFiles: jest.fn(),
  syncRgssHotReloadFiles: jest.fn(),
}))
jest.mock('@/services/game/rgss-runtime', () => ({
  rgssRuntimeStatus: jest.fn(),
  onRgssRuntimeChange: jest.fn(() => () => {}),
}))

const context = { params: Promise.resolve({}) }
const request = () => new Request('http://localhost/api/dev/rgss-sync', { method: 'POST' })
const responseBody = async () => (await POST(request(), context).then((response) => response.json())) as Record<string, unknown>

beforeEach(() => {
  jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'development' })
  jest.mocked(getResolvedFromConfig).mockReturnValue({ ok: true, engine: 'VX Ace', contentRoot: '/game', remote: false } as ReturnType<typeof getResolvedFromConfig>)
  jest.mocked(detectRgssPlugins).mockReturnValue([{ name: 'ChayaRGSS', registered: true, enabled: true, fileExists: true, kitSource: '/kit' }])
  jest.mocked(listRgssPluginOutdatedFiles).mockReturnValue([])
  jest.mocked(rgssRuntimeStatus).mockReturnValue({ running: false, starting: false, bridgeConnected: false } as ReturnType<typeof rgssRuntimeStatus>)
  jest.mocked(installRgssPlugins).mockReturnValue({ copied: ['translation.rb'], pluginsJsUpdated: false, contentRoot: '/game' })
  jest.mocked(syncRgssHotReloadFiles).mockReturnValue({ copied: ['translation.rb'] })
})

test('is unavailable outside the development server', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'production' })
  expect((await POST(request(), context)).status).toBe(400)
  expect(getResolvedFromConfig).not.toHaveBeenCalled()
})

test('does nothing when the selected RGSS plugins are current', async () => {
  expect(await responseBody()).toMatchObject({ action: 'idle', reason: 'RGSS plugins are up to date' })
  expect(installRgssPlugins).not.toHaveBeenCalled()
  expect(syncRgssHotReloadFiles).not.toHaveBeenCalled()
})

test('installs all changed files after the game exits', async () => {
  jest.mocked(listRgssPluginOutdatedFiles).mockReturnValue(['translation.rb', 'dist/ChayaRGSSOverlay.js'])
  expect(await responseBody()).toMatchObject({ action: 'installed', copied: ['translation.rb'] })
  expect(installRgssPlugins).toHaveBeenCalledWith('/game')
  expect(syncRgssHotReloadFiles).not.toHaveBeenCalled()
})

test('hot-syncs reloadable Ruby and defers overlay assets while the bridge is connected', async () => {
  jest.mocked(listRgssPluginOutdatedFiles).mockReturnValue(['translation.rb', 'dist/ChayaRGSSOverlay.js'])
  jest.mocked(rgssRuntimeStatus).mockReturnValue({ running: true, starting: false, bridgeConnected: true } as ReturnType<typeof rgssRuntimeStatus>)
  expect(await responseBody()).toMatchObject({
    action: 'hot',
    copied: ['translation.rb'],
    deferred: ['dist/ChayaRGSSOverlay.js'],
  })
  expect(syncRgssHotReloadFiles).toHaveBeenCalledWith('/game')
  expect(installRgssPlugins).not.toHaveBeenCalled()
})

test('defers every change while the game is running without a bridge', async () => {
  jest.mocked(listRgssPluginOutdatedFiles).mockReturnValue(['translation.rb', 'dist/ChayaRGSSOverlay.js'])
  jest.mocked(rgssRuntimeStatus).mockReturnValue({ running: true, starting: false, bridgeConnected: false } as ReturnType<typeof rgssRuntimeStatus>)
  expect(await responseBody()).toMatchObject({
    action: 'deferred',
    deferred: ['translation.rb', 'dist/ChayaRGSSOverlay.js'],
  })
  expect(syncRgssHotReloadFiles).not.toHaveBeenCalled()
  expect(installRgssPlugins).not.toHaveBeenCalled()
})

test('reports non-reloadable-only changes without claiming a hot reload', async () => {
  jest.mocked(listRgssPluginOutdatedFiles).mockReturnValue(['preload.rb'])
  jest.mocked(rgssRuntimeStatus).mockReturnValue({ running: true, starting: false, bridgeConnected: true } as ReturnType<typeof rgssRuntimeStatus>)
  expect(await responseBody()).toMatchObject({
    action: 'deferred',
    reason: 'only non-reloadable files changed',
    deferred: ['preload.rb'],
  })
  expect(syncRgssHotReloadFiles).not.toHaveBeenCalled()
})

test('surfaces install failures so the watcher can retry', async () => {
  jest.mocked(listRgssPluginOutdatedFiles).mockReturnValue(['translation.rb'])
  jest.mocked(installRgssPlugins).mockImplementationOnce(() => {
    throw new Error('disk full')
  })
  const response = await POST(request(), context)
  expect(response.status).toBe(500)
  expect(await response.json()).toMatchObject({ ok: false, error: { code: 'RGSS_SYNC_FAILED', message: 'disk full' } })
})

test('GET is unavailable outside development', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, NODE_ENV: 'production' })
  const res = await GET(new Request('http://localhost/api/dev/rgss-sync'), context)
  expect(res.status).toBe(400)
})

test('GET returns text/event-stream and streams initial sync state', async () => {
  const abort = new AbortController()
  const res = await GET(new Request('http://localhost/api/dev/rgss-sync', { signal: abort.signal }), context)
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toContain('text/event-stream')
  const reader = res.body!.getReader()
  const { value } = await reader.read()
  const text = new TextDecoder().decode(value)
  expect(text).toContain('event: sync\n')
  expect(text).toContain('"action":"idle"')
  await reader.cancel()
  abort.abort()
})
