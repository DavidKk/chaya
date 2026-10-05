import { decodePathSegments, decodeSegment, encodeSegment, isPrefix, isValidPath, parsePathKey, pathExpression, pathKey, samePath } from '@/lib/game/save-data'

describe('save-data path', () => {
  it('validates root, reserved names and depth', () => {
    expect(isValidPath([])).toBe(true)
    expect(isValidPath(['party', '_items', '12'])).toBe(true)
    expect(isValidPath(['nope'])).toBe(false)
    expect(isValidPath(['party', '__proto__'])).toBe(false)
    expect(isValidPath(['party', 'constructor'])).toBe(false)
    expect(isValidPath(['party', ''])).toBe(false)
    expect(isValidPath(['party', ...Array.from({ length: 40 }, () => 'a')])).toBe(false)
    expect(isValidPath('party')).toBe(false)
  })

  it('round-trips URL segments with only safe characters', () => {
    for (const seg of ['_items', '12', '1,2,A', 'ä名前 x/y', '~tilde', 'a.b-c']) {
      const enc = encodeSegment(seg)
      expect(enc).toMatch(/^[A-Za-z0-9_.~-]*$/)
      expect(decodeSegment(enc)).toBe(seg)
    }
    expect(decodeSegment('bad%20')).toBeNull()
    expect(decodeSegment('~G1')).toBeNull()
  })

  it('decodes route segments into a valid path or null', () => {
    expect(decodePathSegments(['party', '_items'])).toEqual(['party', '_items'])
    expect(decodePathSegments(['party', encodeSegment('__proto__')])).toBeNull()
    expect(decodePathSegments(['unknown'])).toBeNull()
  })

  it('compares paths and keys', () => {
    expect(samePath(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(isPrefix(['party'], ['party', '_gold'])).toBe(true)
    expect(isPrefix(['party', '_gold'], ['party'])).toBe(false)
    expect(parsePathKey(pathKey(['x', 'y']))).toEqual(['x', 'y'])
  })

  it('builds console expressions', () => {
    expect(pathExpression(['party', '_items', '12'])).toBe('$gameParty._items[12]')
    expect(pathExpression(['selfSwitches', '_data', '1,2,A'])).toBe('$gameSelfSwitches._data["1,2,A"]')
    expect(pathExpression(['config', 'bgmVolume'])).toBe('ConfigManager.bgmVolume')
  })
})
