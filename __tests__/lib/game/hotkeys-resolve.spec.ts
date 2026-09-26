import {
  DEFAULT_OPEN_PANEL_CHORD,
  defaultOpenConsoleChord,
  displayKeyChord,
  effectiveHotkeys,
  hotkeyMapsEqual,
  OPEN_CONSOLE_HOTKEY_ID,
  OPEN_PANEL_HOTKEY_ID,
  resolveHotkeyChord,
  resolveOpenConsoleChord,
  resolveOpenPanelChord,
} from '@/components/game-edit/run-hotkeys'

describe('hotkey resolve (game → global → default)', () => {
  it('resolveHotkeyChord prefers game over global', () => {
    expect(resolveHotkeyChord('flag:god', { 'flag:god': 'KeyG' }, { 'flag:god': 'KeyH' })).toBe('KeyG')
    expect(resolveHotkeyChord('flag:god', {}, { 'flag:god': 'KeyH' })).toBe('KeyH')
    expect(resolveHotkeyChord('flag:god', {}, {})).toBe('')
  })

  it('open panel falls back to `', () => {
    expect(resolveHotkeyChord(OPEN_PANEL_HOTKEY_ID, {}, {})).toBe(DEFAULT_OPEN_PANEL_CHORD)
    expect(resolveHotkeyChord(OPEN_PANEL_HOTKEY_ID, { [OPEN_PANEL_HOTKEY_ID]: 'F1' }, {})).toBe('F1')
    expect(resolveHotkeyChord(OPEN_PANEL_HOTKEY_ID, {}, { [OPEN_PANEL_HOTKEY_ID]: 'F2' })).toBe('F2')
    expect(resolveOpenPanelChord({})).toBe(DEFAULT_OPEN_PANEL_CHORD)
  })

  it('open console falls back to Chrome OS default', () => {
    const def = defaultOpenConsoleChord()
    expect(resolveOpenConsoleChord({})).toBe(def)
    expect(resolveHotkeyChord(OPEN_CONSOLE_HOTKEY_ID, {}, {})).toBe(def)
    expect(resolveHotkeyChord(OPEN_CONSOLE_HOTKEY_ID, { [OPEN_CONSOLE_HOTKEY_ID]: 'F12' }, {})).toBe('F12')
    expect(def === 'Ctrl+Alt+I' || def === 'Ctrl+Shift+J').toBe(true)
  })

  it('displayKeyChord uses Mac symbols on darwin', () => {
    if (process.platform !== 'darwin') return
    expect(displayKeyChord('Ctrl+Alt+I')).toBe('⌥⌘I')
    expect(displayKeyChord('Ctrl+Shift+J')).toBe('⇧⌘J')
    expect(displayKeyChord('`')).toBe('`')
  })

  it('effectiveHotkeys merges with game wins', () => {
    const map = effectiveHotkeys({ 'flag:god': 'KeyG' }, { 'flag:god': 'KeyH', 'flag:through': 'KeyT' })
    expect(map['flag:god']).toBe('KeyG')
    expect(map['flag:through']).toBe('KeyT')
    expect(map[OPEN_PANEL_HOTKEY_ID]).toBe(DEFAULT_OPEN_PANEL_CHORD)
    expect(map[OPEN_CONSOLE_HOTKEY_ID]).toBe(defaultOpenConsoleChord())
  })

  it('effectiveHotkeys dedupes same chord across scopes (game wins)', () => {
    const map = effectiveHotkeys({ 'flag:god': 'KeyG' }, { 'flag:through': 'KeyG', [OPEN_PANEL_HOTKEY_ID]: '`' })
    expect(map['flag:god']).toBe('KeyG')
    expect(map['flag:through']).toBeUndefined()
  })

  it('effectiveHotkeys drops bindings that collide with open-panel chord', () => {
    const map = effectiveHotkeys({ 'flag:god': '`' }, { [OPEN_PANEL_HOTKEY_ID]: '`' })
    expect(map[OPEN_PANEL_HOTKEY_ID]).toBe(DEFAULT_OPEN_PANEL_CHORD)
    expect(map['flag:god']).toBeUndefined()
  })

  it('hotkeyMapsEqual ignores empty and case', () => {
    expect(hotkeyMapsEqual({ a: 'KeyG' }, { a: 'keyg' })).toBe(true)
    expect(hotkeyMapsEqual({ a: 'KeyG' }, { a: 'KeyG', b: '' })).toBe(true)
    expect(hotkeyMapsEqual({ a: 'KeyG' }, { a: 'KeyH' })).toBe(false)
  })
})
