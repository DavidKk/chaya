/**
 * @jest-environment node
 */
import { emptySession } from '@/components/game-edit/types'
import { diskStateFromSession, mergeDiskIntoSession } from '@/plugins/src/cheat/session/persist'

describe('cheat/persist session↔disk', () => {
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
    expect(disk.hotkeys).toEqual({ 'flag:god': 'KeyG' })
    expect(disk).not.toHaveProperty('gold')
  })

  it('mergeDiskIntoSession: null is a no-op; empty disk hotkeys clear overrides', () => {
    const prev = { ...emptySession(), walkRate: 1, god: false, hotkeys: { 'flag:god': 'KeyG' } }
    expect(mergeDiskIntoSession(prev, null)).toBe(prev)

    const merged = mergeDiskIntoSession(prev, {
      version: 1,
      run: { walkRate: 3, gameSpeed: 2, god: true },
      locks: { 'var:1': 10 },
      hotkeys: {},
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
      hotkeys: { b: '2' },
    })
    expect(merged.hotkeys).toEqual({ b: '2' })
  })

  it('diskStateFromSession does not include hotkeysGlobal', () => {
    const session = {
      ...emptySession(),
      hotkeys: { 'flag:god': 'KeyG' },
      hotkeysGlobal: { 'flag:through': 'KeyT', 'ui:toggle': '`' },
    }
    const disk = diskStateFromSession(session)
    expect(disk.hotkeys).toEqual({ 'flag:god': 'KeyG' })
    expect(disk).not.toHaveProperty('hotkeysGlobal')
  })
})
