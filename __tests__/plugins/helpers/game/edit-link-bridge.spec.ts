import type * as Bridge from '@/plugins/src/helpers/game/edit-link-bridge'

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__chayaEditLinkBridge')
})
function separateCopies() {
  let runtime!: typeof Bridge
  let edit!: typeof Bridge
  jest.isolateModules(() => {
    runtime = jest.requireActual('@/plugins/src/helpers/game/edit-link-bridge')
  })
  jest.isolateModules(() => {
    edit = jest.requireActual('@/plugins/src/helpers/game/edit-link-bridge')
  })
  return { runtime, edit }
}
test('separately bundled runtime and editor share subscription and state delivery', () => {
  const { runtime, edit } = separateCopies()
  const send = jest.fn()
  edit.registerGameLinkEditHandlers({
    onMessage: (msg, reply) => {
      if (msg.type === 'edit.subscribe') reply({ type: 'edit.state', ready: true, session: { gold: 99961899 } } as never)
    },
    onStop: jest.fn(),
  })
  runtime.dispatchGameLinkEditMessage({ type: 'edit.subscribe' }, send)
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ session: { gold: 99961899 } }))
})
test('late editor loading and hot replacement replay the active subscription', () => {
  const { runtime, edit } = separateCopies()
  const send = jest.fn()
  runtime.dispatchGameLinkEditMessage({ type: 'edit.subscribe' }, send)
  const first = { onMessage: jest.fn(), onStop: jest.fn() }
  const dispose = edit.registerGameLinkEditHandlers(first)
  expect(first.onMessage).toHaveBeenCalledWith({ type: 'edit.subscribe' }, send)
  const second = { onMessage: jest.fn(), onStop: jest.fn() }
  edit.registerGameLinkEditHandlers(second)
  dispose()
  runtime.dispatchGameLinkEditMessage({ type: 'ping', t: 1 }, send)
  expect(second.onMessage).toHaveBeenCalledWith({ type: 'ping', t: 1 }, send)
  runtime.stopGameLinkEditBridge()
  expect(second.onStop).toHaveBeenCalledTimes(1)
  const third = { onMessage: jest.fn(), onStop: jest.fn() }
  edit.registerGameLinkEditHandlers(third)
  expect(third.onMessage).not.toHaveBeenCalled()
})
