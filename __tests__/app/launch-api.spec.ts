import { POST } from '@/app/api/launch/route.server'
import * as diskOps from '@/services/disk-ops'

const calls: string[] = []

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/runtime', () => ({
  anyWebConnected: () => false,
  clearGameQuitRequest: jest.fn(),
  getGamePresence: () => ({ online: false }),
  preferredPluginApiBase: () => 'http://127.0.0.1:3000',
  requestGameQuit: jest.fn(),
  toolkitListenPort: () => 3000,
  writeLaunchEnv: () => ({ env: {}, session: { token: 't' } }),
}))
jest.mock('@/services/disk-ops', () => ({
  requireDisk: () => null,
  recoverOldIfNeeded: jest.fn(() => {
    calls.push('recover')
    return true
  }),
  getResolvedFromConfig: jest.fn(() => {
    calls.push('resolve')
    return { ok: true, hasShell: true, remote: false, bundled: false, shellApp: '/data/shell/Chaya', contentRoot: '/game/www' }
  }),
  ensureNwPackageName: () => ({}),
  injectTrackedPlugins: () => ({ missingKit: [], copied: ['x'] }),
  ensureShellLinkedToContent: jest.fn(),
  launchShellWithContent: jest.fn(async () => {}),
  openInFinder: jest.fn(),
}))

const ctx = { params: Promise.resolve({}) }
const launch = () => POST(new Request('http://localhost/api/launch', { method: 'POST' }), ctx)

beforeEach(() => {
  calls.splice(0)
})

test('启动前先恢复 .old，再解析游戏状态', async () => {
  const res = await launch()
  expect(res.status).toBe(200)
  expect(calls).toEqual(['recover', 'resolve'])
  expect(diskOps.launchShellWithContent).toHaveBeenCalled()
})

test('恢复失败：返回错误，不解析也不启动', async () => {
  jest.mocked(diskOps.recoverOldIfNeeded).mockImplementationOnce(() => {
    throw new Error('旧壳保留在 /data/shell/.Chaya.old')
  })
  const res = await launch()
  expect(res.status).toBe(500)
  const body = await res.json()
  expect(body.error).toMatchObject({ code: 'SHELL_SWAP_RECOVERY_REQUIRED', message: expect.stringContaining('.Chaya.old') })
  expect(diskOps.getResolvedFromConfig).not.toHaveBeenCalled()
  expect(diskOps.launchShellWithContent).not.toHaveBeenCalled()
})
