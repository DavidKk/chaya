/**
 * @jest-environment jsdom
 */
jest.mock('@/plugins/src/cheat/session/live-session', () => ({
  buildLiveCatalog: () => ({ ok: true, items: [] }),
  setPartyGold: jest.fn(),
  setItemCount: jest.fn(),
  readLiveSession: (prev: unknown) => prev,
}))
jest.mock('@/plugins/src/cheat/runtime/cheats', () => ({
  Cheats: { ensureHooks: jest.fn(), setLock: jest.fn(), updateLockValue: jest.fn(), isLocked: () => false },
}))
jest.mock('@/plugins/src/cheat/runtime/cheats-run', () => ({ RunCheats: { ensureHooks: jest.fn(), setExpRate: jest.fn() } }))
jest.mock('@/plugins/src/cheat/runtime/apply-run', () => ({ applyRunFlag: jest.fn(), applyRunAction: jest.fn(), applySpeed: jest.fn() }))

const runDataCmd = jest.fn()
const handleDataMessage = jest.fn((..._a: unknown[]) => false)
jest.mock('@/plugins/src/cheat/session/save-data-bridge', () => ({
  handleDataMessage: (...a: unknown[]) => handleDataMessage(...a),
  isDataCmd: (cmd: { op: string }) => cmd.op.startsWith('data'),
  runDataCmd: (...a: unknown[]) => runDataCmd(...a),
  sendSized: (send: (m: unknown) => void, msg: unknown) => send(msg),
  stopDataBridge: jest.fn(),
}))

import { handleRemoteEditMessage, stopRemoteEditBridge } from '@/plugins/src/cheat/session/remote-bridge'

describe('remote-bridge data ops', () => {
  beforeEach(() => {
    stopRemoteEditBridge()
    ;(globalThis as { $gameParty?: unknown }).$gameParty = {}
  })

  afterEach(() => {
    stopRemoteEditBridge()
    delete (globalThis as { $gameParty?: unknown }).$gameParty
  })

  it('acks with the op result and replays it for a retried cmdId without re-running', () => {
    runDataCmd.mockReturnValue([{ ok: true }])
    const send = jest.fn()
    const cmd = { type: 'edit.cmd', op: 'dataWrite', items: [], cmdId: 'c1' } as never
    handleRemoteEditMessage(cmd, send)
    handleRemoteEditMessage(cmd, send)
    expect(runDataCmd).toHaveBeenCalledTimes(1)
    const acks = send.mock.calls.map(([m]) => m).filter((m: { type: string }) => m.type === 'edit.ack')
    expect(acks).toHaveLength(2)
    expect(acks[0]).toMatchObject({ ok: true, result: [{ ok: true }] })
    expect(acks[1]).toMatchObject({ ok: true, result: [{ ok: true }] })
  })

  it('acks failures without remembering the cmdId', () => {
    runDataCmd.mockImplementation(() => {
      throw new Error('boom')
    })
    const send = jest.fn()
    const cmd = { type: 'edit.cmd', op: 'dataUndo', cmdId: 'c2' } as never
    handleRemoteEditMessage(cmd, send)
    handleRemoteEditMessage(cmd, send)
    expect(runDataCmd).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'edit.ack', cmdId: 'c2', ok: false }))
  })

  it('routes data.* messages to the data bridge first', () => {
    handleDataMessage.mockReturnValueOnce(true)
    const send = jest.fn()
    handleRemoteEditMessage({ type: 'data.status.request' } as never, send)
    expect(handleDataMessage).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
