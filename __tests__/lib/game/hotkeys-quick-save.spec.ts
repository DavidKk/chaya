import { effectiveHotkeys, formatKeyChord, matchKeyChord, parseHotkeyId, quickSaveHotkeyId, RUN_HOTKEY_TARGETS } from '@/components/game-edit/run-hotkeys'

function key(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent
}

describe('physical key matching', () => {
  it('matches digits by key position even when the OS types a symbol', () => {
    expect(formatKeyChord(key({ key: '£', code: 'Digit3', altKey: true }))).toBe('Alt+3')
    expect(matchKeyChord(key({ key: '#', code: 'Digit3', shiftKey: true }), 'Shift+3')).toBe(true)
    expect(matchKeyChord(key({ key: '3', code: 'Numpad3' }), '3')).toBe(true)
    expect(matchKeyChord(key({ key: '3', code: 'Numpad3', ctrlKey: true }), 'Ctrl+3')).toBe(true)
  })

  it('uses the letter position only with Alt, keeping layout letters otherwise', () => {
    expect(formatKeyChord(key({ key: 'ß', code: 'KeyS', altKey: true }))).toBe('Alt+S')
    expect(formatKeyChord(key({ key: 'a', code: 'KeyQ' }))).toBe('A')
  })

  it('still matches bindings saved before the switch to key positions', () => {
    expect(matchKeyChord(key({ key: '#', code: 'Digit3', shiftKey: true }), 'Shift+#')).toBe(true)
    expect(matchKeyChord(key({ key: '∂', code: 'KeyD', altKey: true }), 'Alt+∂')).toBe(true)
    expect(matchKeyChord(key({ key: '&', code: 'Digit1' }), '&')).toBe(true)
  })
})

describe('quick save hotkeys', () => {
  it('lists twenty quick save targets in their own group', () => {
    const rows = RUN_HOTKEY_TARGETS.filter((row) => row.groupKey === 'edit.groupQuickSave')
    expect(rows).toHaveLength(20)
    expect(rows[3]).toEqual(expect.objectContaining({ id: 'save:quick:3', kind: 'save', labelParams: { slot: 3 } }))
    expect(parseHotkeyId('load:quick:9')).toEqual({ kind: 'save', target: 'load:quick:9' })
  })

  it('binds Ctrl+N / Alt+N by default and yields to explicit bindings', () => {
    expect(effectiveHotkeys({}, {})[quickSaveHotkeyId('save', 3)]).toBe('Ctrl+3')
    expect(effectiveHotkeys({}, {})[quickSaveHotkeyId('load', 0)]).toBe('Alt+0')
    const map = effectiveHotkeys({}, { 'flag:god': 'Ctrl+3', [quickSaveHotkeyId('load', 1)]: 'F9' })
    expect(map['flag:god']).toBe('Ctrl+3')
    expect(map[quickSaveHotkeyId('save', 3)]).toBeUndefined()
    expect(map[quickSaveHotkeyId('load', 1)]).toBe('F9')
  })
})
