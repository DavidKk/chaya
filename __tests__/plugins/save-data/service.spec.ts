/**
 * @jest-environment jsdom
 */
import type { DataUndoResult, DataWriteResult } from '@/lib/game/save-data'

import { installWorld, removeWorld, type World } from './fixture'

const isLocked = jest.fn((..._a: unknown[]) => false)
const updateLockValue = jest.fn()
jest.mock('@/plugins/src/cheat/runtime/cheats', () => ({
  Cheats: { isLocked: (...a: unknown[]) => isLocked(...a), updateLockValue: (...a: unknown[]) => updateLockValue(...a) },
}))
jest.mock('@/plugins/src/cheat/session/live-events', () => ({ loadedMapData: () => null }))

type Service = typeof import('@/plugins/src/cheat/session/save-data').SaveData

let world: World
let SaveData: Service

beforeEach(async () => {
  jest.useFakeTimers()
  jest.resetModules()
  isLocked.mockReturnValue(false)
  world = installWorld()
  SaveData = (await import('@/plugins/src/cheat/session/save-data')).SaveData
  SaveData.checkGen()
})

afterEach(() => {
  SaveData.dispose()
  removeWorld(world)
  jest.useRealTimers()
})

const write = (items: Parameters<Service['run']>[0] & { op: 'dataWrite' }) => SaveData.run(items) as DataWriteResult[]

describe('read', () => {
  it('lists the root and pads fixed lists with labels', () => {
    const root = SaveData.list([], 0, 200)
    expect(root.rows.map((r) => r.key)).toEqual(['system', 'screen', 'timer', 'switches', 'variables', 'selfSwitches', 'actors', 'party', 'map', 'player', 'config'])
    expect(root.canInsert).toBe(false)

    const sw = SaveData.list(['switches', '_data'], 0, 200)
    expect(sw.rows.map((r) => [r.key, r.label, r.value, r.expectType])).toEqual([
      ['1', 'Door', false, 'boolean'],
      ['2', 'Boss', true, 'boolean'],
    ])
  })

  it('pages, skips accessors and functions, and marks cycles', () => {
    const party = world.$gameParty as Record<string, unknown>
    Object.defineProperty(party, 'computed', { get: () => 1, enumerable: true })
    party.self = party
    const page = SaveData.list(['party'], 0, 200)
    const keys = page.rows.map((r) => r.key)
    expect(keys).not.toContain('computed')
    expect(keys).not.toContain('gainItem')
    expect(page.rows.find((r) => r.key === 'self')?.kind).toBe('cycle')
    expect(SaveData.list(['party'], 2, 2).rows).toHaveLength(2)
  })

  it('rejects reserved names and missing paths', () => {
    expect(() => SaveData.list(['party', '__proto__'], 0, 10)).toThrow()
    expect(() => SaveData.list(['party', 'nope'], 0, 10)).toThrow(expect.objectContaining({ code: 'missing', existingDepth: 1 }))
  })

  it('refuses to read before a save is loaded', () => {
    ;(world.SceneManager as { _scene: unknown })._scene = new (class Scene_Title {})()
    expect(() => SaveData.list([], 0, 10)).toThrow(expect.objectContaining({ code: 'not-ready' }))
  })
})

describe('write', () => {
  it('writes through the engine and reads back', () => {
    const oid = SaveData.list(['switches', '_data'], 0, 10).oid
    const [r] = write({ op: 'dataWrite', items: [{ path: ['switches', '_data', '1'], ownerOid: oid, type: 'boolean', value: true }] })
    expect(r.ok).toBe(true)
    expect(world.$gameSwitches.setValue).toHaveBeenCalledWith(1, true)
    expect(r.readback).toMatchObject({ kind: 'boolean', value: true })
  })

  it('validates the whole batch before writing anything', () => {
    const oid = SaveData.list(['party'], 0, 200).oid
    const results = write({
      op: 'dataWrite',
      items: [
        { path: ['party', '_gold'], ownerOid: oid, type: 'number', value: 500 },
        { path: ['party', '_steps'], ownerOid: oid + 999, type: 'number', value: 1 },
      ],
    })
    expect(results.map((r) => r.ok)).toEqual([false, false])
    expect(results[1].code).toBe('stale')
    expect(world.$gameParty._gold).toBe(100)
  })

  it('requires confirmation for transfer fields and rejects wrong types', () => {
    const oid = SaveData.list(['player'], 0, 200).oid
    expect(write({ op: 'dataWrite', items: [{ path: ['player', '_x'], ownerOid: oid, type: 'number', value: 9 }] })[0].code).toBe('confirm')
    expect(write({ op: 'dataWrite', items: [{ path: ['player', '_x'], ownerOid: oid, type: 'string', value: '9', confirmed: true }] })[0].code).toBe('type')
    expect(write({ op: 'dataWrite', items: [{ path: ['player', '_x'], ownerOid: oid, type: 'number', value: 9, confirmed: true }] })[0].ok).toBe(true)
    expect(world.$gamePlayer._x).toBe(9)
  })

  it('lists and writes a switch that was never set', () => {
    world.$dataSystem.switches = Array.from({ length: 501 }, (_, i) => (i === 500 ? 'Late' : ''))
    const page = SaveData.list(['switches', '_data'], 400, 200)
    const row = page.rows.find((r) => r.key === '500')
    expect(page.total).toBe(500)
    expect(row).toMatchObject({ kind: 'undefined', label: 'Late', expectType: 'boolean' })
    const [r] = write({ op: 'dataWrite', items: [{ path: ['switches', '_data', '500'], ownerOid: page.oid, type: 'boolean', value: true }] })
    expect(r.ok).toBe(true)
    expect(world.$gameSwitches.setValue).toHaveBeenCalledWith(500, true)
  })

  it('writes item counts through gainItem', () => {
    const oid = SaveData.list(['party', '_items'], 0, 200).oid
    write({ op: 'dataWrite', items: [{ path: ['party', '_items', '1'], ownerOid: oid, type: 'number', value: 7 }] })
    expect(world.$gameParty._items['1']).toBe(7)
  })
})

describe('undo', () => {
  it('reverts a write, reports conflicts, and forces', () => {
    const oid = SaveData.list(['party'], 0, 200).oid
    write({ op: 'dataWrite', items: [{ path: ['party', '_gold'], ownerOid: oid, type: 'number', value: 200 }] })
    expect(SaveData.status().undoDepth).toBe(1)
    world.$gameParty._gold = 300
    const conflict = SaveData.run({ op: 'dataUndo' }) as DataUndoResult
    expect(conflict.applied).toBe(false)
    expect(conflict.conflicts?.[0].current).toMatchObject({ value: 300 })
    const forced = SaveData.run({ op: 'dataUndo', force: true }) as DataUndoResult
    expect(forced.applied).toBe(true)
    expect(world.$gameParty._gold).toBe(100)
  })

  it('drops steps whose owner was replaced', () => {
    const oid = SaveData.list(['player'], 0, 200).oid
    write({ op: 'dataWrite', items: [{ path: ['player', '_y'], ownerOid: oid, type: 'number', value: 8 }] })
    ;(globalThis as Record<string, unknown>).$gamePlayer = { ...world.$gamePlayer }
    expect((SaveData.run({ op: 'dataUndo' }) as DataUndoResult).reason).toBeDefined()
  })

  it('clears the stack when the generation moves', () => {
    const oid = SaveData.list(['party'], 0, 200).oid
    write({ op: 'dataWrite', items: [{ path: ['party', '_gold'], ownerOid: oid, type: 'number', value: 1 }] })
    const before = SaveData.status().gen
    ;(globalThis as Record<string, unknown>).$gameParty = { ...world.$gameParty }
    SaveData.checkGen()
    const status = SaveData.status()
    expect(status.gen).toBe(before + 1)
    expect(status.undoDepth).toBe(0)
  })
})

describe('struct', () => {
  it('inserts into arrays and undoes it', () => {
    const page = SaveData.list(['party', '_actors'], 0, 200)
    SaveData.run({ op: 'dataStruct', path: ['party', '_actors'], ownerOid: page.oid, action: 'insert', index: 1, valueType: 'number', value: 2 })
    expect(world.$gameParty._actors).toEqual([1, 2])
    SaveData.run({ op: 'dataUndo', force: true })
    expect(world.$gameParty._actors).toEqual([1])
  })

  it('requires confirmation to remove and copy', () => {
    const page = SaveData.list(['party', '_actors'], 0, 200)
    expect(() => SaveData.run({ op: 'dataStruct', path: ['party', '_actors'], ownerOid: page.oid, action: 'remove', index: 0 })).toThrow(
      expect.objectContaining({ code: 'confirm' })
    )
    SaveData.run({ op: 'dataStruct', path: ['party', '_actors'], ownerOid: page.oid, action: 'remove', index: 0, confirmed: true })
    expect(world.$gameParty._actors).toEqual([])
  })

  it('adds items and self switches through the engine', () => {
    const items = SaveData.list(['party', '_items'], 0, 200)
    SaveData.run({ op: 'dataStruct', path: ['party', '_items'], ownerOid: items.oid, action: 'addKey', key: '2', valueType: 'number', value: 4 })
    expect(world.$gameParty._items['2']).toBe(4)
    const ss = SaveData.list(['selfSwitches', '_data'], 0, 200)
    SaveData.run({ op: 'dataStruct', path: ['selfSwitches', '_data'], ownerOid: ss.oid, action: 'addKey', key: '1,1,B', valueType: 'boolean', value: true })
    expect(world.$gameSelfSwitches.setValue).toHaveBeenCalledWith([1, 1, 'B'], true)
    expect(() => SaveData.run({ op: 'dataStruct', path: ['selfSwitches', '_data'], ownerOid: ss.oid, action: 'addKey', key: 'bad', valueType: 'boolean', value: true })).toThrow()
  })

  it('rejects structure edits on fixed lists and reserved keys', () => {
    const sw = SaveData.list(['switches', '_data'], 0, 10)
    expect(() => SaveData.run({ op: 'dataStruct', path: ['switches', '_data'], ownerOid: sw.oid, action: 'insert', index: 0, valueType: 'boolean', value: true })).toThrow()
    const party = SaveData.list(['party'], 0, 200)
    expect(() => SaveData.run({ op: 'dataStruct', path: ['party'], ownerOid: party.oid, action: 'addKey', key: '__proto__', valueType: 'number', value: 1 })).toThrow()
  })

  it('refuses keys that shadow the prototype or JsonEx markers, and container fields on remove', () => {
    const party = SaveData.list(['party'], 0, 200)
    for (const key of ['hasOwnProperty', 'toString', '@c'])
      expect(() => SaveData.run({ op: 'dataStruct', path: ['party'], ownerOid: party.oid, action: 'addKey', key, valueType: 'number', value: 1 })).toThrow(
        expect.objectContaining({ code: 'invalid' })
      )
    expect(() => SaveData.run({ op: 'dataStruct', path: ['party'], ownerOid: party.oid, action: 'removeKey', key: '_items', confirmed: true })).toThrow(
      expect.objectContaining({ code: 'unsupported' })
    )
    expect(world.$gameParty._items).toBeDefined()
  })

  it('only resolves canonical indexes inside arrays', () => {
    const oid = SaveData.list(['party', '_actors'], 0, 200).oid
    const [r] = write({ op: 'dataWrite', items: [{ path: ['party', '_actors', 'length'], ownerOid: oid, type: 'number', value: 4e9 }] })
    expect(r).toMatchObject({ ok: false, code: 'missing' })
    expect(world.$gameParty._actors).toHaveLength(1)
  })
})

describe('locks', () => {
  it('writes the locked value back and is exclusive with preset locks', () => {
    const oid = SaveData.list(['party'], 0, 200).oid
    SaveData.run({ op: 'dataLock', path: ['party', '_steps'], ownerOid: oid, on: true, value: 5, valueType: 'number' })
    world.$gameParty._steps = 9
    jest.advanceTimersByTime(250)
    expect(world.$gameParty._steps).toBe(5)
    expect(SaveData.status().locks).toHaveLength(1)

    isLocked.mockReturnValue(true)
    expect(() => SaveData.run({ op: 'dataLock', path: ['party', '_gold'], ownerOid: oid, on: true })).toThrow(expect.objectContaining({ code: 'preset-lock' }))
  })

  it('drops the lock when the owner object is replaced', () => {
    const oid = SaveData.list(['player'], 0, 200).oid
    SaveData.run({ op: 'dataLock', path: ['player', '_encounterCount'], ownerOid: oid, on: true })
    ;(globalThis as Record<string, unknown>).$gamePlayer = { ...world.$gamePlayer }
    jest.advanceTimersByTime(250)
    expect(SaveData.status().locks).toHaveLength(0)
  })

  it('keeps the full text of a locked long string', () => {
    const party = world.$gameParty as Record<string, unknown>
    party._memo = 'a'.repeat(300)
    const oid = SaveData.list(['party'], 0, 200).oid
    SaveData.run({ op: 'dataLock', path: ['party', '_memo'], ownerOid: oid, on: true })
    const long = 'b'.repeat(300)
    write({ op: 'dataWrite', items: [{ path: ['party', '_memo'], ownerOid: oid, type: 'string', value: long }] })
    party._memo = 'changed'
    jest.advanceTimersByTime(250)
    expect(party._memo).toBe(long)
  })

  it('drops locks on array elements that moved', () => {
    world.$gameParty._actors.push(2)
    const oid = SaveData.list(['party', '_actors'], 0, 200).oid
    SaveData.run({ op: 'dataLock', path: ['party', '_actors', '1'], ownerOid: oid, on: true })
    SaveData.run({ op: 'dataStruct', path: ['party', '_actors'], ownerOid: oid, action: 'remove', index: 0, confirmed: true })
    expect(SaveData.status().locks).toHaveLength(0)
  })

  it('yields to a preset lock taken later on the same field', () => {
    const oid = SaveData.list(['party'], 0, 200).oid
    SaveData.run({ op: 'dataLock', path: ['party', '_gold'], ownerOid: oid, on: true })
    isLocked.mockReturnValue(true)
    jest.advanceTimersByTime(250)
    expect(SaveData.status().locks).toHaveLength(0)
  })

  it('locks a never-set switch at OFF', () => {
    const oid = SaveData.list(['switches', '_data'], 0, 10).oid
    expect(() => SaveData.run({ op: 'dataLock', path: ['switches', '_data', '1'], ownerOid: oid, on: true })).not.toThrow()
    expect(SaveData.status().locks[0]).toMatchObject({ value: false })
  })
})

describe('watch', () => {
  it('sends first values, then only changes, and reports replaced owners', () => {
    const diffs: { changes: { path: string[]; cell: { value?: unknown } }[]; replaced?: string[][] }[] = []
    const watcher = SaveData.createWatcher((d) => diffs.push(d))
    const oid = SaveData.list(['party'], 0, 200).oid
    watcher.set(1, [
      { path: ['party', '_gold'], ownerOid: oid },
      { path: ['party', '_steps'], ownerOid: oid },
    ])
    expect(diffs[0].changes.map((c) => c.cell.value)).toEqual([100, 0])

    jest.advanceTimersByTime(1100)
    expect(diffs).toHaveLength(1)

    world.$gameParty._gold = 150
    jest.advanceTimersByTime(1100)
    expect(diffs[1].changes).toEqual([{ path: ['party', '_gold'], cell: expect.objectContaining({ value: 150 }) }])

    ;(globalThis as Record<string, unknown>).$gameParty = { ...world.$gameParty }
    jest.advanceTimersByTime(1100)
    expect(diffs.at(-1)?.replaced?.length).toBeGreaterThan(0)
    watcher.dispose()
  })
})

describe('search', () => {
  it('finds names and values in slices and can be cancelled', () => {
    const hits: string[][] = []
    let done = false
    SaveData.search(['party'], 'potion', 'all', (b) => {
      hits.push(...b.hits.map((h) => h.path))
      done = b.done
    })
    jest.runAllTimers()
    expect(done).toBe(true)
    expect(hits).toContainEqual(['party', '_items', '1'])

    const batches: unknown[] = []
    const cancel = SaveData.search([], 'zzz', 'all', (b) => batches.push(b))
    cancel()
    jest.runAllTimers()
    expect(batches).toHaveLength(0)
  })
})

describe('pins', () => {
  it('stores sanitized pins and reports them in status', () => {
    SaveData.run({ op: 'dataPins', pins: [{ path: ['party', '_gold'] }, { path: ['party', '__proto__'] }, { path: ['bad'] }] as never })
    expect(SaveData.status().pins).toEqual([{ path: ['party', '_gold'] }])
  })
})
