import { PUT } from '@/app/api/status/route'
import * as game from '@/services/game'
import { resetGameBindEpochForTests } from '@/services/game/bind-epoch'
import * as gameConfig from '@/services/game/config'
import { registerGameFromPlugin, resetRegisteredSessionsForTests } from '@/services/runtime/register-game'
const triggerSilentTranslateIfEnabled = jest.fn()

jest.mock('@/initializer/controller', () => ({ defineApiRoute: (_name: string, handler: unknown) => handler }))
jest.mock('@/lib/service-mode', () => ({ requireDisk: () => null }))
jest.mock('@/services/runtime', () => ({}))
jest.mock('@/services/translate', () => ({
  getSharedTranslateCacheStats: jest.fn(),
  triggerSilentTranslateIfEnabled: (...args: unknown[]) => triggerSilentTranslateIfEnabled(...args),
}))
jest.mock('@/services/translate/cache-file-stats', () => ({}))
jest.mock('@/services/translate/silent-translate', () => ({
  triggerSilentTranslateIfEnabled: (...args: unknown[]) => triggerSilentTranslateIfEnabled(...args),
}))
jest.mock('@/services/runtime/launch-token', () => ({
  peekLaunchToken: (token: string | undefined) => (token === 'valid-token' ? { token: 'valid-token', gameRoot: '/games/PluginGame' } : null),
}))
jest.mock('@/lib/game', () => ({
  ...jest.requireActual('@/lib/game'),
  resolveGame: jest.fn(),
}))
jest.mock('@/services/game/config', () => ({
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
}))
jest.mock('@/services/game', () => ({
  ...jest.requireActual('@/services/game/library'),
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
  resolveGame: jest.fn(),
  getResolvedFromConfig: jest.fn(),
  readNwPackage: () => null,
  getGameFingerprint: () => null,
  toLibraryItemView: (entry: unknown) => entry,
}))

const existingEntry = { id: '11111111-1111-4111-8111-111111111111', gameRoot: '/existing/Game', name: 'Existing', addedAt: 1, lastOpenedAt: 2 }
const config = { gameRoot: existingEntry.gameRoot, shellSource: '', library: [existingEntry] }

beforeEach(() => {
  jest.clearAllMocks()
  resetGameBindEpochForTests()
  resetRegisteredSessionsForTests()
  jest.mocked(gameConfig.loadConfig).mockReturnValue(config)
  jest.mocked(gameConfig.saveConfig).mockImplementation((patch) => ({ ...config, ...patch }))
  jest.mocked(game.loadConfig).mockReturnValue(config)
  jest.mocked(game.saveConfig).mockImplementation((patch) => ({ ...config, ...patch }))
})

function mockResolveGame(resolved: Parameters<typeof game.resolveGame>[0] extends string ? ReturnType<typeof game.resolveGame> : never) {
  jest.mocked(game.resolveGame).mockReturnValue(resolved)
  const { resolveGame: libResolveGame } = jest.requireMock('@/lib/game')
  jest.mocked(libResolveGame).mockReturnValue(resolved)
}

async function putStatus(body: Record<string, unknown>) {
  const handler = PUT as unknown as (context: { request: Request }) => Promise<Response>
  return handler({
    request: new Request('http://localhost/api/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

describe('Silent translation trigger on game addition', () => {
  it('triggers silent translation when a brand new game is added via PUT /api/status', async () => {
    const resolved = {
      ok: true as const,
      selected: '/new/Game',
      contentRoot: '/new/Game/www',
      projectRoot: '/new/Game',
      kind: 'www' as const,
      shellApp: '',
      hasShell: false,
      hasWwwLayout: true,
      bundled: false,
    }
    mockResolveGame(resolved)

    const res = await putStatus({ gameRoot: '/new/Game', bindEpoch: 1 })
    expect(res.status).toBe(200)
    expect(triggerSilentTranslateIfEnabled).toHaveBeenCalledWith('/new/Game/www', { gameId: '/new/Game' })
  })

  it('does NOT trigger silent translation when switching to an existing game in the library', async () => {
    mockResolveGame({
      ok: true as const,
      selected: existingEntry.gameRoot,
      contentRoot: '/existing/Game/www',
      projectRoot: '/existing/Game',
      kind: 'www' as const,
      shellApp: '',
      hasShell: false,
      hasWwwLayout: true,
      bundled: false,
    })

    const res = await putStatus({ gameRoot: existingEntry.gameRoot, bindEpoch: 1 })
    expect(res.status).toBe(200)
    expect(triggerSilentTranslateIfEnabled).not.toHaveBeenCalled()
  })

  it('does NOT trigger silent translation when relocating an existing game with replaceLibraryId', async () => {
    mockResolveGame({
      ok: true as const,
      selected: '/relocated/Game',
      contentRoot: '/relocated/Game/www',
      projectRoot: '/relocated/Game',
      kind: 'www' as const,
      shellApp: '',
      hasShell: false,
      hasWwwLayout: true,
      bundled: false,
    })

    const res = await putStatus({ gameRoot: '/relocated/Game', replaceLibraryId: existingEntry.id, bindEpoch: 1 })
    expect(res.status).toBe(200)
    expect(triggerSilentTranslateIfEnabled).not.toHaveBeenCalled()
  })

  it('triggers silent translation when a game registers from plugin for the first time', () => {
    const resolvedGame = {
      ok: true as const,
      selected: '/games/PluginGame',
      contentRoot: '/games/PluginGame/www',
      projectRoot: '/games/PluginGame',
      kind: 'www' as const,
      shellApp: '',
      hasShell: false,
      hasWwwLayout: true,
      bundled: false,
      remote: false,
    }
    mockResolveGame(resolvedGame)

    const result = registerGameFromPlugin({
      gameRoot: '/games/PluginGame',
      launchToken: 'valid-token',
      sessionId: 'session-1',
    })

    expect(result.registered).toBe(true)
    expect(triggerSilentTranslateIfEnabled).toHaveBeenCalledWith('/games/PluginGame/www', { gameId: '/games/PluginGame' })
  })
})
