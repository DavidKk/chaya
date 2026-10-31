import { emptySession } from '@/components/game-edit/types'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'
import { createRgssFloatingBallRuntime } from '@/plugins/rgss/src/floating-ball-runtime'
import { onGameMessage, postToGame, restoreGameFocus } from '@/plugins/rgss/src/host-bridge'

jest.mock('@/plugins/rgss/src/host-bridge', () => ({ onGameMessage: jest.fn(), postToGame: jest.fn(), restoreGameFocus: jest.fn() }))
let receive: (message: GameLinkMessage) => void
const send = jest.mocked(postToGame)
const state = (autoBattle = false, inBattle = false): GameLinkMessage => ({ type: 'edit.state', ready: true, inBattle, session: { ...emptySession(), autoBattle } })

beforeEach(() => {
  jest.useFakeTimers()
  jest.mocked(onGameMessage).mockImplementation((handler) => {
    receive = handler
    return jest.fn()
  })
})
afterEach(() => jest.useRealTimers())

it('returns native keyboard focus to the game when dismissed', () => {
  const onClose = jest.fn()
  const bridge = createRgssFloatingBallRuntime(onClose, (key) => key)
  bridge.runtime.restoreFocus?.()
  expect(onClose).toHaveBeenCalled()
  expect(restoreGameFocus).toHaveBeenCalled()
  bridge.dispose()
})

it('uses fresh Ruby state to toggle and waits for both acknowledgement and resulting state', async () => {
  const bridge = createRgssFloatingBallRuntime(jest.fn(), (key) => key)
  receive(state())
  const execute = bridge.runtime.execute('flag:autoBattle') as Promise<void>
  receive(state(true))
  await Promise.resolve()
  const packet = send.mock.calls.map(([message]) => message).find((message) => message.type === 'edit.cmd')!
  expect(packet).toMatchObject({ type: 'edit.cmd', op: 'runFlag', key: 'autoBattle', value: false })
  if (packet.type !== 'edit.cmd') throw new Error('Missing command')
  let complete = false
  void execute.then(() => {
    complete = true
  })
  receive({ type: 'edit.ack', cmdId: packet.cmdId, ok: true, fields: ['autoBattle'] })
  await Promise.resolve()
  expect(complete).toBe(false)
  receive(state(false))
  await execute
  expect(bridge.runtime.read()).toMatchObject({ flags: { autoBattle: false } })
  bridge.dispose()
})

it('does not send battle actions outside battle and exposes unsupported functions', async () => {
  const bridge = createRgssFloatingBallRuntime(jest.fn(), (key) => key)
  expect(bridge.runtime.supports?.('flag:god')).toBe(false)
  expect(bridge.runtime.supports?.('action:scene:item')).toBe(true)
  const execute = bridge.runtime.execute('action:battle:victory') as Promise<void>
  receive(state())
  await expect(execute).rejects.toThrow('floatingBall.needBattle')
  expect(send.mock.calls.some(([message]) => message.type === 'edit.cmd')).toBe(false)
  bridge.dispose()
})

it('reports a failed acknowledgement without pretending the flag changed', async () => {
  const bridge = createRgssFloatingBallRuntime(jest.fn(), (key) => key)
  const execute = bridge.runtime.execute('flag:autoBattle') as Promise<void>
  receive(state())
  await Promise.resolve()
  const packet = send.mock.calls.map(([message]) => message).find((message) => message.type === 'edit.cmd')!
  if (packet.type !== 'edit.cmd') throw new Error('Missing command')
  receive({ type: 'edit.ack', cmdId: packet.cmdId, ok: false, error: 'Ruby refused', fields: [] })
  await expect(execute).rejects.toThrow('Ruby refused')
  expect(bridge.runtime.read()).toMatchObject({ flags: { autoBattle: false } })
  bridge.dispose()
})

it('treats stale state as unavailable and rejects pending requests on disposal', async () => {
  const bridge = createRgssFloatingBallRuntime(jest.fn(), (key) => key)
  receive(state())
  jest.advanceTimersByTime(4000)
  expect(bridge.runtime.read()).toMatchObject({ ready: false })
  const execute = bridge.runtime.execute('flag:autoBattle') as Promise<void>
  bridge.dispose()
  await expect(execute).rejects.toThrow('floatingBall.notReady')
  expect(jest.getTimerCount()).toBe(0)
})
