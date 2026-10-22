import { DELETE, POST } from '@/app/api/plugins/route.server'
import { getResolvedFromConfig } from '@/services/disk-ops'
import { clearRgssPlugins, installRgssPlugins } from '@/services/game/rgss-plugins'
import { rgssRuntimeStatus } from '@/services/game/rgss-runtime'

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/disk-ops', () => ({ requireDisk: () => null, getResolvedFromConfig: jest.fn(), injectTrackedPlugins: jest.fn(), clearTrackedPlugins: jest.fn() }))
jest.mock('@/services/game/rgss-plugins', () => ({
  installRgssPlugins: jest.fn(() => ({ copied: ['native.rb'] })),
  clearRgssPlugins: jest.fn(() => ({ removedFiles: ['native.rb'] })),
}))
jest.mock('@/services/game/rgss-runtime', () => ({ rgssRuntimeStatus: jest.fn(() => ({ running: false })) }))
jest.mock('@/services/runtime', () => ({ preferredPluginApiBase: jest.fn(), toolkitListenPort: jest.fn(), writeLaunchEnv: jest.fn() }))
const context = { params: Promise.resolve({}) }
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getResolvedFromConfig).mockReturnValue({ ok: true, engine: 'VX Ace', contentRoot: '/game' } as ReturnType<typeof getResolvedFromConfig>)
  jest.mocked(rgssRuntimeStatus).mockReturnValue({ running: false } as ReturnType<typeof rgssRuntimeStatus>)
})
it('dispatches RGSS install and clear to its independent plugin module', async () => {
  expect((await POST(new Request('http://localhost/api/plugins', { method: 'POST' }), context)).status).toBe(200)
  expect(installRgssPlugins).toHaveBeenCalledWith('/game')
  expect((await DELETE(new Request('http://localhost/api/plugins', { method: 'DELETE' }), context)).status).toBe(200)
  expect(clearRgssPlugins).toHaveBeenCalledWith('/game')
})
it('refuses install and clear while the RGSS process is running', async () => {
  jest.mocked(rgssRuntimeStatus).mockReturnValue({ running: true } as ReturnType<typeof rgssRuntimeStatus>)
  expect((await POST(new Request('http://localhost/api/plugins', { method: 'POST' }), context)).status).toBe(400)
  expect((await DELETE(new Request('http://localhost/api/plugins', { method: 'DELETE' }), context)).status).toBe(400)
  expect(installRgssPlugins).not.toHaveBeenCalled()
  expect(clearRgssPlugins).not.toHaveBeenCalled()
})
