import { POST } from '@/app/api/launch/route.server'
import * as diskOps from '@/services/disk-ops'
import { clearDownloadJobsForTest, startDownloadJob } from '@/services/downloads/jobs'
import * as gameProcesses from '@/services/game/game-process'
import * as rgssRuntime from '@/services/game/rgss-runtime'
import { writeLaunchEnv } from '@/services/runtime'
import { recordGameLaunch } from '@/services/runtime/playable-games'
import { readRemotePlayHostSettings } from '@/services/runtime/remote-play-settings.server'

const calls: string[] = []

jest.mock('@/services/access/api', () => ({ mayAccessApi: async () => true }))
jest.mock('@/services/game/game-process', () => ({
  findRunningGameProcesses: jest.fn(() => []),
  terminateAllRunningGameProcesses: jest.fn(async () => []),
}))
jest.mock('@/services/game/app-icon', () => ({
  ensureGameAppIcon: jest.fn(async () => ({})),
  updateSharedMacAppIcon: jest.fn(async () => {}),
}))
jest.mock('@/services/runtime/remote-play-settings.server', () => ({
  readRemotePlayHostSettings: jest.fn(() => ({ launchMode: 'windowed', muteHostAudio: true })),
}))
jest.mock('@/services/runtime/playable-games', () => ({ recordGameLaunch: jest.fn() }))
jest.mock('@/services/game/rgss-runtime', () => ({
  launchRgss: jest.fn(async (resolved) => ({ mode: 'native-rgss', engine: resolved.engine, path: resolved.shellApp })),
  quitRgss: jest.fn(() => true),
  rgssRuntimeStatus: jest.fn(() => ({ running: false, starting: false })),
  anyRgssRunning: jest.fn(() => false),
}))
jest.mock('@/services/runtime', () => ({
  anyWebConnected: () => false,
  clearGameQuitRequest: jest.fn(),
  clearGamePresenceKeepQuit: jest.fn(),
  getGamePresence: () => ({ online: false }),
  preferredPluginApiBase: () => 'http://127.0.0.1:3000',
  requestGameQuit: jest.fn(),
  toolkitListenPort: () => 3000,
  writeLaunchEnv: jest.fn(() => ({ env: {}, session: { token: 't' } })),
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
  isShellInstalling: jest.fn(() => false),
  injectTrackedPlugins: () => ({ missingKit: [], copied: ['x'] }),
  ensureShellLinkedToContent: jest.fn(),
  launchShellWithContent: jest.fn(async () => {}),
  openInFinder: jest.fn(),
  writeNwWindow: jest.fn(),
}))

const ctx = { params: Promise.resolve({}) }
const launch = () => POST(new Request('http://localhost/api/launch', { method: 'POST' }), ctx)

beforeEach(() => {
  calls.splice(0)
  jest.clearAllMocks()
  clearDownloadJobsForTest()
})

afterEach(() => {
  clearDownloadJobsForTest()
})

test('启动前先恢复 .old，再解析游戏状态', async () => {
  const res = await launch()
  expect(res.status).toBe(200)
  expect(calls).toEqual(['resolve', 'recover', 'resolve'])
  expect(diskOps.launchShellWithContent).toHaveBeenCalled()
})

test('恢复失败：返回错误，不解析也不启动', async () => {
  jest.mocked(diskOps.recoverOldIfNeeded).mockImplementationOnce(() => {
    throw new Error('boom .Chaya.old')
  })
  const res = await launch()
  expect(res.status).toBe(500)
  const body = await res.json()
  expect(body.error).toMatchObject({ code: 'SHELL_SWAP_RECOVERY_REQUIRED', message: expect.stringContaining('.Chaya.old') })
  expect(diskOps.launchShellWithContent).not.toHaveBeenCalled()
})

test('共享壳安装期间拒绝启动', async () => {
  jest.mocked(diskOps.isShellInstalling).mockReturnValueOnce(true)
  const res = await launch()
  expect(res.status).toBe(409)
  expect((await res.json()).error.code).toBe('SHELL_JOB_RUNNING')
  expect(diskOps.launchShellWithContent).not.toHaveBeenCalled()
})

test('壳下载任务运行期间拒绝启动', async () => {
  startDownloadJob('nw-shell', () => new Promise(() => {}))
  const res = await launch()
  expect(res.status).toBe(409)
  expect((await res.json()).error.code).toBe('SHELL_JOB_RUNNING')
  expect(diskOps.launchShellWithContent).not.toHaveBeenCalled()
})

test('VX Ace 优先启动本地 mkxp-z 壳', async () => {
  jest.mocked(diskOps.getResolvedFromConfig).mockReturnValueOnce({
    ok: true,
    hasShell: true,
    remote: false,
    bundled: false,
    engine: 'VX Ace',
    shellApp: '/data/rgss/mkxp-z',
    contentRoot: '/game',
  } as never)
  const res = await launch()
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ mode: 'native-rgss', engine: 'VX Ace', path: '/data/rgss/mkxp-z' })
  expect(rgssRuntime.launchRgss).toHaveBeenCalled()
  expect(diskOps.ensureShellLinkedToContent).not.toHaveBeenCalled()
})

test('VX Ace 游戏已在运行时直接返回 alreadyRunning', async () => {
  jest.mocked(diskOps.getResolvedFromConfig).mockReturnValueOnce({
    ok: true,
    hasShell: true,
    remote: false,
    bundled: false,
    engine: 'VX Ace',
    shellApp: '/data/rgss/mkxp-z',
    contentRoot: '/game',
  } as never)
  jest.mocked(rgssRuntime.rgssRuntimeStatus).mockReturnValueOnce({
    running: true,
    starting: false,
    name: 'mkxp-z',
    roomId: 'room-1',
    bridgeConnected: true,
  } as never)
  const res = await launch()
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ mode: 'already-running', alreadyRunning: true, engine: 'VX Ace' })
  expect(rgssRuntime.launchRgss).not.toHaveBeenCalled()
})

test('VX Ace 没有壳时返回 RGSS_RUNTIME_MISSING', async () => {
  jest.mocked(diskOps.getResolvedFromConfig).mockReturnValueOnce({
    ok: true,
    hasShell: false,
    remote: false,
    bundled: false,
    engine: 'VX Ace',
    shellApp: '/game',
    contentRoot: '/game',
  } as never)
  const res = await launch()
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatchObject({
    code: 'RGSS_RUNTIME_MISSING',
    message: expect.stringContaining('mkxp-z'),
  })
  expect(diskOps.launchShellWithContent).not.toHaveBeenCalled()
})

test('支持 mode: silent 启动无感静默模式 (Mac 静音 + 隐藏窗口)', async () => {
  const req = new Request('http://localhost/api/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'silent' }),
  })
  const res = await POST(req, ctx)
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(data.mode).toBe('shared-shell-silent')
  expect(data.silent).toBe(true)
  expect(diskOps.launchShellWithContent).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ silent: true }))
})

const remoteLaunch = () => POST(new Request('http://localhost/api/launch', { method: 'POST', body: JSON.stringify({ remotePlay: true }) }), ctx)

it.each(['windowed', 'silent'] as const)('uses the host %s preference for remote MV launches', async (launchMode) => {
  jest.mocked(readRemotePlayHostSettings).mockReturnValueOnce({ launchMode, muteHostAudio: true })
  expect((await remoteLaunch()).status).toBe(200)
  expect(diskOps.launchShellWithContent).toHaveBeenCalledWith('/data/shell/Chaya', '/game/www', { silent: launchMode === 'silent' })
  expect(diskOps.writeNwWindow).toHaveBeenCalledWith('/game/www', { show: launchMode !== 'silent' })
  expect(writeLaunchEnv).toHaveBeenCalledWith(expect.anything(), expect.any(String), { silentMode: launchMode === 'silent', muteHostAudio: true })
  expect(recordGameLaunch).toHaveBeenCalledWith('/game/www', 'cloud')
})

it('keeps ordinary app launches independent from remote host preferences', async () => {
  expect((await launch()).status).toBe(200)
  expect(readRemotePlayHostSettings).not.toHaveBeenCalled()
  expect(writeLaunchEnv).toHaveBeenCalledWith(expect.anything(), expect.any(String), { silentMode: false })
  expect(diskOps.launchShellWithContent).toHaveBeenCalledWith('/data/shell/Chaya', '/game/www', { silent: false })
  expect(recordGameLaunch).toHaveBeenCalledWith('/game/www', 'local')
})

it.each([true, false])('passes an independent host audio preference (%s) to RGSS', async (muteHostAudio) => {
  jest.mocked(readRemotePlayHostSettings).mockReturnValueOnce({ launchMode: 'silent', muteHostAudio })
  jest.mocked(diskOps.getResolvedFromConfig).mockReturnValueOnce({
    ok: true,
    hasShell: true,
    engine: 'VX',
    shellApp: '/data/rgss/mkxp-z',
    contentRoot: '/game',
  } as never)
  expect((await remoteLaunch()).status).toBe(200)
  expect(rgssRuntime.launchRgss).toHaveBeenCalledWith(expect.objectContaining({ engine: 'VX' }), { silent: true, muteHostAudio })
  expect(recordGameLaunch).toHaveBeenCalledWith('/game', 'cloud')
})

it('reuses a running game without applying changed preferences or rewriting its environment', async () => {
  jest.mocked(gameProcesses.findRunningGameProcesses).mockReturnValueOnce([{ contentRoot: '/game/www' }] as never)
  const response = await remoteLaunch()
  expect(await response.json()).toMatchObject({ alreadyRunning: true })
  expect(writeLaunchEnv).not.toHaveBeenCalled()
  expect(diskOps.launchShellWithContent).not.toHaveBeenCalled()
  expect(recordGameLaunch).not.toHaveBeenCalled()
})

it('does not swallow corrupted settings as an empty launch request', async () => {
  jest.mocked(readRemotePlayHostSettings).mockImplementationOnce(() => {
    throw new SyntaxError('Invalid saved JSON')
  })
  expect((await remoteLaunch()).status).toBe(500)
  expect(diskOps.launchShellWithContent).not.toHaveBeenCalled()
  expect(rgssRuntime.launchRgss).not.toHaveBeenCalled()
})
