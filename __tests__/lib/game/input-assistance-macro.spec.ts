import { type KeyInput, type MacroEvent, macroLabel, macroSteps, MIN_PRESS_MS, MIN_STEP_GAP_MS, spaceMacroEvents, validateRule } from '@/lib/game/input-assistance'

const key = (k: string): KeyInput => ({ kind: 'key', code: `Key${k}`, key: k.toLowerCase(), keyCode: k.charCodeAt(0) })
const down = (k: string, atMs: number): MacroEvent => ({ atMs, phase: 'down', input: key(k) })
const up = (k: string, atMs: number): MacroEvent => ({ atMs, phase: 'up', input: key(k) })

it('keeps press order for fast overlapping rolls instead of merging into a chord', () => {
  const events = spaceMacroEvents([down('A', 0), down('S', 5), up('A', 8), down('D', 10), up('S', 12), up('D', 14)])
  const steps = macroSteps(events)
  expect(steps.map((step) => step.inputs.map((input) => (input.kind === 'key' ? input.key : input.button)))).toEqual([['a'], ['s'], ['d']])
  expect(steps[1].startMs - steps[0].startMs).toBeGreaterThanOrEqual(MIN_STEP_GAP_MS)
  expect(steps[2].startMs - steps[1].startMs).toBeGreaterThanOrEqual(MIN_STEP_GAP_MS)
  expect(macroLabel(events)).toBe('ASD')
  expect(
    validateRule({
      id: 'r',
      name: 'r',
      enabled: true,
      trigger: [key('Q')],
      originalInput: 'replace',
      kind: 'macro',
      events,
      repeat: { enabled: false, intervalMs: 100 },
      mousePosition: 'current',
    })
  ).toEqual([])
})

it('treats near-identical presses as one chord step', () => {
  const steps = macroSteps(spaceMacroEvents([down('A', 0), down('S', 1), up('A', 60), up('S', 61)]))
  expect(steps).toHaveLength(1)
  expect(steps[0].inputs).toHaveLength(2)
})

it('keeps real gaps and enforces a minimum press time', () => {
  const events = spaceMacroEvents([down('A', 0), up('A', 2), down('S', 200), up('S', 300)])
  expect(events.map((event) => event.atMs)).toEqual([0, MIN_PRESS_MS, 200, 300])
})

it('re-pressing the same key stays paired after spacing', () => {
  const events = spaceMacroEvents([down('A', 0), up('A', 3), down('A', 6), up('A', 9)])
  const rule = {
    id: 'r',
    name: 'r',
    enabled: true,
    trigger: [key('Q')],
    originalInput: 'replace' as const,
    kind: 'macro' as const,
    events,
    repeat: { enabled: false, intervalMs: 100 },
    mousePosition: 'current' as const,
  }
  expect(validateRule(rule)).toEqual([])
  expect(macroSteps(events)).toHaveLength(2)
})
