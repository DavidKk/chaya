import { chestEventOpened } from '@/plugins/src/agent/event-facts'
import { readAgentGameState, runAgentCommand, toJsonSafe } from '@/plugins/src/agent/handlers'
import { declarePluginTools } from '@/plugins/src/helpers/plugin-tools'

type Globals = Record<string, unknown>

describe('ChayaAgent handlers', () => {
  const g = globalThis as unknown as Globals

  afterEach(() => {
    delete g.ChayaBoost
    delete g.Input
    delete g.__chayaGameSaves
    delete g.$gameSelfSwitches
  })

  it('serializes cycles, functions and depth safely', () => {
    const obj: Record<string, unknown> = { a: 1, fn: () => 1, nested: { b: [1, 2] } }
    obj.self = obj
    expect(toJsonSafe(obj)).toEqual({ a: 1, nested: { b: [1, 2] }, self: '[Circular]' })
    expect(toJsonSafe(Number.NaN)).toBe('NaN')
  })

  it('treats a later chest page as opened when its opening self-switch is on', () => {
    const event = {
      _pageIndex: 1,
      event: () => ({
        pages: [
          { image: { characterName: '!Chest', characterIndex: 0, direction: 2 } },
          { image: { characterName: '!Chest', characterIndex: 0, direction: 2 }, conditions: { selfSwitchValid: true, selfSwitchCh: 'A' } },
        ],
      }),
    }
    g.$gameSelfSwitches = { value: jest.fn(() => false) }
    expect(chestEventOpened(event, 2, 4)).toBe(false)
    ;(g.$gameSelfSwitches as { value: jest.Mock }).value.mockReturnValue(true)
    expect(chestEventOpened(event, 2, 4)).toBe(true)
  })

  it('recognizes an opened chest from the changed event-page image', () => {
    const event = {
      _pageIndex: 1,
      event: () => ({
        pages: [{ image: { characterName: '!Chest', characterIndex: 3, direction: 2 } }, { image: { characterName: '!Chest', characterIndex: 3, direction: 8 }, conditions: {} }],
      }),
    }
    expect(chestEventOpened(event, 2, 18)).toBe(true)
  })

  it('does not treat an unrelated conditional page as an opened chest', () => {
    const image = { characterName: '!Chest', characterIndex: 3, direction: 2 }
    const event = { _pageIndex: 1, event: () => ({ pages: [{ image }, { image: { ...image }, conditions: { switch1Valid: true, switch1Id: 10 } }] }) }
    expect(chestEventOpened(event, 2, 18)).toBe(false)
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

  it('routes save snapshot and load commands to the game-saves controller', async () => {
    const saves = { agentSnapshot: jest.fn(async () => ({ index: { entries: [] } })), agentLoad: jest.fn(async () => ({ loaded: true })) }
    const originalWindow = g.window
    g.window = globalThis
    g.__chayaGameSaves = saves
    try {
      await expect(runAgentCommand({ id: 's1', method: 'game.saves', params: { op: 'snapshot' } })).resolves.toMatchObject({
        chaya: { index: { entries: [] } },
        native: expect.any(Array),
      })
      await expect(runAgentCommand({ id: 's2', method: 'game.saves', params: { op: 'load', entryId: 'quick-1' } })).resolves.toEqual({ loaded: true })
      expect(saves.agentLoad).toHaveBeenCalledWith('quick-1', undefined)
    } finally {
      if (originalWindow === undefined) delete g.window
      else g.window = originalWindow
    }
  })

  it('exposes actor equipment and status needed for basic play decisions', () => {
    const originals = { document: g.document, SceneManager: g.SceneManager, $gameParty: g.$gameParty }
    g.document = { title: 'Game', body: { innerText: '' } }
    g.SceneManager = { _scene: { constructor: { name: 'Scene_Map' } } }
    g.$gameParty = {
      members: () => [
        {
          _level: 7,
          _hp: 80,
          _mp: 20,
          _tp: 15,
          actorId: () => 1,
          name: () => 'Hero',
          currentClass: () => ({ id: 2, name: 'Knight' }),
          param: (id: number) => (id === 0 ? 100 : 30),
          equips: () => [{ id: 4, name: 'Iron Sword' }, null],
          states: () => [{ id: 5, name: 'Poison' }],
        },
      ],
      items: () => [],
      weapons: () => [],
      armors: () => [],
      gold: () => 10,
    }
    try {
      expect(readAgentGameState().party[0]).toMatchObject({
        class: { id: 2, name: 'Knight' },
        tp: 15,
        equipment: [
          { slot: 0, id: 4, name: 'Iron Sword' },
          { slot: 1, id: null, name: null },
        ],
        states: [{ id: 5, name: 'Poison' }],
      })
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete g[key]
        else g[key] = value
      }
    }
  })

  it('reports what each event page does and leaves naming its kind to the model', () => {
    const originals = {
      document: g.document,
      SceneManager: g.SceneManager,
      $gameMap: g.$gameMap,
      $gamePlayer: g.$gamePlayer,
      ImageManager: g.ImageManager,
      Game_Message: g.Game_Message,
    }
    g.ImageManager = { isObjectCharacter: (name: string) => name.startsWith('!') }
    g.Game_Message = class {
      _texts: string[] = []
      add(text: string) {
        this._texts.push(text === '{Map004-22}' ? 'Пусто!' : text)
      }
    }
    const event = (eventId: number, name: string, sprite: string, trigger: number, codes: number[], text?: string) => ({
      _x: eventId,
      _y: 1,
      _characterName: sprite,
      _trigger: trigger,
      _pageIndex: 0,
      eventId: () => eventId,
      event: () => ({ name, pages: [] }),
      list: () => [...codes.map((code) => ({ code, parameters: code === 401 ? [text ?? ''] : [] })), { code: 0 }],
    })
    g.document = { title: 'Game', body: { innerText: '' } }
    g.SceneManager = { _scene: { constructor: { name: 'Scene_Map' } } }
    g.$gamePlayer = { _x: 0, _y: 1 }
    g.$gameMap = {
      mapId: () => 4,
      events: () => [
        event(1, 'EV001', '!DoorBigWhite1', 1, [250, 205]),
        event(2, 'Борис', 'People1', 0, [101, 401], 'Привет'),
        { ...event(3, 'EV003', '!Flame', 0, [101, 401, 123], '{Map004-22}'), _stepAnime: true },
        event(4, 'EV004', '!Flame', 0, [101, 401, 125], '+ 30 \\G.'),
        event(5, 'Свет', '!fsm_Flame01', 0, []),
        event(6, 'EV006', 'Monster', 0, [301]),
        event(7, 'Доска', '!Other1', 0, [101, 401], 'Новое задание'),
        event(8, 'EV008', '', 1, [201]),
        { ...event(9, 'EV009', '', 1, [101, 401], '{Map004-99}'), _tileId: 23, _stepAnime: true },
      ],
    }
    try {
      const summary = readAgentGameState().nearbyEvents.map(({ id, effects, interactive, hint, look, animated }) => ({ id, effects, interactive, hint, look, animated }))
      expect(summary).toEqual([
        { id: 1, effects: [], interactive: true, hint: null, look: 'object', animated: false },
        { id: 2, effects: ['text'], interactive: true, hint: 'Привет', look: 'character', animated: false },
        { id: 3, effects: ['text'], interactive: true, hint: 'Пусто!', look: 'object', animated: true },
        { id: 4, effects: ['text', 'gold'], interactive: true, hint: '+ 30 \\G.', look: 'object', animated: false },
        { id: 5, effects: [], interactive: false, hint: null, look: 'object', animated: false },
        { id: 6, effects: ['battle'], interactive: true, hint: null, look: 'character', animated: false },
        { id: 7, effects: ['text'], interactive: true, hint: 'Новое задание', look: 'object', animated: false },
        { id: 8, effects: ['transfer'], interactive: true, hint: null, look: 'none', animated: false },
        { id: 9, effects: ['text'], interactive: true, hint: null, look: 'tile', animated: true },
      ])
      expect(readAgentGameState().nearbyEvents[0]).not.toHaveProperty('category')
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete g[key]
        else g[key] = value
      }
    }
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

  it('waits for the game to process a guarded key release', async () => {
    jest.useFakeTimers()
    const originalWindow = g.window
    const originalDocument = g.document
    g.window = globalThis
    g.document = { title: 'Game', body: { innerText: '' } }
    g.Input = { _currentState: {} }
    g.SceneManager = { _scene: { constructor: { name: 'Scene_Battle' } } }
    try {
      const state = (await runAgentCommand({ id: 'state', method: 'game.state', params: {} })) as { controlToken: string }
      const done = runAgentCommand({
        id: 'press',
        method: 'input.press',
        params: { key: 'ok', frames: 6, guard: { controlToken: state.controlToken, allowedEffects: ['unknown'] } },
      })
      let settled = false
      void done.then(() => {
        settled = true
      })
      await jest.advanceTimersByTimeAsync(100)
      expect(settled).toBe(false)
      expect((g.Input as { _currentState: Record<string, boolean> })._currentState.ok).toBe(false)
      await jest.advanceTimersByTimeAsync(34)
      await expect(done).resolves.toMatchObject({ key: 'ok', frames: 6 })
    } finally {
      if (originalWindow === undefined) delete g.window
      else g.window = originalWindow
      if (originalDocument === undefined) delete g.document
      else g.document = originalDocument
      delete g.SceneManager
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

  it('guards a sequence to arrow keys in the current battle', async () => {
    const originalDocument = g.document
    g.document = { title: 'Game', body: { innerText: '' } }
    g.SceneManager = { _scene: { constructor: { name: 'Scene_Battle' } } }
    try {
      const state = (await runAgentCommand({ id: 'state', method: 'game.state', params: {} })) as { controlToken: string; commandInputs: unknown[] }
      expect(state.commandInputs).toEqual([])
      const guard = { controlToken: state.controlToken, allowedEffects: ['navigate' as const] }
      const ok = { id: 'ok', method: 'input.sequence' as const, params: { steps: [{ key: 'up' as const }, { key: 'ok' as const }], guard } }
      await expect(runAgentCommand(ok)).rejects.toThrow('ACTION_REQUIRES_CONFIRMATION:unknown')
      const stale = { id: 'stale', method: 'input.sequence' as const, params: { steps: [{ key: 'up' as const }], guard: { ...guard, controlToken: 'old' } } }
      await expect(runAgentCommand(stale)).rejects.toThrow('STATE_CHANGED')
    } finally {
      if (originalDocument === undefined) delete g.document
      else g.document = originalDocument
      delete g.SceneManager
    }
  })

  it('stops a guarded sequence when the battle ends between keys', async () => {
    jest.useFakeTimers()
    const originals = { document: g.document, window: g.window }
    g.document = { title: 'Game', body: { innerText: '' } }
    g.window = globalThis
    const input = { _currentState: {} as Record<string, boolean> }
    g.Input = input
    const scene = { constructor: { name: 'Scene_Battle' } }
    g.SceneManager = { _scene: scene }
    try {
      const state = (await runAgentCommand({ id: 'state', method: 'game.state', params: {} })) as { controlToken: string }
      const guard = { controlToken: state.controlToken, allowedEffects: ['navigate' as const] }
      const done = runAgentCommand({ id: 'combo', method: 'input.sequence', params: { steps: [{ key: 'right' }, { key: 'right' }], guard } })
      const failed = expect(done).rejects.toThrow('SCOPE_CHANGED')
      scene.constructor = { name: 'Scene_Map' }
      await jest.advanceTimersByTimeAsync(1_000)
      await failed
      expect(input._currentState.right).toBe(false)
    } finally {
      for (const [name, value] of Object.entries(originals)) {
        if (value === undefined) delete g[name]
        else g[name] = value
      }
      delete g.SceneManager
      jest.useRealTimers()
    }
  })

  it('allows interaction only with the bound map event', async () => {
    jest.useFakeTimers()
    const originals = { document: g.document, window: g.window, SceneManager: g.SceneManager, $gameMap: g.$gameMap, $gamePlayer: g.$gamePlayer, $gameMessage: g.$gameMessage }
    g.document = { title: 'Game', body: { innerText: '' } }
    g.window = globalThis
    g.SceneManager = { _scene: { constructor: { name: 'Scene_Map' } } }
    g.$gamePlayer = { _x: 9, _y: 4, direction: () => 4 }
    g.$gameMap = { mapId: () => 1, events: () => [{ _x: 8, _y: 4, _eventId: 1, eventId: () => 1, event: () => ({ name: '村长' }) }] }
    g.$gameMessage = { isBusy: () => false, isChoice: () => false, allText: () => '' }
    g.Input = { _currentState: {} }
    try {
      const state = (await runAgentCommand({ id: 'state', method: 'game.state', params: {} })) as { controlToken: string }
      const guard = { controlToken: state.controlToken, mapId: 1, allowedEffects: ['interact_event' as const] }
      await expect(runAgentCommand({ id: 'wrong', method: 'input.press', params: { key: 'ok', guard: { ...guard, targetEventId: 2 } } })).rejects.toThrow('SCOPE_CHANGED')
      const done = runAgentCommand({ id: 'elder', method: 'input.press', params: { key: 'ok', guard: { ...guard, targetEventId: 1 } } })
      await jest.runAllTimersAsync()
      await expect(done).resolves.toMatchObject({ key: 'ok' })
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete g[key]
        else g[key] = value
      }
      jest.useRealTimers()
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
