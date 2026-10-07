import { bindingWarnings, hotkeyTokens, inputChordTokens, type KeyInput, type MacroRule, tokensOverlap } from '@/lib/game/input-assistance'

const key = (code: string, k: string, keyCode = 0): KeyInput => ({ kind: 'key', code, key: k, keyCode, location: 0 })
const q = key('KeyQ', 'q', 81)
const ctrl = key('ControlLeft', 'Control', 17)
const backquote = key('Backquote', '`', 192)

function macro(id: string, trigger: KeyInput[], enabled = true): MacroRule {
  return { id, name: id, enabled, trigger, originalInput: 'replace', kind: 'macro', events: [], repeat: { enabled: false, intervalMs: 100 }, mousePosition: 'current' }
}

it('normalises hotkey-page chords and physical key chords to the same tokens', () => {
  expect(hotkeyTokens('Ctrl+Shift+J')).toEqual(['ctrl', 'shift', 'j'])
  expect(hotkeyTokens('`')).toEqual(['`'])
  expect(hotkeyTokens('Ctrl++')).toEqual(['ctrl', '+'])
  expect(inputChordTokens([key('MetaLeft', 'Meta'), key('Digit3', '£')])).toEqual(['ctrl', '3'])
  expect(inputChordTokens([backquote])).toEqual(['`'])
  expect(inputChordTokens([{ kind: 'mouse', button: 0 }])).toEqual(['mouse:0'])
})

it('treats equal or contained chords as overlapping', () => {
  expect(tokensOverlap(['q'], ['ctrl', 'q'])).toBe(true)
  expect(tokensOverlap(['ctrl', 'shift', 'q'], ['ctrl', 'q'])).toBe(true)
  expect(tokensOverlap(['q'], ['w'])).toBe(false)
  expect(tokensOverlap([], ['q'])).toBe(false)
})

it('warns enabled key-mouse triggers that collide with an active Chaya hotkey', () => {
  const products = [
    { label: '唤出作弊器（`）', chord: '`' },
    { label: '无敌（Ctrl+Q）', chord: 'Ctrl+Q' },
  ]
  const warnings = bindingWarnings([macro('a', [backquote]), macro('b', [q]), macro('c', [ctrl, q], false), macro('d', [key('KeyW', 'w')])], products)
  expect(warnings).toEqual([
    { ruleId: 'a', field: 'trigger', message: '与 Chaya 快捷键“唤出作弊器（`）”冲突，可能同时触发' },
    { ruleId: 'b', field: 'trigger', message: '与 Chaya 快捷键“无敌（Ctrl+Q）”冲突，可能同时触发' },
  ])
})
