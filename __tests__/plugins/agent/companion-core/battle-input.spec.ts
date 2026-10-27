import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import { runAgentCommand } from '@/plugins/mv/src/agent/handlers'
import { createBattleNavigationPort } from '@/plugins/mv/src/agent/runtime/companion-core/battle-input'

jest.mock('@/plugins/mv/src/agent/handlers', () => ({ runAgentCommand: jest.fn() }))
const world = globalThis as unknown as Record<string, unknown>
const keys = ['SceneManager', 'Scene_Battle', 'BattleManager', '$gameMessage', '$gameParty', '$gameTroop']
let previous: unknown[]
let scene: Record<string, unknown>

beforeEach(() => {
  previous = keys.map((k) => world[k])
  scene = { constructor: { name: 'Scene_Battle' }, _actorCommandWindow: { active: true, visible: true, _index: 0, _list: [{ symbol: 'attack', enabled: true }] } }
  world.SceneManager = { _scene: scene }
  world.BattleManager = { actor: () => ({ canUse: () => true }), inputtingAction: () => ({}) }
  world.$gameMessage = {}
  world.$gameParty = {}
  world.$gameTroop = {}
  jest.mocked(runAgentCommand).mockResolvedValue({ scene: 'Scene_Battle', controlToken: 'token-1', battle: { instanceId: 'battle-1' } })
})
afterEach(() =>
  keys.forEach((k, i) => {
    if (previous[i] === undefined) delete world[k]
    else world[k] = previous[i]
  })
)

test('dispatches ordinary guarded input with the shared lease owner and rechecks revocation', async () => {
  const arbiter = createControlArbiter()
  const lease = arbiter.acquire({ runtimeInstanceId: 'inst-1', ownerId: 'companion', scope: 'battle', allowedActions: ['attack'], requestedAt: Date.now() })
  const port = createBattleNavigationPort(arbiter, battleFrame, jest.fn())
  const input = (await port.readInput())!
  expect(input.options).toMatchObject([{ symbol: 'attack', enabled: true }])
  await port.press('ok', input, lease)
  expect(runAgentCommand).toHaveBeenLastCalledWith(
    {
      id: 'companion-input',
      method: 'input.press',
      params: {
        key: 'ok',
        frames: 3,
        guard: {
          controlToken: 'token-1',
          battleInstanceId: 'battle-1',
          allowedEffects: ['navigate', 'battle_command', 'spend_resource'],
        },
      },
    },
    { inputOwner: 'companion' }
  )
  arbiter.revoke(lease, 'manual_takeover')
  await expect(port.press('ok', input, lease)).rejects.toThrow()
  expect(runAgentCommand).toHaveBeenCalledTimes(2)
})

test.each(['message', 'troop event', 'scene busy', 'battle busy', 'custom window', 'multiple windows'])('blocks input during %s', async (kind) => {
  if (kind === 'message') world.$gameMessage = { isBusy: () => true }
  if (kind === 'troop event') world.$gameTroop = { isEventRunning: () => true }
  if (kind === 'scene busy') scene.isBusy = () => true
  if (kind === 'battle busy') world.BattleManager = { isBusy: () => true }
  if (kind === 'custom window') {
    delete scene._actorCommandWindow
    scene._customWindow = { active: true }
  }
  if (kind === 'multiple windows') scene._skillWindow = { active: true }
  const port = createBattleNavigationPort(createControlArbiter(), battleFrame, jest.fn())
  expect(await port.readInput()).toBeNull()
})

test('preserves disabled command options and checks skill usability', async () => {
  scene._actorCommandWindow = { active: true, _index: 0, _list: [{ symbol: 'guard', enabled: false }] }
  const port = createBattleNavigationPort(createControlArbiter(), battleFrame, jest.fn())
  expect((await port.readInput())?.options[0].enabled).toBe(false)
  delete scene._actorCommandWindow
  scene._skillWindow = { active: true, _index: 0, _data: [{ id: 10 }], isEnabled: () => false }
  expect((await port.readInput())?.options[0]).toMatchObject({ abilityId: 10, enabled: false })
})
