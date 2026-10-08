/** @jest-environment jsdom */
import { type InputRule, type KeyInput, setInputRecording, type TurboRule } from '@/lib/game/input-assistance'
import { InputAssistanceRuntime } from '@/plugins/src/cheat/input-assistance/runtime'

const q: KeyInput = { kind: 'key', code: 'KeyQ', key: 'q', keyCode: 81, location: 0 }
const w: KeyInput = { kind: 'key', code: 'KeyW', key: 'w', keyCode: 87, location: 0 }

function turbo(patch: Partial<TurboRule> = {}): TurboRule {
  return { id: 'turbo', name: '连发', enabled: true, trigger: [q], originalInput: 'replace', kind: 'turbo', output: [q], interval: { minMs: 100, maxMs: 100 }, ...patch }
}

type Physical = { prevented: boolean }
type Handlers = { onKeyDown: (event: unknown) => void; onKeyUp: (event: unknown) => void }

function physical(runtime: InputAssistanceRuntime, phase: 'down' | 'up', input: KeyInput, repeat = false, focused: Element = document.body): Physical {
  const result = { prevented: false }
  const event = {
    ...input,
    isTrusted: true,
    repeat,
    target: document.body,
    composedPath: () => [focused, document.body],
    which: input.keyCode,
    preventDefault: () => (result.prevented = true),
    stopPropagation: () => {},
  }
  const handlers = runtime as unknown as Handlers
  if (phase === 'down') handlers.onKeyDown(event)
  else handlers.onKeyUp(event)
  return result
}

let runtime: InputAssistanceRuntime
let emitted: string[]
const record = (event: KeyboardEvent) => emitted.push(`${event.type === 'keydown' ? 'down' : 'up'}:${event.key}@${Date.now()}`)

function setRules(...rules: InputRule[]) {
  runtime.setConfig({ version: 1, revision: 1, rules })
}

beforeEach(() => {
  jest.useFakeTimers({ now: 0 })
  jest.spyOn(document, 'hasFocus').mockReturnValue(true)
  emitted = []
  runtime = new InputAssistanceRuntime()
  document.addEventListener('keydown', record)
  document.addEventListener('keyup', record)
})

afterEach(() => {
  document.removeEventListener('keydown', record)
  document.removeEventListener('keyup', record)
  runtime.dispose()
  jest.restoreAllMocks()
  jest.useRealTimers()
})

it('toggles turbo on the first trigger press and off on the second, never leaving the key held', () => {
  setRules(turbo())
  expect(physical(runtime, 'down', q).prevented).toBe(true)
  expect(physical(runtime, 'up', q).prevented).toBe(true)
  jest.advanceTimersByTime(250)
  expect(emitted).toEqual(['down:q@0', 'up:q@24', 'down:q@100', 'up:q@124', 'down:q@200', 'up:q@224'])
  expect(runtime.status().running).toEqual(['turbo'])

  jest.advanceTimersByTime(60)
  physical(runtime, 'down', q)
  physical(runtime, 'up', q)
  const stoppedAt = emitted.length
  jest.advanceTimersByTime(500)
  expect(emitted).toHaveLength(stoppedAt)
  expect(emitted.filter((item) => item.startsWith('down')).length).toBe(emitted.filter((item) => item.startsWith('up')).length)
  expect(runtime.status().running).toEqual([])
})

it('fires with focus left on a plugin panel button but not while typing in a field', () => {
  setRules(turbo())
  const host = document.createElement('div')
  host.id = 'chaya-game-edit-host'
  const shadow = host.attachShadow({ mode: 'open' })
  const button = document.createElement('button')
  const field = document.createElement('input')
  shadow.append(button, field)
  document.body.append(host)
  try {
    expect(physical(runtime, 'down', q, false, field).prevented).toBe(false)
    physical(runtime, 'up', q, false, field)
    expect(runtime.status().running).toEqual([])
    expect(physical(runtime, 'down', q, false, button).prevented).toBe(true)
    physical(runtime, 'up', q, false, button)
    expect(runtime.status().running).toEqual(['turbo'])
  } finally {
    host.remove()
  }
})

it('stays idle while a recorder field owns the input', () => {
  setRules(turbo())
  setInputRecording(true)
  try {
    expect(physical(runtime, 'down', q).prevented).toBe(false)
    physical(runtime, 'up', q)
    jest.advanceTimersByTime(250)
    expect(emitted).toEqual([])
    expect(runtime.status().running).toEqual([])
  } finally {
    setInputRecording(false)
  }
})

it('stops running turbo when a recorder starts and still releases the swallowed trigger', () => {
  setRules(turbo())
  physical(runtime, 'down', q)
  jest.advanceTimersByTime(10)
  setInputRecording(true)
  try {
    expect(runtime.status().running).toEqual([])
    expect(physical(runtime, 'up', q).prevented).toBe(true)
    const stoppedAt = emitted.length
    jest.advanceTimersByTime(300)
    expect(emitted).toHaveLength(stoppedAt)
    expect(emitted.filter((item) => item.startsWith('down')).length).toBe(emitted.filter((item) => item.startsWith('up')).length)
  } finally {
    setInputRecording(false)
  }
})

it('releases a key that is mid-press when turbo is stopped', () => {
  setRules(turbo())
  physical(runtime, 'down', q)
  physical(runtime, 'up', q)
  jest.advanceTimersByTime(10)
  runtime.stop('turbo')
  expect(emitted).toEqual(['down:q@0', 'up:q@10'])
})

it('still emits keyup while the physical trigger key is held down', () => {
  setRules(turbo())
  physical(runtime, 'down', q)
  jest.advanceTimersByTime(30)
  expect(emitted).toEqual(['down:q@0', 'up:q@24'])
})

it('spaces taps randomly within the configured range', () => {
  setRules(turbo({ interval: { minMs: 100, maxMs: 130 } }))
  const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999).mockReturnValue(0)
  physical(runtime, 'down', q)
  jest.advanceTimersByTime(300)
  const downs = emitted.filter((item) => item.startsWith('down')).map((item) => Number(item.split('@')[1]))
  expect(downs.slice(0, 3)).toEqual([0, 100, 230])
  random.mockRestore()
})

it('turbos a different output key when the trigger differs', () => {
  setRules(turbo({ trigger: [w] }))
  physical(runtime, 'down', w)
  jest.advanceTimersByTime(30)
  expect(emitted).toEqual(['down:q@0', 'up:q@24'])
})

it('swallows OS key repeat for a replaced trigger', () => {
  setRules(turbo())
  physical(runtime, 'down', q)
  expect(physical(runtime, 'down', q, true).prevented).toBe(true)
})

it('ignores enabled but incomplete rules and lets the key through', () => {
  setRules(turbo({ output: [] }), turbo({ id: 'off', enabled: false }))
  expect(physical(runtime, 'down', q).prevented).toBe(false)
  jest.advanceTimersByTime(300)
  expect(emitted).toEqual([])
  expect(runtime.status().running).toEqual([])
})

it('stops running turbo when the config changes', () => {
  setRules(turbo())
  physical(runtime, 'down', q)
  physical(runtime, 'up', q)
  jest.advanceTimersByTime(10)
  setRules(turbo({ interval: { minMs: 200, maxMs: 200 } }))
  jest.advanceTimersByTime(500)
  expect(emitted).toEqual(['down:q@0', 'up:q@10'])
})
