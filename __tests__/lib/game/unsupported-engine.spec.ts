import { detectUnsupportedEngine, readUnsupportedEngine, UNSUPPORTED_ENGINE_CODE } from '@/lib/game/unsupported-engine'

describe('detectUnsupportedEngine', () => {
  it.each([
    [{ root: ['Game.exe', 'Game.rgss3a', 'Game.ini'] }, 'RPG Maker VX Ace'],
    [{ root: ['Game.exe', 'Game.ini'], system: ['RGSS301.dll'] }, 'RPG Maker VX Ace'],
    [{ root: ['Game.exe', 'Game.ini'], data: ['Actors.rvdata2', 'Map001.rvdata2'] }, 'RPG Maker VX Ace'],
    [{ root: ['Game.exe', 'Game.rgss2a', 'RGSS202E.dll'] }, 'RPG Maker VX'],
    [{ root: ['Game.exe'], data: ['Actors.rvdata'] }, 'RPG Maker VX'],
    [{ root: ['Game.exe', 'Game.rgssad', 'RGSS104E.dll'] }, 'RPG Maker XP'],
    [{ root: ['Game.exe'], data: ['Map001.rxdata'] }, 'RPG Maker XP'],
    [{ root: ['RPG_RT.exe', 'RPG_RT.ldb', 'RPG_RT.lmt'] }, 'RPG Maker 2000/2003'],
    [{ root: ['Game.exe', 'UnityPlayer.dll', 'Game_Data'] }, 'Unity'],
  ] as const)('%j → %s', (listing, engine) => {
    expect(detectUnsupportedEngine(listing)).toBe(engine)
  })

  it('returns null for MV / MZ and unknown folders', () => {
    expect(detectUnsupportedEngine({ root: ['Game.exe', 'www', 'package.json'] })).toBeNull()
    expect(detectUnsupportedEngine({ root: ['index.html', 'js', 'data'], data: ['Actors.json', 'System.json'] })).toBeNull()
    expect(detectUnsupportedEngine({ root: [] })).toBeNull()
  })
})

describe('readUnsupportedEngine', () => {
  it('reads the engine from an API error body', () => {
    expect(readUnsupportedEngine({ ok: false, error: { code: UNSUPPORTED_ENGINE_CODE, message: 'x', engine: 'RPG Maker VX Ace' } })).toBe('RPG Maker VX Ace')
    expect(readUnsupportedEngine({ ok: false, error: { code: 'BAD_REQUEST', message: 'x' } })).toBeNull()
    expect(readUnsupportedEngine(null)).toBeNull()
  })
})
