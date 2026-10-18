import { parseEditAction, parseEditOp, parseRunAction } from '@/lib/runtime/edit-ops'

describe('edit-ops', () => {
  it('parses and clamps common ops', () => {
    expect(parseEditOp({ op: 'gold', value: -5 })).toEqual({ op: 'gold', value: 0 })
    expect(parseEditOp({ op: 'count', kind: 'weapon', id: '3', value: 9.7 })).toEqual({ op: 'count', kind: 'weapon', id: 3, value: 9 })
    expect(parseEditOp({ op: 'sw', id: 2, value: true })).toEqual({ op: 'sw', id: 2, value: true })
    expect(parseEditOp({ op: 'swLock', id: 2, on: true, value: false })).toEqual({ op: 'swLock', id: 2, on: true, value: 0 })
    expect(parseEditOp({ op: 'walkRate', value: 1.5 })).toEqual({ op: 'walkRate', value: 1.5 })
    expect(parseEditOp({ op: 'moveRate', value: 2 })).toEqual({ op: 'moveRate', value: 2 })
    expect(parseEditOp({ op: 'gameSpeed', value: 3 })).toEqual({ op: 'gameSpeed', value: 3 })
    expect(parseEditOp({ op: 'gameSpeed', value: 20 })).toEqual({ op: 'gameSpeed', value: 5 })
    expect(parseEditOp({ op: 'gameSpeed', value: 0.5 })).toEqual({ op: 'gameSpeed', value: 1 })
  })

  it('validates actor patches', () => {
    expect(parseEditOp({ op: 'actor', id: 1, patch: { hp: 999, name: 'A', skillIds: [1, 2] } })).toEqual({ op: 'actor', id: 1, patch: { hp: 999, name: 'A', skillIds: [1, 2] } })
    expect(() => parseEditOp({ op: 'actor', id: 1, patch: {} })).toThrow('patch has no modifiable fields')
    expect(() => parseEditOp({ op: 'actor', id: 1, patch: { skillIds: [1.5] } })).toThrow('integer array')
    expect(() => parseEditOp({ op: 'actor', id: 1, patch: { name: 3 } })).toThrow('must be a string')
  })

  it('rejects unknown ops and bad values', () => {
    expect(() => parseEditOp({ op: 'eval' })).toThrow('op must be one of')
    expect(() => parseEditOp({ op: 'gold', value: 'abc' })).toThrow('value must be a number')
    expect(() => parseEditOp({ op: 'sw', id: 1, value: 'yes' })).toThrow('must be a boolean')
    expect(() => parseEditOp({ op: 'runFlag', key: 'nope', value: true })).toThrow('key must be one of')
  })

  it('parses run actions', () => {
    expect(() => parseRunAction({ id: 'nope' })).toThrow('id must be one of')
  })

  it('parses edit actions with their own params', () => {
    expect(parseEditAction({ id: 'teleport', mapId: '3', x: 4, y: 5, direction: 8 })).toEqual({ id: 'teleport', mapId: 3, x: 4, y: 5, direction: 8 })
    expect(parseEditAction({ id: 'common_event', eventId: 7 })).toEqual({ id: 'common_event', eventId: 7 })
    expect(parseEditAction({ id: 'save' })).toEqual({ id: 'save', slot: 1 })
    expect(parseEditAction({ id: 'load', slot: 3 })).toEqual({ id: 'load', slot: 3 })
    expect(() => parseEditAction({ id: 'teleport', mapId: 1, x: 1, y: 1, direction: 5 })).toThrow('direction')
    expect(() => parseEditAction({ id: 'save', slot: 0 })).toThrow('slot')
    expect(() => parseEditAction({ id: 'teleport', mapId: 1 })).toThrow()
    expect(() => parseEditAction({ id: 'eval' })).toThrow('id must be one of')
  })
})
