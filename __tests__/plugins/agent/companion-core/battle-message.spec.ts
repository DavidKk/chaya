import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import { readAgentGameState, runAgentCommand } from '@/plugins/mv/src/agent/handlers'
import { advanceBattleMessage } from '@/plugins/mv/src/agent/runtime/companion-core/battle-message'

jest.mock('@/plugins/mv/src/agent/handlers', () => ({ readAgentGameState: jest.fn(), runAgentCommand: jest.fn() }))

const world = globalThis as unknown as Record<string, unknown>
const keys = ['SceneManager', 'BattleManager', '$gameMessage', '$gameTroop']
let previous: unknown[]
let scene: Record<string, unknown>
let message: Record<string, unknown>
let win: Record<string, unknown>

beforeEach(() => {
  previous = keys.map((key) => world[key])
  win = { pause: true, visible: true, openness: 255, isAnySubWindowActive: () => false }
  scene = { constructor: { name: 'Scene_Battle' }, _messageWindow: win }
  message = { isBusy: () => true, isChoice: () => false, isNumberInput: () => false, isItemChoice: () => false }
  world.SceneManager = { _scene: scene }
  world.BattleManager = { _phase: 'start' }
  world.$gameTroop = { isEventRunning: () => false }
  world.$gameMessage = message
  jest
    .mocked(readAgentGameState)
    .mockReturnValue({ scene: 'Scene_Battle', controlToken: 't', battle: { instanceId: 'b' }, message: { busy: true } } as ReturnType<typeof readAgentGameState>)
  jest.mocked(runAgentCommand).mockResolvedValue({})
})
afterEach(() => {
  keys.forEach((key, i) => {
    if (previous[i] === undefined) delete world[key]
    else world[key] = previous[i]
  })
})

function setup() {
  const arbiter = createControlArbiter()
  const lease = arbiter.acquire({ runtimeInstanceId: 'test', ownerId: 'companion', scope: 'battle', allowedActions: ['attack'], requestedAt: Date.now() })
  return { arbiter, lease }
}

test.each(['start', 'battleEnd'])('confirms paused standard narration in phase %s through guarded input', async (phase) => {
  world.BattleManager = { _phase: phase }
  const { arbiter, lease } = setup()
  await advanceBattleMessage(arbiter, lease)
  expect(runAgentCommand).toHaveBeenCalledWith(
    {
      id: 'companion-battle-message',
      method: 'input.press',
      params: { key: 'ok', frames: 3, guard: { controlToken: 't', battleInstanceId: 'b', allowedEffects: ['advance_dialogue'] } },
    },
    { inputOwner: 'companion', control: { arbiter, lease }, beforeInput: expect.any(Function) }
  )
  const beforeInput = jest.mocked(runAgentCommand).mock.calls[0][1]!.beforeInput!
  expect(() => beforeInput()).not.toThrow()
  arbiter.revoke(lease, 'manual_takeover')
  expect(() => beforeInput()).toThrow()
})

test.each(['choice', 'number', 'item', 'event', 'map', 'turn', 'printing', 'opening', 'subwindow', 'inactive'])('does not advance %s', (kind) => {
  if (kind === 'choice') message.isChoice = () => true
  if (kind === 'number') message.isNumberInput = () => true
  if (kind === 'item') message.isItemChoice = () => true
  if (kind === 'event') world.$gameTroop = { isEventRunning: () => true }
  if (kind === 'map') scene.constructor = { name: 'Scene_Map' }
  if (kind === 'turn') world.BattleManager = { _phase: 'turn' }
  if (kind === 'printing') win.pause = false
  if (kind === 'opening') win.openness = 224
  if (kind === 'subwindow') win.isAnySubWindowActive = () => true
  if (kind === 'inactive') (world.SceneManager as Record<string, unknown>).isGameActive = () => false
  const { arbiter, lease } = setup()
  expect(advanceBattleMessage(arbiter, lease)).toBeNull()
  expect(runAgentCommand).not.toHaveBeenCalled()
})

test('rechecks message eligibility immediately before input', async () => {
  const { arbiter, lease } = setup()
  await advanceBattleMessage(arbiter, lease)
  const beforeInput = jest.mocked(runAgentCommand).mock.calls[0][1]!.beforeInput!
  message.isChoice = () => true
  expect(() => beforeInput()).toThrow('BATTLE_MESSAGE_CHANGED')
})
