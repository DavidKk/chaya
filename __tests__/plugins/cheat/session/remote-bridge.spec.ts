/**
 * @jest-environment jsdom
 */
import { emptySession } from '@/components/game-edit/types'

const setPartyGold = jest.fn()
const setItemCount = jest.fn()
const readLiveSession = jest.fn((prev: unknown) => prev)

jest.mock('@/plugins/src/cheat/session/live-session', () => ({
  buildLiveCatalog: () => ({ ok: true, items: [{ id: 1, name: 'Potion' }] }),
  setPartyGold: (...a: unknown[]) => setPartyGold(...a),
  setItemCount: (...a: unknown[]) => setItemCount(...a),
  readLiveSession: (prev: unknown) => readLiveSession(prev),
}))

const setLock = jest.fn()
const updateLockValue = jest.fn()
const isLocked = jest.fn(() => false)
const ensureHooks = jest.fn()

jest.mock('@/plugins/src/cheat/runtime/cheats', () => ({
  Cheats: {
    ensureHooks: () => ensureHooks(),
    setLock: (...a: unknown[]) => setLock(...a),
    updateLockValue: (...a: unknown[]) => updateLockValue(...a),
    isLocked: (...a: unknown[]) => isLocked(...(a as [])),
  },
}))

const runEnsure = jest.fn()
const setExpRate = jest.fn()

jest.mock('@/plugins/src/cheat/runtime/cheats-run', () => ({
  RunCheats: {
    ensureHooks: () => runEnsure(),
    setExpRate: (...a: unknown[]) => setExpRate(...(a as [number])),
  },
}))

jest.mock('@/plugins/src/cheat/runtime/apply-run', () => ({
  applyRunFlag: jest.fn(),
  applyRunAction: jest.fn(),
  applySpeed: jest.fn(),
  applyGameSpeed: jest.fn(),
}))

import { applyGameSpeed, applyRunAction, applyRunFlag, applySpeed } from '@/plugins/src/cheat/runtime/apply-run'
import { applyEditCmd, handleRemoteEditMessage, stopRemoteEditBridge, syncRemoteMirror } from '@/plugins/src/cheat/session/remote-bridge'

describe('remote-bridge', () => {
  beforeEach(() => {
    stopRemoteEditBridge()
    jest.clearAllMocks()
    ;(globalThis as { $gameParty?: unknown }).$gameParty = {}
    ;(globalThis as { $gameVariables?: { setValue: jest.Mock; value: jest.Mock } }).$gameVariables = {
      setValue: jest.fn(),
      value: jest.fn(),
    }
    ;(globalThis as { $gameSwitches?: { setValue: jest.Mock; value: jest.Mock } }).$gameSwitches = {
      setValue: jest.fn(),
      value: jest.fn(),
    }
  })

  afterEach(() => {
    stopRemoteEditBridge()
    delete (globalThis as { $gameParty?: unknown }).$gameParty
  })

  it('applyEditCmd: gold / count / lock / runFlag / speed', () => {
    applyEditCmd({ type: 'edit.cmd', op: 'gold', value: 100, cmdId: '1' } as never)
    expect(setPartyGold).toHaveBeenCalledWith(100)

    applyEditCmd({ type: 'edit.cmd', op: 'count', kind: 'item', id: 2, value: 9, cmdId: '2' } as never)
    expect(setItemCount).toHaveBeenCalledWith('item', 2, 9)

    applyEditCmd({ type: 'edit.cmd', op: 'goldLock', on: true, value: 50, cmdId: '3' } as never)
    expect(setLock).toHaveBeenCalledWith('gold', 0, true, 50)

    applyEditCmd({ type: 'edit.cmd', op: 'runFlag', key: 'god', value: true, cmdId: '4' } as never)
    expect(applyRunFlag).toHaveBeenCalledWith('god', true)

    applyEditCmd({ type: 'edit.cmd', op: 'runAction', id: 'battle:victory', cmdId: '5' } as never)
    expect(applyRunAction).toHaveBeenCalledWith('battle:victory')

    applyEditCmd({ type: 'edit.cmd', op: 'walkRate', value: 2, cmdId: '6' } as never)
    expect(applySpeed).toHaveBeenCalled()

    applyEditCmd({ type: 'edit.cmd', op: 'expRate', value: 1.5, cmdId: '7' } as never)
    expect(setExpRate).toHaveBeenCalledWith(1.5)
  })

  it('moveRate sets walk and run together; gameSpeed goes to boost', () => {
    applyEditCmd({ type: 'edit.cmd', op: 'moveRate', value: 2.5, cmdId: 'm1' } as never)
    expect(applySpeed).toHaveBeenCalledWith(2.5, 2.5)

    applyEditCmd({ type: 'edit.cmd', op: 'walkRate', value: 3, cmdId: 'm2' } as never)
    expect(applySpeed).toHaveBeenLastCalledWith(3, 2.5)

    applyEditCmd({ type: 'edit.cmd', op: 'gameSpeed', value: 2, cmdId: 'm3' } as never)
    expect(applyGameSpeed).toHaveBeenCalledWith(2)
  })

  it('same cmdId runs side effects once but still acks', () => {
    const send = jest.fn()
    const cmd = { type: 'edit.cmd' as const, op: 'gold' as const, value: 1, cmdId: 'dup-1' }
    handleRemoteEditMessage(cmd, send)
    handleRemoteEditMessage(cmd, send)
    expect(setPartyGold).toHaveBeenCalledTimes(1)
    expect(send.mock.calls.filter((c) => c[0]?.type === 'edit.ack')).toHaveLength(2)
    expect(send.mock.calls.every((c) => c[0]?.type !== 'edit.ack' || c[0]?.ok === true)).toBe(true)
  })

  it('subscribe / unsubscribe control pushes', () => {
    jest.useFakeTimers()
    const send = jest.fn()
    handleRemoteEditMessage({ type: 'edit.subscribe' }, send)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'edit.state', ready: true }))
    send.mockClear()
    jest.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalled()
    handleRemoteEditMessage({ type: 'edit.unsubscribe' }, send)
    send.mockClear()
    jest.advanceTimersByTime(2000)
    expect(send).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('state ready=false when $gameParty is missing', () => {
    ;(globalThis as { $gameParty?: unknown }).$gameParty = undefined
    const send = jest.fn()
    handleRemoteEditMessage({ type: 'edit.subscribe' }, send)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ ready: false }))
  })

  it('syncRemoteMirror pushes while subscribed', () => {
    const send = jest.fn()
    handleRemoteEditMessage({ type: 'edit.subscribe' }, send)
    send.mockClear()
    syncRemoteMirror({ ...emptySession(), gold: 42 })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'edit.state' }))
  })
})

it('delivers the live gold and catalog across independent runtime/editor module copies', () => {
  let runtime!: typeof import('@/plugins/src/helpers/game/edit-link-bridge')
  let editor!: typeof import('@/plugins/src/helpers/game/edit-link-bridge')
  jest.isolateModules(() => {
    runtime = jest.requireActual('@/plugins/src/helpers/game/edit-link-bridge')
  })
  jest.isolateModules(() => {
    editor = jest.requireActual('@/plugins/src/helpers/game/edit-link-bridge')
  })
  Object.assign(globalThis, { $gameParty: {} })
  readLiveSession.mockImplementation((prev) => ({ ...(prev as object), gold: 99961899 }))
  const dispose = editor.registerGameLinkEditHandlers({ onMessage: handleRemoteEditMessage, onStop: stopRemoteEditBridge })
  try {
    const send = jest.fn()
    runtime.dispatchGameLinkEditMessage({ type: 'edit.subscribe' }, send)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'edit.state', session: expect.objectContaining({ gold: 99961899 }) }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'edit.catalog', catalog: expect.objectContaining({ items: [{ id: 1, name: 'Potion' }] }) }))
  } finally {
    runtime.stopGameLinkEditBridge()
    dispose()
    Reflect.deleteProperty(globalThis, '__chayaEditLinkBridge')
    Reflect.deleteProperty(globalThis, '$gameParty')
  }
})
