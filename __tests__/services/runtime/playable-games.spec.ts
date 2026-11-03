import { resolveGame } from '@/lib/game'
import { loadConfig } from '@/services/game/config'
import { findRunningGameProcesses, type RunningGameProcess } from '@/services/game/game-process'
import { findRgssSessionByPid } from '@/services/game/rgss-runtime'
import { gameRunMode, playableGamesSnapshot, recordGameLaunch } from '@/services/runtime/playable-games'

jest.mock('@/lib/game', () => ({ resolveGame: jest.fn((root) => ({ ok: true, contentRoot: `${root}/www` })) }))
jest.mock('@/services/game/config', () => ({ loadConfig: jest.fn() }))
jest.mock('@/services/game/game-process', () => ({ findRunningGameProcesses: jest.fn(() => []) }))
jest.mock('@/services/game/rgss-runtime', () => ({ findRgssSessionByPid: jest.fn() }))
jest.mock('@/services/game/library', () => ({
  pathEquals: (a: string, b: string) => a === b,
  toLibraryItemView: (entry: unknown) => entry,
}))

const proc = (pid: number, contentRoot = '/Games/First/www'): RunningGameProcess => ({ pid, contentRoot, command: 'nwjs', isMain: true })

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers({ now: 100_000 })
  const global = globalThis as typeof globalThis & { __chaya_game_launch_modes_v1__?: Map<string, unknown> }
  global.__chaya_game_launch_modes_v1__?.clear()
  jest.mocked(findRunningGameProcesses).mockReturnValue([])
  jest.mocked(findRgssSessionByPid).mockReturnValue(undefined)
  jest.mocked(loadConfig).mockReturnValue({
    gameRoot: '/Games/First',
    library: [
      { id: 'first', name: 'First', gameRoot: '/Games/First' },
      { id: 'second', name: 'Second', gameRoot: '/Games/Second' },
      { id: 'remote', name: 'Remote binding', gameRoot: '/Games/Remote', remote: true },
      { id: 'missing', name: 'Missing', gameRoot: '/Games/Missing', missing: true },
    ],
  } as never)
})

afterEach(() => jest.useRealTimers())

it('classifies by actual launch source, including visible cloud launches and unknown local launches', () => {
  expect(gameRunMode(proc(1))).toBe('local')
  recordGameLaunch('/Games/First/www', 'cloud')
  expect(gameRunMode(proc(1))).toBe('cloud')
  recordGameLaunch('/Games/First/www', 'local')
  expect(gameRunMode(proc(1))).toBe('local')
})

it('never applies an old launch source to a replacement process or an expired pending launch', () => {
  recordGameLaunch('/Games/First/www', 'cloud')
  expect(gameRunMode(proc(1))).toBe('cloud')
  expect(gameRunMode(proc(2))).toBe('local')
  recordGameLaunch('/Games/First/www', 'cloud')
  jest.advanceTimersByTime(60_001)
  expect(gameRunMode(proc(3))).toBe('local')
})

it('attaches a matching main process to each playable game and uses the native session room', () => {
  recordGameLaunch('/Games/First/www', 'cloud')
  jest.mocked(findRunningGameProcesses).mockReturnValue([proc(1), proc(2, '/Games/Second/www'), { ...proc(3), isMain: false }])
  jest.mocked(findRgssSessionByPid).mockImplementation((pid) => (pid === 2 ? ({ session: { roomId: 'native-room' } } as never) : undefined))
  expect(playableGamesSnapshot()).toMatchObject({
    selected: '/Games/First',
    library: [
      { id: 'first', running: { mode: 'cloud', pid: 1, roomId: 'first' } },
      { id: 'second', running: { mode: 'local', pid: 2, roomId: 'native-room' } },
    ],
  })
  expect(playableGamesSnapshot().library).toHaveLength(2)
})

it('does not mark other games as running from a helper process or an unresolved root', () => {
  jest.mocked(findRunningGameProcesses).mockReturnValue([{ ...proc(1), isMain: false }, proc(2, '/Games/Other/www')])
  jest.mocked(resolveGame).mockReturnValueOnce({ ok: false } as never)
  expect(playableGamesSnapshot().library.map((game) => game.running)).toEqual([null, null])
})
