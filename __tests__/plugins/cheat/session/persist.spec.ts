/**
 * @jest-environment node
 */
import { emptySession } from '@/components/game-edit/types'
import { applyRunFlag } from '@/plugins/mv/src/cheat/runtime/apply-run'
import { Cheats } from '@/plugins/mv/src/cheat/runtime/cheats'
import { RunCheats } from '@/plugins/mv/src/cheat/runtime/cheats-run'
import {
  applyGameEditDisk,
  diskStateFromSession,
  ensureGameEditDiskApplied,
  mergeDiskIntoSession,
  scheduleSaveGameEditDisk,
  scheduleSaveRunFlag,
} from '@/plugins/mv/src/cheat/session/persist'
import { pluginStorageCall } from '@/plugins/mv/src/helpers/storage/client'

jest.mock('@/plugins/mv/src/helpers/storage/client', () => ({ pluginPublicGameDirectory: jest.fn(), pluginStorageCall: jest.fn() }))
jest.mock('@/plugins/mv/src/helpers/game/game-identity', () => ({ detectGameIdentity: () => ({ contentRoot: '/test/game' }) }))
jest.mock('@/plugins/mv/src/cheat/runtime/apply-run', () => ({ applyRunFlag: jest.fn(), applySpeed: jest.fn(), applyGameSpeed: jest.fn() }))

describe('cheat/persist session↔disk', () => {
  it('enables dash and result confirmation by default while preserving explicit opt-outs', () => {
    expect(emptySession()).toMatchObject({ alwaysDash: true, skipBattleResult: true })
    Object.assign(globalThis, { $gameParty: {} })
    jest.spyOn(Cheats, 'ensureHooks').mockImplementation(() => {})
    jest.spyOn(RunCheats, 'ensureHooks').mockImplementation(() => {})
    const disk = diskStateFromSession(emptySession())
    applyGameEditDisk({ ...disk, run: {} })
    expect(applyRunFlag).toHaveBeenCalledWith('alwaysDash', true)
    expect(applyRunFlag).toHaveBeenCalledWith('skipBattleResult', true)
    jest.mocked(applyRunFlag).mockClear()
    applyGameEditDisk({ ...disk, run: { alwaysDash: false, skipBattleResult: false } })
    expect(applyRunFlag).toHaveBeenCalledWith('alwaysDash', false)
    expect(applyRunFlag).toHaveBeenCalledWith('skipBattleResult', false)
    delete (globalThis as Record<string, unknown>).$gameParty
  })

  it('applies defaults on a fresh game without a settings file', () => {
    const { pluginPublicGameDirectory } = jest.requireMock('@/plugins/mv/src/helpers/storage/client')
    pluginPublicGameDirectory.mockReturnValue('/test/game/chaya')
    Object.assign(globalThis, { $gameParty: {} })
    jest.spyOn(Cheats, 'ensureHooks').mockImplementation(() => {})
    jest.spyOn(RunCheats, 'ensureHooks').mockImplementation(() => {})
    ensureGameEditDiskApplied()
    expect(applyRunFlag).toHaveBeenCalledWith('alwaysDash', true)
    expect(applyRunFlag).toHaveBeenCalledWith('skipBattleResult', true)
    delete (globalThis as Record<string, unknown>).$gameParty
  })
  it('merges successive floating shortcuts with a pending save without replacing locks, speeds or hotkeys', () => {
    jest.useFakeTimers()
    const disk = diskStateFromSession({ ...emptySession(), walkRate: 3, locks: { 'item:1': 80 }, hotkeys: { 'flag:autoWin': 'KeyW' } })
    scheduleSaveGameEditDisk(disk)
    scheduleSaveRunFlag('autoBattle', true)
    scheduleSaveRunFlag('autoWin', true)
    jest.advanceTimersByTime(400)
    expect(pluginStorageCall).toHaveBeenCalledWith('game.write', [
      '/test/game',
      'gameEdit',
      expect.objectContaining({
        run: expect.objectContaining({ walkRate: 3, autoBattle: true, autoWin: true }),
        locks: { 'item:1': 80 },
        hotkeys: disk.hotkeys,
      }),
    ])
    jest.useRealTimers()
  })

  it('diskStateFromSession only extracts persistable fields', () => {
    const session = {
      ...emptySession(),
      gold: 999,
      walkRate: 2,
      gameSpeed: 3,
      god: true,
      locks: { 'item:1': 3 },
      hotkeys: { 'flag:god': 'KeyG' },
    }
    const disk = diskStateFromSession(session)
    expect(disk.version).toBe(1)
    expect(disk.run.walkRate).toBe(2)
    expect(disk.run.gameSpeed).toBe(3)
    expect(disk.run.god).toBe(true)
    expect(disk.locks).toEqual({ 'item:1': 3 })
    expect(disk.hotkeys.game.bindings).toEqual({ 'flag:god': 'KeyG' })
    expect(disk).not.toHaveProperty('gold')
  })

  it('mergeDiskIntoSession: null is a no-op; empty disk hotkeys clear overrides', () => {
    const prev = { ...emptySession(), walkRate: 1, god: false, hotkeys: { 'flag:god': 'KeyG' } }
    expect(mergeDiskIntoSession(prev, null)).toBe(prev)

    const merged = mergeDiskIntoSession(prev, {
      version: 1,
      run: { walkRate: 3, gameSpeed: 2, god: true },
      locks: { 'var:1': 10 },
      hotkeys: {
        version: 1,
        global: { revision: 0, bindings: {}, disabled: [] },
        game: { gameId: 'default', revision: 0, bindings: null },
      },
    })
    expect(merged.walkRate).toBe(3)
    expect(merged.gameSpeed).toBe(2)
    expect(merged.god).toBe(true)
    expect(merged.locks['var:1']).toBe(10)
    expect(merged.hotkeys).toEqual({})
  })

  it('merge: disk hotkeys replace the whole map', () => {
    const prev = { ...emptySession(), hotkeys: { a: '1' } }
    const merged = mergeDiskIntoSession(prev, {
      version: 1,
      run: {},
      locks: {},
      hotkeys: {
        version: 1,
        global: { revision: 1, bindings: { 'flag:through': 'KeyT' }, disabled: [] },
        game: { gameId: 'default', revision: 1, bindings: { 'flag:god': 'KeyG' } },
      },
    })
    expect(merged.hotkeys).toEqual({ 'flag:god': 'KeyG' })
    expect(merged.hotkeysGlobal).toEqual({ 'flag:through': 'KeyT' })
  })

  it('diskStateFromSession persists both version domains', () => {
    const session = {
      ...emptySession(),
      hotkeys: { 'flag:god': 'KeyG' },
      hotkeysGlobal: { 'flag:through': 'KeyT', 'ui:toggle': '`' },
    }
    const disk = diskStateFromSession(session)
    expect(disk.hotkeys.game.bindings).toEqual({ 'flag:god': 'KeyG' })
    expect(disk.hotkeys.global.bindings).toEqual({ 'flag:through': 'KeyT', 'ui:toggle': '`' })
  })
})
