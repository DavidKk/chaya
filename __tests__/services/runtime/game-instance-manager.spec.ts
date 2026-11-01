import { findRunningGameProcesses, terminateAllRunningGameProcesses } from '@/services/game/game-process'
import { checkAndReclaimIdleInstances, DEFAULT_IDLE_TIMEOUT_SECONDS, listCloudGameInstances } from '@/services/runtime/game-instance-manager'
import { resetSignalingRoom } from '@/services/runtime/webrtc-signaling'

jest.mock('@/services/game/binding', () => ({ getResolvedFromConfig: () => ({ ok: false }) }))
jest.mock('@/services/game/config', () => ({ loadConfig: () => ({ library: [] }) }))
jest.mock('@/services/game/game-process', () => ({
  findRunningGameProcesses: jest.fn(() => []),
  terminateAllRunningGameProcesses: jest.fn(async () => ({ killed: [101] })),
}))
jest.mock('@/services/game/library', () => ({
  displayNameFromPath: (root: string) => root,
  findLibraryEntry: () => undefined,
}))
jest.mock('@/services/game/rgss-runtime', () => ({ rgssRuntimeStatus: () => ({}) }))
jest.mock('@/services/runtime/agent-bridge', () => ({ listAgentGames: () => [] }))

jest.mock('@/services/runtime/game-preview', () => ({ clearGamePreviews: jest.fn() }))
jest.mock('@/services/runtime/playable-games', () => ({ gameRunMode: (proc: { pid: number }) => (proc.pid === 101 ? 'cloud' : 'local') }))
jest.mock('@/services/runtime/webrtc-signaling', () => ({
  listAllSignalingRooms: () => [],
  resetSignalingRoom: jest.fn(),
}))

beforeEach(() => {
  jest.useFakeTimers({ now: 100_000 })
  jest.clearAllMocks()
  const global = globalThis as typeof globalThis & { __chaya_game_instances_state_v1__?: Map<string, unknown> }
  global.__chaya_game_instances_state_v1__?.clear()
  jest.mocked(findRunningGameProcesses).mockReturnValue([
    { pid: 101, command: 'nwjs', isMain: true, contentRoot: '/Games/Cloud' },
    { pid: 102, command: 'nwjs', isMain: true, contentRoot: '/Games/Local' },
  ])
})

afterEach(() => jest.useRealTimers())

it('lists launch provenance and initial idle countdowns without touching a real process', () => {
  expect(listCloudGameInstances()).toMatchObject([
    { pid: 101, runMode: 'cloud', idleSeconds: 0, remainingIdleSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS },
    { pid: 102, runMode: 'local', idleSeconds: 0 },
  ])
})

it('reclaims expired cloud games while preserving local games without a remote connection', async () => {
  await checkAndReclaimIdleInstances()
  expect(terminateAllRunningGameProcesses).not.toHaveBeenCalled()
  jest.advanceTimersByTime((DEFAULT_IDLE_TIMEOUT_SECONDS + 1) * 1000)
  await expect(checkAndReclaimIdleInstances()).resolves.toEqual({ reclaimed: [101] })
  expect(terminateAllRunningGameProcesses).toHaveBeenCalledTimes(1)
  expect(terminateAllRunningGameProcesses).toHaveBeenCalledWith('/Games/Cloud')
  expect(resetSignalingRoom).toHaveBeenCalledTimes(1)
})

it('disables reclamation when idle timeout is configured to 0', async () => {
  jest.advanceTimersByTime((DEFAULT_IDLE_TIMEOUT_SECONDS + 10) * 1000)
  await expect(checkAndReclaimIdleInstances(0)).resolves.toEqual({ reclaimed: [] })
  expect(terminateAllRunningGameProcesses).not.toHaveBeenCalled()
})
