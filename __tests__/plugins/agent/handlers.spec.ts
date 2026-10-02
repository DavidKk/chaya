import { runAgentCommand, toJsonSafe } from '@/plugins/src/agent/handlers'

type Globals = Record<string, unknown>

describe('ChayaAgent handlers', () => {
  const g = globalThis as unknown as Globals

  afterEach(() => {
    delete g.ChayaFake
    delete g.Input
  })

  it('serializes cycles, functions and depth safely', () => {
    const obj: Record<string, unknown> = { a: 1, fn: () => 1, nested: { b: [1, 2] } }
    obj.self = obj
    expect(toJsonSafe(obj)).toEqual({ a: 1, nested: { b: [1, 2] }, self: '[Circular]' })
    expect(toJsonSafe(Number.NaN)).toBe('NaN')
  })

  it('calls Chaya* plugins with fluent chains', async () => {
    const actor = { hp: jest.fn((n: number) => ({ hp: n })) }
    g.ChayaFake = {
      gold(n: number) {
        return n * 2
      },
      actor: jest.fn(() => actor),
      self() {
        return g.ChayaFake
      },
    }
    expect(await runAgentCommand({ id: '1', method: 'plugin.call', params: { plugin: 'ChayaFake', method: 'gold', args: [5] } })).toBe(10)
    expect(await runAgentCommand({ id: '2', method: 'plugin.call', params: { plugin: 'ChayaFake', method: 'actor', args: [1], chain: [{ method: 'hp', args: [999] }] } })).toEqual({
      hp: 999,
    })
    expect(await runAgentCommand({ id: '3', method: 'plugin.call', params: { plugin: 'ChayaFake', method: 'self' } })).toBe('[ChayaFake]')
    expect((await runAgentCommand({ id: '4', method: 'plugins.list', params: {} })) as unknown[]).toContainEqual({ name: 'ChayaFake', methods: ['actor', 'gold', 'self'] })
  })

  it('refuses non-Chaya globals and missing methods', async () => {
    await expect(runAgentCommand({ id: '1', method: 'plugin.call', params: { plugin: 'process', method: 'exit' } })).rejects.toThrow('window.Chaya*')
    g.ChayaFake = {}
    await expect(runAgentCommand({ id: '2', method: 'plugin.call', params: { plugin: 'ChayaFake', method: 'nope' } })).rejects.toThrow('方法不存在')
  })

  it('holds a key for the requested frames', async () => {
    jest.useFakeTimers()
    const winGlobal = g as Globals & { window?: unknown }
    const hadWindow = 'window' in winGlobal
    if (!hadWindow) winGlobal.window = globalThis
    try {
      const input = { _currentState: {} as Record<string, boolean> }
      g.Input = input
      const done = runAgentCommand({ id: '1', method: 'input.press', params: { key: 'ok', frames: 6 } })
      expect(input._currentState.ok).toBe(true)
      jest.advanceTimersByTime(100)
      await expect(done).resolves.toEqual({ key: 'ok', frames: 6 })
      expect(input._currentState.ok).toBe(false)
    } finally {
      if (!hadWindow) delete winGlobal.window
      jest.useRealTimers()
    }
  })
})
