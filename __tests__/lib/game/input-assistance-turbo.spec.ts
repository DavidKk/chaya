import {
  atomLabel,
  bindingWarnings,
  chordLabel,
  groupForRule,
  intervalLabel,
  type KeyInput,
  parseInputAssistConfig,
  parseInterval,
  randomInterval,
  type TurboRule,
  validateRule,
} from '@/lib/game/input-assistance'

const q: KeyInput = { kind: 'key', code: 'KeyQ', key: 'q', keyCode: 81 }
const turbo = (patch: Partial<TurboRule> = {}): TurboRule => ({
  id: 't1',
  name: '连发',
  enabled: true,
  trigger: [q],
  originalInput: 'replace',
  kind: 'turbo',
  output: [q],
  interval: { minMs: 100, maxMs: 130 },
  ...patch,
})

it('parses fixed and ranged intervals, clamping and ordering bounds', () => {
  expect(parseInterval('100')).toEqual({ minMs: 100, maxMs: 100 })
  expect(parseInterval('130 - 100ms')).toEqual({ minMs: 100, maxMs: 130 })
  expect(parseInterval('5~99999')).toEqual({ minMs: 30, maxMs: 2000 })
  expect(parseInterval('abc')).toBeNull()
})

it('picks random intervals inside the range', () => {
  for (let index = 0; index < 50; index += 1) {
    const value = randomInterval({ minMs: 100, maxMs: 130 })
    expect(value).toBeGreaterThanOrEqual(100)
    expect(value).toBeLessThanOrEqual(130)
  }
})

it('requires exactly one turbo key and keeps incomplete turbo rules parseable', () => {
  expect(validateRule(turbo())).toEqual([])
  expect(validateRule(turbo({ output: [q, { kind: 'mouse', button: 0 }] }))[0]?.field).toBe('output')
  expect(validateRule(turbo({ output: [], trigger: [] }), false)).toEqual([])
  expect(parseInputAssistConfig({ version: 1, revision: 0, rules: [turbo({ output: [], trigger: [] })] }).rules).toHaveLength(1)
  expect(parseInputAssistConfig({ version: 1, revision: 0, rules: [turbo({ interval: { minMs: 200, maxMs: 100 } })] }).rules).toHaveLength(0)
})

it('groups turbo rules into their own card and labels intervals', () => {
  expect(groupForRule(turbo())).toBe('turbo')
  expect(intervalLabel({ minMs: 100, maxMs: 100 })).toBe('100')
  expect(intervalLabel({ minMs: 100, maxMs: 130 })).toBe('100-130')
})

it('labels the plus key so it is not confused with the chord separator', () => {
  const plus: KeyInput = { kind: 'key', code: 'Equal', key: '+', keyCode: 187 }
  expect(atomLabel(plus)).toBe('Plus')
  expect(chordLabel([{ kind: 'key', code: 'ShiftLeft', key: 'Shift', keyCode: 16 }, plus])).toBe('Shift+Plus')
})

it('warns on overlapping turbo triggers but ignores incomplete and disabled rules', () => {
  expect(bindingWarnings([turbo(), turbo({ id: 't2', name: '连发 2' })]).map((item) => item.ruleId)).toEqual(['t1', 't2'])
  expect(bindingWarnings([turbo(), turbo({ id: 't2', trigger: [] }), turbo({ id: 't3', enabled: false })])).toEqual([])
})
