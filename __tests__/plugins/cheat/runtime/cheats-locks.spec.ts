/** @jest-environment jsdom */
import { Cheats } from '@/plugins/mv/src/cheat/runtime/cheats'

jest.mock('@/plugins/mv/src/cheat/runtime/cheats-run', () => ({ RunCheats: { ensureHooks: () => {}, disposeHooks: () => {} } }))

const g = globalThis as Record<string, any>

beforeEach(() => {
  jest.useFakeTimers()
  g.$gameParty = { members: () => [] }
})

afterEach(() => {
  Cheats.disposeHooks()
  jest.useRealTimers()
  delete g.$gameActors
  delete g.$gameParty
})

test('restores locked TP after the battle changes it', () => {
  const actor = {
    tp: 20,
    maxTp: () => 100,
    setTp: jest.fn((value: number) => {
      actor.tp = value
    }),
  }
  g.$gameActors = { actor: () => actor }

  Cheats.setLock('tp', 5, true, 20)
  expect(Cheats.lockValue('tp', 5)).toBe(20)

  actor.tp = 7
  jest.advanceTimersByTime(200)

  expect(actor.setTp).toHaveBeenCalledWith(20)
  expect(actor.tp).toBe(20)
})

test('stops restoring TP after the lock is removed', () => {
  const actor = {
    tp: 20,
    maxTp: () => 100,
    setTp: jest.fn((value: number) => {
      actor.tp = value
    }),
  }
  g.$gameActors = { actor: () => actor }

  Cheats.setLock('tp', 5, true, 20)
  Cheats.setLock('tp', 5, false)
  actor.tp = 7
  jest.advanceTimersByTime(200)

  expect(actor.setTp).not.toHaveBeenCalled()
  expect(actor.tp).toBe(7)
})
