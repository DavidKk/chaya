import { PUT } from '@/app/api/status/route'
import * as game from '@/services/game'
import { resetGameBindEpochForTests } from '@/services/game/bind-epoch'

jest.mock('@/initializer/controller', () => ({ defineApiRoute: (_name: string, handler: unknown) => handler }))
jest.mock('@/lib/service-mode', () => ({ requireDisk: () => null }))
jest.mock('@/services/runtime', () => ({}))
jest.mock('@/services/translate', () => ({}))
jest.mock('@/services/translate/cache-file-stats', () => ({}))
jest.mock('@/services/game', () => ({
  ...jest.requireActual('@/services/game/library'),
  loadConfig: jest.fn(),
  saveConfig: jest.fn(),
  resolveGame: jest.fn(),
  getResolvedFromConfig: jest.fn(),
  readNwPackage: () => null,
  toLibraryItemView: (entry: unknown) => entry,
}))

const entry = { id: '11111111-1111-4111-8111-111111111111', gameRoot: '/missing/Game', name: 'Game', remark: 'My notes', addedAt: 1, lastOpenedAt: 2 }
const config = { gameRoot: entry.gameRoot, shellSource: '', library: [entry] }
const resolved = {
  ok: true as const,
  selected: '/Moved/Game',
  contentRoot: '/Moved/Game/www',
  projectRoot: '/Moved/Game',
  kind: 'www' as const,
  shellApp: '',
  hasShell: false,
  hasWwwLayout: true,
  bundled: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  resetGameBindEpochForTests()
  jest.mocked(game.loadConfig).mockReturnValue(config)
  jest.mocked(game.resolveGame).mockReturnValue(resolved)
  jest.mocked(game.saveConfig).mockImplementation((patch) => ({ ...config, ...patch }))
})

async function relocate(body: Record<string, unknown>) {
  const handler = PUT as unknown as (context: { request: Request }) => Promise<Response>
  return handler({ request: new Request('http://localhost/api/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
}

it('updates the original record and selected path without creating a new library item', async () => {
  const response = await relocate({ gameRoot: '/Moved/Game', replaceLibraryId: entry.id, bindEpoch: 1 })
  expect(response.status).toBe(200)
  const saved = jest.mocked(game.saveConfig).mock.calls[0][0]
  expect(saved.gameRoot).toBe('/Moved/Game')
  expect(saved.library).toHaveLength(1)
  expect(saved.library?.[0]).toMatchObject({ id: entry.id, gameRoot: '/Moved/Game', remark: entry.remark, addedAt: entry.addedAt })
})

it('keeps the old record when the chosen directory is invalid', async () => {
  jest.mocked(game.resolveGame).mockReturnValue({ ok: false, error: 'Not a game' })
  expect((await relocate({ gameRoot: '/invalid', replaceLibraryId: entry.id })).status).toBe(400)
  expect(game.saveConfig).not.toHaveBeenCalled()
})

it('does not add an entry if the original record was removed while choosing a directory', async () => {
  expect((await relocate({ gameRoot: '/Moved/Game', replaceLibraryId: 'removed' })).status).toBe(400)
  expect(game.saveConfig).not.toHaveBeenCalled()
})
