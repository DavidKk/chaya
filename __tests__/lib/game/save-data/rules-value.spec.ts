import {
  allowedTypes,
  annotate,
  defaultType,
  fnv1a,
  insertModeFor,
  isDataOp,
  isReadonlyPath,
  matchesType,
  type NameSource,
  needsConfirm,
  parseDraft,
  parseSelfSwitchKey,
  presetLockFor,
} from '@/lib/game/save-data'

const names: NameSource = {
  switchName: (id) => `S${id}`,
  variableName: (id) => `V${id}`,
  actorName: (id) => `A${id}`,
  itemName: (kind, id) => `${kind}${id}`,
  mapName: (id) => `M${id}`,
  eventName: (mapId, id) => `E${mapId ?? 'cur'}-${id}`,
}

describe('save-data rules', () => {
  it('marks read-only and confirm-required fields', () => {
    expect(isReadonlyPath(['map', '_interpreter', '_list'])).toBe(true)
    expect(isReadonlyPath(['map', '_events', '3', '_eventId'])).toBe(true)
    expect(isReadonlyPath(['map', '_events', '3', '_x'])).toBe(false)
    expect(needsConfirm(['player', '_x'])).toBe(true)
    expect(needsConfirm(['map', '_mapId'])).toBe(true)
    expect(needsConfirm(['party', '_gold'])).toBe(false)
  })

  it('maps fields to GameEdit preset locks', () => {
    expect(presetLockFor(['party', '_gold'])).toEqual({ kind: 'gold', id: 0 })
    expect(presetLockFor(['variables', '_data', '5'])).toEqual({ kind: 'var', id: 5 })
    expect(presetLockFor(['switches', '_data', '2'])).toEqual({ kind: 'sw', id: 2 })
    expect(presetLockFor(['actors', '_data', '1', '_hp'])).toEqual({ kind: 'hp', id: 1 })
    expect(presetLockFor(['party', '_weapons', '7'])).toEqual({ kind: 'weapon', id: 7 })
    expect(presetLockFor(['party', '_steps'])).toBeNull()
  })

  it('decides structure edit modes', () => {
    expect(insertModeFor([])).toBeNull()
    expect(insertModeFor(['config'])).toBeNull()
    expect(insertModeFor(['switches', '_data'])).toBeNull()
    expect(insertModeFor(['party', '_items'])).toBe('item')
    expect(insertModeFor(['selfSwitches', '_data'])).toBe('selfSwitch')
    expect(insertModeFor(['party', '_actors'])).toBe('value')
    expect(parseSelfSwitchKey('3,4,B')).toEqual({ mapId: 3, eventId: 4, letter: 'B' })
    expect(parseSelfSwitchKey('0,4,B')).toBeNull()
  })

  it('only whitelists data ops', () => {
    expect(isDataOp({ op: 'dataWrite' })).toBe(true)
    expect(isDataOp({ op: 'gold' })).toBe(false)
  })
})

describe('save-data schema', () => {
  it('annotates known structures', () => {
    expect(annotate([], 'party', {}, names)).toEqual({ labelKey: 'data.root.party' })
    expect(annotate(['switches', '_data'], '3', true, names)).toMatchObject({ label: 'S3', expectType: 'boolean', nullable: false })
    expect(annotate(['variables', '_data'], '3', 1, names)).toMatchObject({ label: 'V3', expectType: 'number|string' })
    expect(annotate(['selfSwitches', '_data'], '2,5,A', true, names)).toMatchObject({ label: 'M2 · E2-5 · A', expectType: 'boolean' })
    expect(annotate(['party', '_items'], '9', 3, names)).toMatchObject({ label: 'item9', expectType: 'number' })
    expect(annotate(['party', '_actors'], '0', 4, names)).toMatchObject({ label: 'A4', refresh: 'actor-party' })
    expect(annotate(['actors', '_data', '1'], '_hp', 10, names)).toEqual({ refresh: 'actor' })
    expect(annotate(['config'], 'bgmVolume', 100, names)).toMatchObject({ labelKey: 'data.config.bgmVolume', nullable: false })
  })
})

describe('save-data value', () => {
  it('parses drafts per type and rejects non-finite numbers', () => {
    expect(parseDraft('12.5', 'number')).toEqual({ ok: true, value: 12.5 })
    expect(parseDraft('  ', 'number')).toEqual({ ok: false, reason: 'empty' })
    expect(parseDraft('NaN', 'number')).toEqual({ ok: false, reason: 'number' })
    expect(parseDraft('Infinity', 'number')).toEqual({ ok: false, reason: 'number' })
    expect(parseDraft('', 'string')).toEqual({ ok: true, value: '' })
    expect(parseDraft('true', 'boolean')).toEqual({ ok: true, value: true })
    expect(parseDraft('x', 'null')).toEqual({ ok: true, value: null })
  })

  it('keeps the field type; variables may switch number and string', () => {
    expect(allowedTypes('number', undefined, false)).toEqual(['number'])
    expect(allowedTypes('number', undefined, true)).toEqual(['number', 'null'])
    expect(allowedTypes('string', 'number|string', false)).toEqual(['number', 'string'])
    expect(allowedTypes('boolean', 'boolean', false)).toEqual(['boolean'])
    expect(allowedTypes('null', undefined, true)).toEqual(['number', 'string', 'boolean', 'null'])
    expect(allowedTypes('object', undefined, true)).toEqual([])
    expect(defaultType({ kind: 'undefined' }, 'boolean')).toBe('boolean')
    expect(matchesType(NaN, 'number')).toBe(false)
    expect(matchesType(null, 'null')).toBe(true)
  })

  it('hashes deterministically', () => {
    expect(fnv1a(['a', 'b'])).toBe(fnv1a(['a', 'b']))
    expect(fnv1a(['a', 'b'])).not.toBe(fnv1a(['b', 'a']))
  })
})
