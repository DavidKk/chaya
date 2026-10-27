import { battleFrame } from '@/__tests__/lib/game-agent/companion/core/fixtures'
import { chooseAction } from '@/lib/game-agent/companion/core/action-selector'
import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import { evaluateSituation } from '@/lib/game-agent/companion/core/situation'
import { DEFAULT_TACTIC_PLAN } from '@/lib/game-agent/companion/core/tactics'
import { type BattleInputState, type BattleNavigationPort, BattleNavigator } from '@/plugins/mv/src/agent/runtime/companion-core/battle-navigator'

function fixture() {
  const arbiter = createControlArbiter()
  const lease = arbiter.acquire({ runtimeInstanceId: 'inst-1', ownerId: 'test', scope: 'battle', allowedActions: ['attack'], requestedAt: Date.now() })
  const frame = battleFrame()
  const selection = chooseAction(frame, evaluateSituation(frame), DEFAULT_TACTIC_PLAN)
  if (selection.kind !== 'action') throw new Error('Expected attack')
  const action = { setAttack: jest.fn(), setGuard: jest.fn(), setTarget: jest.fn() }
  let input: BattleInputState | null = {
    controlToken: 'token',
    battleInstanceId: 'battle',
    kind: 'command',
    index: 0,
    maxCols: 1,
    options: [{ index: 0, enabled: true, symbol: 'attack' }],
    action,
  }
  const press = jest.fn(async () => {})
  const port: BattleNavigationPort = { readFrame: () => frame, readInput: async () => input, press, bindAction: jest.fn(), onConfirming: jest.fn() }
  return {
    arbiter,
    lease,
    frame,
    action,
    press,
    port,
    intent: selection.intent,
    setInput: (next: BattleInputState | null) => {
      input = next
    },
    navigator: new BattleNavigator(arbiter, port),
  }
}

test('uses menu inputs and confirms advancing a second slot on the same actor', async () => {
  const f = fixture()
  f.press.mockImplementation(async () => {
    if (f.press.mock.calls.length === 1)
      f.setInput({
        controlToken: 'target',
        battleInstanceId: 'battle',
        kind: 'enemy',
        index: 0,
        maxCols: 1,
        options: [{ index: 0, enabled: true, entityId: 10, instanceId: 'enemy:0' }],
        action: f.action,
      })
    else f.frame.opportunity = { ...f.frame.opportunity!, actionSlot: 1, opportunityId: 'slot:1' }
  })
  await expect(f.navigator.execute(f.intent, f.lease)).resolves.toEqual({ ok: true, committed: true })
  expect(f.press.mock.calls.map((args) => (args as unknown[])[0])).toEqual(['ok', 'ok'])
  expect(f.action.setAttack).not.toHaveBeenCalled()
  expect(f.action.setTarget).not.toHaveBeenCalled()
  expect(f.port.bindAction).toHaveBeenCalledWith(f.action, f.intent, expect.anything())
  expect(f.port.bindAction).toHaveBeenCalledTimes(1)
})

test('never repeats a confirmation whose menu has not advanced', async () => {
  const f = fixture()
  await expect(f.navigator.execute(f.intent, f.lease)).resolves.toMatchObject({ ok: false, unknown: true })
  expect(f.press).toHaveBeenCalledTimes(1)
  expect(f.port.bindAction).not.toHaveBeenCalled()
})

test.each(['blocked', 'disabled', 'unknown'] as const)('sends no input for a %s window', async (kind) => {
  const f = fixture()
  if (kind === 'blocked') f.setInput(null)
  else
    f.setInput({
      controlToken: 't',
      battleInstanceId: 'b',
      kind: kind === 'unknown' ? 'skill' : 'command',
      index: 0,
      maxCols: 1,
      options: [{ index: 0, enabled: false, symbol: 'attack', abilityId: 50 }],
    })
  await expect(f.navigator.execute(f.intent, f.lease)).resolves.toMatchObject({ ok: false, unknown: false })
  expect(f.press).not.toHaveBeenCalled()
})

test('checks the lease after async observation and before each input', async () => {
  const f = fixture()
  const original = f.port.readInput
  f.port.readInput = async () => {
    const input = await original()
    f.arbiter.revoke(f.lease, 'manual_takeover')
    return input
  }
  await expect(f.navigator.execute(f.intent, f.lease)).resolves.toMatchObject({ ok: false })
  expect(f.press).not.toHaveBeenCalled()
})

test('does not confirm a target after manual takeover between input segments', async () => {
  const f = fixture()
  f.press.mockImplementation(async () => {
    f.arbiter.revoke(f.lease, 'manual_takeover')
  })
  await expect(f.navigator.execute(f.intent, f.lease)).resolves.toMatchObject({ ok: false, unknown: true })
  expect(f.press).toHaveBeenCalledTimes(1)
})

test('rejects a context switch during async observation even if slot IDs are reused', async () => {
  const f = fixture()
  const original = f.port.readInput
  f.port.readInput = async () => {
    const input = await original()
    f.frame.stamp.contextEpoch++
    return input
  }
  await expect(f.navigator.execute(f.intent, f.lease)).resolves.toMatchObject({ ok: false, reason: 'STATE_CHANGED' })
  expect(f.press).not.toHaveBeenCalled()
})
