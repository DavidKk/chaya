import { runAgentCommand, toJsonSafe } from '@/plugins/src/agent/handlers'
import { declarePluginTools } from '@/plugins/src/helpers/plugin-tools'

type Globals = Record<string, unknown>

describe('ChayaAgent handlers', () => {
  const g = globalThis as unknown as Globals

  afterEach(() => {
    delete g.ChayaBoost
    delete g.Input
  })

  it('serializes cycles, functions and depth safely', () => {
    const obj: Record<string, unknown> = { a: 1, fn: () => 1, nested: { b: [1, 2] } }
    obj.self = obj
    expect(toJsonSafe(obj)).toEqual({ a: 1, nested: { b: [1, 2] }, self: '[Circular]' })
    expect(toJsonSafe(Number.NaN)).toBe('NaN')
  })

  it('lists first-party plugins without exposing their methods', async () => {
    g.ChayaBoost = { gold: () => 1 }
    g.ChayaAgent = { run: jest.fn() }
    const plugins = (await runAgentCommand({ id: '1', method: 'plugins.list', params: {} })) as Array<{ name: string }>
    expect(plugins).toContainEqual({ name: 'ChayaBoost', tools: [] })
    expect(plugins.map((p) => p.name)).not.toContain('ChayaAgent')
    delete g.ChayaAgent
  })

  it('has no arbitrary plugin method call', async () => {
    g.ChayaBoost = { gold: jest.fn() }
    await expect(runAgentCommand({ id: '1', method: 'plugin.call', params: { plugin: 'ChayaBoost', method: 'gold' } } as never)).rejects.toThrow('未知指令')
    expect((g.ChayaBoost as { gold: jest.Mock }).gold).not.toHaveBeenCalled()
  })

  it('evals only when the caller allows it', async () => {
    const cmd = { id: '1', method: 'game.eval' as const, params: { code: 'return 1 + 1' } }
    await expect(runAgentCommand(cmd)).rejects.toThrow('不允许')
    expect(await runAgentCommand(cmd, { allowEval: true })).toBe(2)
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

  it('rejects a guarded choice and a stale selection before dispatching input', async () => {
    const originalDocument = g.document
    const scene = {
      constructor: { name: 'Scene_Map' },
      _choiceWindow: { visible: true, openness: 255, active: true, _index: 0, currentSymbol: () => null, item: () => null },
    }
    g.document = { title: 'Game', body: { innerText: '' } }
    g.SceneManager = { _scene: scene }
    g.$gameMessage = { isBusy: () => true, isChoice: () => true, choices: () => ['是', '否'], allText: () => '请选择' }
    try {
      const state = (await runAgentCommand({ id: 'state', method: 'game.state', params: {} })) as { controlToken: string }
      const guard = { controlToken: state.controlToken, allowedEffects: ['navigate', 'advance_dialogue'] as Array<'navigate' | 'advance_dialogue'> }
      await expect(runAgentCommand({ id: 'choice', method: 'input.press', params: { key: 'ok', guard } })).rejects.toThrow('ACTION_REQUIRES_CONFIRMATION:choose_branch')
      scene._choiceWindow._index = 1
      await expect(runAgentCommand({ id: 'stale', method: 'input.press', params: { key: 'ok', guard } })).rejects.toThrow('STATE_CHANGED')
    } finally {
      if (originalDocument === undefined) delete g.document
      else g.document = originalDocument
      delete g.SceneManager
      delete g.$gameMessage
    }
  })

  it('dispatches DOM keys and runs a sequence with the resulting state', async () => {
    jest.useFakeTimers()
    const winGlobal = g as Globals & { window?: unknown; document?: unknown; KeyboardEvent?: unknown }
    const hadWindow = 'window' in winGlobal
    const hadDocument = 'document' in winGlobal
    const hadKeyboardEvent = 'KeyboardEvent' in winGlobal
    if (!hadWindow) winGlobal.window = globalThis
    if (!hadDocument) winGlobal.document = new EventTarget()
    if (!hadKeyboardEvent) {
      winGlobal.KeyboardEvent = class extends Event {
        key: string
        code: string
        constructor(type: string, init: { key?: string; code?: string } = {}) {
          super(type)
          this.key = init.key ?? ''
          this.code = init.code ?? ''
        }
      }
    }
    const keys: string[] = []
    const onKey = (event: KeyboardEvent) => keys.push(`${event.type}:${event.key}`)
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKey)
    try {
      g.Input = { clear() {} }
      const done = runAgentCommand({
        id: '1',
        method: 'input.sequence',
        params: {
          steps: [
            { key: 'down', frames: 1, waitFrames: 1 },
            { key: 'ok', frames: 1, waitFrames: 0 },
          ],
        },
      })
      await jest.runAllTimersAsync()
      await expect(done).resolves.toMatchObject({ actions: [{ key: 'down' }, { key: 'ok' }], state: { scene: null } })
      expect(keys).toEqual(['keydown:ArrowDown', 'keyup:ArrowDown', 'keydown:Enter', 'keyup:Enter'])
    } finally {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onKey)
      if (!hadWindow) delete winGlobal.window
      if (!hadDocument) delete winGlobal.document
      if (!hadKeyboardEvent) delete winGlobal.KeyboardEvent
      jest.useRealTimers()
    }
  })

  it('refuses undeclared, non-catalog and prototype tool names', async () => {
    const run = jest.fn(() => 1)
    declarePluginTools('ChayaBoost', { on: run })
    for (const params of [
      { plugin: 'ChayaBoost', tool: 'off' },
      { plugin: 'ChayaBoost', tool: 'constructor' },
      { plugin: 'ChayaBoost', tool: '__proto__' },
      { plugin: 'ChayaEdit', tool: 'gold' },
      { plugin: 'process', tool: 'exit' },
    ]) {
      await expect(runAgentCommand({ id: 'x', method: 'plugin.tool', params })).rejects.toThrow('插件工具不存在')
    }
    expect(run).not.toHaveBeenCalled()
    delete g.__chayaPluginTools
  })

  it('runs declared plugin tools and lists them with plugins', async () => {
    g.ChayaBoost = {}
    const run = jest.fn((input: Record<string, unknown>) => ({ rate: input.rate }))
    declarePluginTools('ChayaBoost', { on: run, bad: run })
    expect(await runAgentCommand({ id: '1', method: 'plugin.tool', params: { plugin: 'ChayaBoost', tool: 'on', input: { rate: 3 } } })).toEqual({ rate: 3 })
    await expect(runAgentCommand({ id: '2', method: 'plugin.tool', params: { plugin: 'ChayaBoost', tool: 'bad' } })).rejects.toThrow('插件工具不存在')
    const plugins = (await runAgentCommand({ id: '3', method: 'plugins.list', params: {} })) as Array<{ name: string; tools?: Array<{ tool: string }> }>
    expect(plugins.find((p) => p.name === 'ChayaBoost')?.tools?.map((t) => t.tool)).toEqual(['on'])
    delete g.__chayaPluginTools
  })

  describe('edit commands', () => {
    const api = { state: jest.fn(() => ({ gold: 1 })), apply: jest.fn(() => ({ applied: true })), action: jest.fn(() => ({ ok: true })) }

    beforeEach(() => {
      g.ChayaEdit = { agentEdit: api }
      jest.clearAllMocks()
    })
    afterEach(() => delete g.ChayaEdit)

    it('reads the session and forwards validated ops / actions to ChayaEdit', async () => {
      expect(await runAgentCommand({ id: '1', method: 'edit.state', params: {} })).toEqual({ gold: 1 })
      expect(await runAgentCommand({ id: '2', method: 'edit.apply', params: { op: { op: 'gold', value: 5 } } })).toEqual({ applied: true })
      expect(api.apply).toHaveBeenCalledWith({ op: 'gold', value: 5 })
      await runAgentCommand({ id: '3', method: 'edit.action', params: { action: { id: 'teleport', mapId: 2, x: 3, y: 4 } } })
      expect(api.action).toHaveBeenCalledWith(expect.objectContaining({ id: 'teleport', mapId: 2, x: 3, y: 4 }))
    })

    it('re-validates untrusted payloads before touching the game', async () => {
      await expect(runAgentCommand({ id: '1', method: 'edit.apply', params: { op: { op: 'eval', value: 1 } as never } })).rejects.toThrow()
      await expect(runAgentCommand({ id: '2', method: 'edit.action', params: { action: { id: 'rm -rf' } as never } })).rejects.toThrow()
      expect(api.apply).not.toHaveBeenCalled()
      expect(api.action).not.toHaveBeenCalled()
    })

    it('returns the whole catalog without truncating long lists', async () => {
      const items = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, name: `item${i + 1}` }))
      g.ChayaEdit = { agentEdit: api, catalog: () => ({ items }) }
      const catalog = (await runAgentCommand({ id: '1', method: 'edit.catalog', params: {} })) as { items: unknown[] }
      expect(catalog.items).toHaveLength(250)
    })

    it('reports a missing ChayaEdit', async () => {
      delete g.ChayaEdit
      await expect(runAgentCommand({ id: '1', method: 'edit.state', params: {} })).rejects.toThrow('修改插件未就绪')
      await expect(runAgentCommand({ id: '2', method: 'edit.catalog', params: {} })).rejects.toThrow('修改插件未就绪')
    })
  })
})
