/** @jest-environment jsdom */
import { createControlArbiter } from '@/lib/game-agent/companion/core/control-arbiter'
import { installAgentControl } from '@/plugins/mv/src/agent/control'
import { runAgentCommand } from '@/plugins/mv/src/agent/handlers'
import { runWithTaskControl } from '@/plugins/mv/src/agent/runtime/task-control'

const world = globalThis as unknown as Record<string, unknown>
let arbiter: ReturnType<typeof createControlArbiter>
let uninstall: () => void
const keys = ['Input', 'ChayaEdit', 'SceneManager', '$gameParty', 'Graphics', 'TouchInput', '$gameTemp']
let originals: unknown[]

beforeEach(() => {
  jest.useFakeTimers()
  originals = keys.map((key) => world[key])
  world.Input = { _currentState: {} }
  arbiter = createControlArbiter()
  uninstall = installAgentControl(arbiter, 'instance')
})
afterEach(() => {
  arbiter.revokeCurrent('user_stop')
  uninstall()
  keys.forEach((key, index) => {
    if (originals[index] === undefined) delete world[key]
    else world[key] = originals[index]
  })
  document.body.innerHTML = ''
  jest.useRealTimers()
})
const acquire = (ownerId = 'task') => arbiter.acquire({ runtimeInstanceId: 'instance', ownerId, scope: 'game', allowedActions: ['*'], requestedAt: Date.now() })

test('serializes edit and save mutations with play tasks while allowing observation', async () => {
  const apply = jest.fn()
  world.ChayaEdit = { agentEdit: { apply } }
  const lease = acquire()
  await expect(runAgentCommand({ id: 'edit', method: 'edit.apply', params: { op: {} } } as never)).rejects.toMatchObject({ code: 'CONTROL_BUSY' })
  await expect(runAgentCommand({ id: 'load', method: 'game.saves', params: { op: 'nativeLoad', slot: 1 } })).rejects.toMatchObject({ code: 'CONTROL_BUSY' })
  await expect(runAgentCommand({ id: 'observe', method: 'game.state', params: {} })).resolves.toHaveProperty('controlToken')
  expect(apply).not.toHaveBeenCalled()
  arbiter.revoke(lease, 'user_stop')
  await expect(runAgentCommand({ id: 'late', method: 'input.press', params: { key: 'ok' } }, { inputOwner: 'task' })).rejects.toThrow('CONTROL_REVOKED')
  expect(arbiter.currentLease()).toBeNull()
})

test('releases held keys immediately and prevents the rest of a revoked sequence', async () => {
  const lease = acquire()
  const beforeInput = jest.fn()
  const keysDown: string[] = []
  const listen = (event: KeyboardEvent) => keysDown.push(event.key)
  document.addEventListener('keydown', listen)
  try {
    const result = runAgentCommand(
      { id: 'sequence', method: 'input.sequence', params: { steps: [{ key: 'right', frames: 600 }, { key: 'ok' }] } },
      { inputOwner: 'task', beforeInput }
    )
    const check = expect(result).rejects.toThrow()
    expect((world.Input as { _currentState: Record<string, boolean> })._currentState.right).toBe(true)
    expect(beforeInput).toHaveBeenCalledTimes(1)
    arbiter.revoke(lease, 'user_stop')
    expect((world.Input as { _currentState: Record<string, boolean> })._currentState.right).toBe(false)
    expect(() => acquire('other')).toThrow()
    await jest.advanceTimersByTimeAsync(200)
    await check
    expect(keysDown).toEqual(['ArrowRight'])
    expect(acquire('other').ownerId).toBe('other')
  } finally {
    document.removeEventListener('keydown', listen)
  }
})

test.each(['press', 'release'] as const)('revokes guarded input while waiting for the engine to sample its %s', async (phase) => {
  const input = { _currentState: {} as Record<string, boolean>, _previousState: {} as Record<string, boolean> }
  world.Input = input
  world.SceneManager = { _scene: { constructor: { name: 'Scene_Battle' } } }
  const lease = acquire()
  const state = (await runAgentCommand({ id: 'state', method: 'game.state', params: {} })) as { controlToken: string }
  const result = runAgentCommand(
    { id: 'press', method: 'input.press', params: { key: 'ok', frames: 3, guard: { controlToken: state.controlToken, allowedEffects: ['unknown'] } } },
    { inputOwner: 'task' }
  )
  if (phase === 'release') input._previousState.ok = true
  await jest.advanceTimersByTimeAsync(90)
  expect(input._currentState.ok).toBe(phase === 'press')
  arbiter.revoke(lease, 'user_stop')
  expect(input._currentState.ok).toBe(false)
  if (phase === 'release') {
    const failed = expect(result).rejects.toMatchObject({ code: 'LEASE_EXPIRED' })
    await jest.advanceTimersByTimeAsync(20)
    await failed
  } else {
    await jest.advanceTimersByTimeAsync(60)
    await result
  }
  expect(acquire('next').ownerId).toBe('next')
})

test('fails a guarded release that the engine never samples without replaying the key', async () => {
  const input = { _currentState: {} as Record<string, boolean>, _previousState: { ok: false } }
  world.Input = input
  world.SceneManager = { _scene: { constructor: { name: 'Scene_Battle' } } }
  acquire()
  const state = (await runAgentCommand({ id: 'state', method: 'game.state', params: {} })) as { controlToken: string }
  const result = runAgentCommand(
    { id: 'press', method: 'input.press', params: { key: 'ok', frames: 3, guard: { controlToken: state.controlToken, allowedEffects: ['unknown'] } } },
    { inputOwner: 'task' }
  )
  input._previousState.ok = true
  const failed = expect(result).rejects.toThrow('INPUT_RELEASE_UNCONFIRMED')
  await jest.advanceTimersByTimeAsync(1_150)
  await failed
  expect(input._currentState.ok).toBe(false)
})

test('cancels a mouse hold and its map destination on revocation', async () => {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect)
  const up = jest.fn()
  const down = jest.fn()
  world.Graphics = { width: 100, height: 100, _canvas: canvas }
  world.TouchInput = { _onMouseDown: down, _onMouseUp: up }
  world.$gameTemp = { _destinationX: 1, _destinationY: 1, isDestinationValid: () => true }
  const lease = acquire()
  const result = runAgentCommand({ id: 'tap', method: 'input.tap', params: { x: 50, y: 50, frames: 120 } }, { inputOwner: 'task' })
  expect(down).toHaveBeenCalledTimes(1)
  arbiter.revoke(lease, 'manual_takeover')
  expect(up).toHaveBeenCalledTimes(1)
  expect(world.$gameTemp).toMatchObject({ _destinationX: null, _destinationY: null })
  await result
  expect(up).toHaveBeenCalledTimes(1)
  expect(acquire('next').ownerId).toBe('next')
})

test('holds revoked authority until an in-flight mutation settles', async () => {
  let finish!: () => void
  world.__controlMutation = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  try {
    const lease = acquire()
    const result = runAgentCommand({ id: 'mutation', method: 'game.eval', params: { code: 'return globalThis.__controlMutation()' } }, { allowEval: true, inputOwner: 'task' })
    arbiter.revoke(lease, 'user_stop')
    expect(() => acquire('new')).toThrow()
    finish()
    await result
    expect(acquire('new').ownerId).toBe('new')
  } finally {
    delete world.__controlMutation
  }
})

test('task abort revokes synchronously and late callbacks cannot reacquire', async () => {
  const abort = new AbortController()
  let finish!: () => void
  const execute = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const result = runWithTaskControl(arbiter, 'instance', { id: 'task', capability: 'play' }, abort.signal, execute)
  expect(arbiter.currentLease()?.ownerId).toBe('task')
  abort.abort()
  expect(arbiter.currentLease()).toBeNull()
  const next = acquire('new')
  finish()
  await result
  expect(arbiter.isCurrent(next)).toBe(true)
  await expect(runAgentCommand({ id: 'late', method: 'input.press', params: { key: 'ok' } }, { inputOwner: 'task' })).rejects.toThrow('CONTROL_REVOKED')
})
