import { executeMapMenuEquip, executeMapMenuUseItem, isStoryMenuActive, tryMapMenuHealing } from '@/plugins/mv/src/agent/runtime/companion-core/story-menu'

describe('story menu window navigation', () => {
  const engine = globalThis as any
  const keys = ['SceneManager', 'Input', '$gamePlayer', '$gameParty', '$dataItems', '$dataWeapons', '$dataArmors']
  let previous: unknown[]
  let actor: any
  let potion: any
  let armor: any
  let count: number
  let confirmed: string[]
  let windows: any[]

  function selectable(name: string, data: any[], accept: (index: number) => void, cancel: () => void, active = true): any {
    const window: any = {
      active,
      _data: data,
      _list: data,
      index: -1,
      select(index: number) {
        window.index = index
      },
      isCurrentItemEnabled: () => data[window.index]?.enabled !== false,
      isCancelEnabled: () => true,
      processOk: jest.fn(() => {
        confirmed.push(name)
        window.active = false
        accept(window.index)
      }),
      processCancel: jest.fn(() => {
        window.active = false
        cancel()
      }),
    }
    windows.push(window)
    return window
  }

  function transition(scene: any): void {
    engine.SceneManager._nextScene = scene
    setTimeout(() => {
      engine.SceneManager._scene = scene
      engine.SceneManager._nextScene = null
    }, 20)
  }

  class Scene_Map {
    isMenuEnabled() {
      return true
    }
  }
  class Scene_Menu {
    _commandWindow: any
    _statusWindow: any
    constructor() {
      this._statusWindow = selectable(
        'actor',
        [actor],
        () => transition(new Scene_Equip()),
        () => {
          this._commandWindow.active = true
        },
        false
      )
      this._commandWindow = selectable(
        'menu',
        [{ symbol: 'item' }, { symbol: 'equip' }],
        (index) => {
          if (index === 0) transition(new Scene_Item())
          else this._statusWindow.active = true
        },
        () => transition(new Scene_Map())
      )
    }
  }
  class Scene_Item {
    _categoryWindow: any
    _itemWindow: any
    _actorWindow: any
    constructor() {
      this._categoryWindow = selectable(
        'category',
        [{ symbol: 'item' }],
        () => {
          this._itemWindow.active = true
        },
        () => transition(new Scene_Menu())
      )
      this._itemWindow = selectable(
        'item',
        engine.$gameParty.items(),
        () => {
          this._actorWindow.active = true
        },
        () => {
          this._categoryWindow.active = true
        },
        false
      )
      this._actorWindow = selectable(
        'target',
        [actor],
        () => {
          actor.hp = 100
          count--
          this._actorWindow.active = true
        },
        () => {
          this._itemWindow.active = true
        },
        false
      )
    }
  }
  class Scene_Equip {
    _commandWindow: any
    _slotWindow: any
    _itemWindow: any
    constructor() {
      this._commandWindow = selectable(
        'equip',
        [{ symbol: 'equip' }],
        () => {
          this._slotWindow.active = true
        },
        () => transition(new Scene_Menu())
      )
      this._slotWindow = selectable(
        'slot',
        [{}, {}],
        () => {
          this._itemWindow.active = true
        },
        () => {
          this._commandWindow.active = true
        },
        false
      )
      this._itemWindow = selectable(
        'armor',
        [armor],
        () => {
          actor.equipment[this._slotWindow.index] = armor
          this._slotWindow.active = true
        },
        () => {
          this._slotWindow.active = true
        },
        false
      )
    }
  }

  beforeEach(() => {
    previous = keys.map((key) => engine[key])
    jest.useFakeTimers()
    confirmed = []
    windows = []
    count = 3
    actor = { hp: 20, mhp: 100, mp: 10, equipment: [null, null], equips: () => actor.equipment, canUse: () => true }
    potion = { id: 1, name: 'Potion', scope: 7, damage: { type: 3 } }
    armor = { id: 5, name: 'Shield' }
    engine.$dataItems = [null, potion]
    engine.$dataWeapons = []
    engine.$dataArmors = [null, null, null, null, null, armor]
    engine.$gamePlayer = { isMoving: () => false }
    engine.$gameParty = { members: () => [actor], items: () => [potion], numItems: () => count }
    engine.SceneManager = { _scene: new Scene_Map(), push: jest.fn(), pop: jest.fn(), goto: jest.fn() }
    const state = { menu: false }
    Object.defineProperty(state, 'menu', {
      get: () => false,
      set: (value) => {
        if (value) transition(new Scene_Menu())
      },
    })
    engine.Input = { _currentState: state }
  })

  afterEach(() => {
    jest.useRealTimers()
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete engine[key]
      else engine[key] = previous[index]
    })
  })

  async function finish(task: Promise<boolean>): Promise<boolean> {
    await jest.runAllTimersAsync()
    return task
  }

  test('waits for native scene transitions and confirms item windows before healing', async () => {
    expect(await finish(executeMapMenuUseItem(1))).toBe(true)
    expect(confirmed).toEqual(['menu', 'category', 'item', 'target'])
    expect(actor.hp).toBe(100)
    expect(count).toBe(2)
    expect(engine.SceneManager._scene).toBeInstanceOf(Scene_Map)
    for (const name of ['push', 'pop', 'goto']) expect(engine.SceneManager[name]).not.toHaveBeenCalled()
  })

  test('selects armor from the armor database and confirms the selected slot', async () => {
    expect(await finish(executeMapMenuEquip(1, 5, false))).toBe(true)
    expect(actor.equipment).toEqual([null, armor])
    expect(confirmed).toEqual(['menu', 'actor', 'equip', 'slot', 'armor'])
    expect(engine.SceneManager._scene).toBeInstanceOf(Scene_Map)
  })

  test('does not close an existing player menu', async () => {
    const scene = new Scene_Item()
    engine.SceneManager._scene = scene
    expect(await finish(executeMapMenuUseItem(1))).toBe(false)
    expect(engine.SceneManager._scene).toBe(scene)
    expect(windows.every((window) => window.processCancel.mock.calls.length === 0)).toBe(true)
  })

  test('stops menu actions when the player preempts them', async () => {
    const abort = new AbortController()
    const task = executeMapMenuUseItem(1, 0, abort.signal)
    const rejection = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await jest.runAllTimersAsync()
    await rejection
    expect(count).toBe(3)
    expect(isStoryMenuActive()).toBe(false)
  })

  test('rejects a disabled item and returns through cancel windows', async () => {
    potion.enabled = false
    expect(await finish(executeMapMenuUseItem(1))).toBe(false)
    expect(confirmed).toEqual(['menu', 'category'])
    expect(actor.hp).toBe(20)
    expect(engine.SceneManager._scene).toBeInstanceOf(Scene_Map)
  })

  test('ignores MP recovery and hostile items even if their names suggest healing', async () => {
    potion.damage.type = 4
    expect(await finish(tryMapMenuHealing())).toBe(false)
    potion.damage.type = 3
    potion.scope = 1
    expect(await finish(tryMapMenuHealing())).toBe(false)
    expect(confirmed).toEqual([])
  })

  test('heals a wounded party member through the menu', async () => {
    const emit = jest.fn()
    expect(await finish(tryMapMenuHealing(emit))).toBe(true)
    expect(emit).toHaveBeenCalledWith(expect.stringContaining('打开游戏菜单'))
    expect(actor.hp).toBe(100)
  })

  test('tries another recovery item when the first is disabled in its native window', async () => {
    potion.enabled = false
    const alternative = { ...potion, id: 2, enabled: true }
    engine.$dataItems.push(alternative)
    engine.$gameParty.items = () => [potion, alternative]

    expect(await finish(tryMapMenuHealing())).toBe(true)
    expect(actor.hp).toBe(100)
    expect(count).toBe(2)
  })

  test('does not repeatedly open the menu for a self-only item belonging to a different user', async () => {
    potion.scope = 11
    const user = { hp: 100, mhp: 100, pha: 2, canUse: () => true }
    engine.$gameParty.members = () => [actor, user]
    engine.$gameParty.movableMembers = () => [actor, user]

    expect(await finish(tryMapMenuHealing())).toBe(false)
    expect(await finish(tryMapMenuHealing())).toBe(false)
    expect(confirmed).toEqual([])
  })
})
