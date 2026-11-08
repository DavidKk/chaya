import { StoryBattleDriver } from '@/plugins/mv/src/agent/runtime/companion-core/story-battle'

function windowFor(data: any[], onOk = jest.fn()): any {
  return {
    active: true,
    _data: data,
    _list: data,
    selected: -1,
    select(index: number) {
      this.selected = index
    },
    isCurrentItemEnabled() {
      return data[this.selected]?.enabled !== false
    },
    processOk: onOk,
    processCancel: jest.fn(),
  }
}

describe('story battle native command selection', () => {
  const engine = globalThis as any
  const keys = ['BattleManager', 'SceneManager', '$gameParty']
  let previous: unknown[]
  let actor: any
  let ally: any
  let potion: any

  beforeEach(() => {
    previous = keys.map((key) => engine[key])
    actor = { hp: 100, mhp: 100, name: () => 'Diana', canUse: () => true, usableSkills: () => [] }
    ally = { hp: 20, mhp: 100, name: () => 'Ally', usableSkills: () => [] }
    potion = { id: 126, name: 'Potion', scope: 7, damage: { type: 3 } }
    const action = { setItem: jest.fn(), setTarget: jest.fn() }
    engine.$gameParty = { battleMembers: () => [actor, ally], items: () => [potion], numItems: () => 3 }
    engine.SceneManager = {}
    engine.BattleManager = { actor: () => actor, inputtingAction: () => action, update: jest.fn(), selectNextCommand: jest.fn() }
  })

  afterEach(() => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete engine[key]
      else engine[key] = previous[index]
    })
  })

  test('confirms item and actor windows to heal the wounded ally', () => {
    const driver = new StoryBattleDriver(jest.fn(), jest.fn())
    const command = windowFor([{ symbol: 'attack' }, { symbol: 'item' }])
    driver.step({ _actorCommandWindow: command })
    expect(command.selected).toBe(1)
    expect(command.processOk).toHaveBeenCalledTimes(1)
    const item = windowFor([potion])
    driver.step({ _itemWindow: item })
    expect(item.processOk).toHaveBeenCalledTimes(1)
    const target = windowFor([actor, ally])
    driver.step({ _actorWindow: target })
    expect(target.selected).toBe(1)
    expect(target.processOk).toHaveBeenCalledTimes(1)
    expect(engine.BattleManager.inputtingAction().setItem).not.toHaveBeenCalled()
    expect(engine.BattleManager.inputtingAction().setTarget).not.toHaveBeenCalled()
    expect(engine.BattleManager.selectNextCommand).not.toHaveBeenCalled()
  })

  test('selects the healing skill type when no potion is available', () => {
    const skill = { id: 8, stypeId: 2, scope: 7, damage: { type: 3 } }
    actor.usableSkills = () => [skill]
    engine.$gameParty.items = () => []
    const command = windowFor([{ symbol: 'skill', ext: 1 }, { symbol: 'skill', ext: 2 }, { symbol: 'attack' }])
    new StoryBattleDriver(jest.fn(), jest.fn()).step({ _actorCommandWindow: command })
    expect(command.selected).toBe(1)
  })

  test('chooses the escape menu when critical and without healing', () => {
    engine.$gameParty.items = () => []
    const command = windowFor([{ symbol: 'fight' }, { symbol: 'escape' }])
    new StoryBattleDriver(jest.fn(), jest.fn()).step({ _partyCommandWindow: command })
    expect(command.selected).toBe(1)
    expect(command.processOk).toHaveBeenCalledTimes(1)
  })

  test('keeps fighting when a critical ally can receive a healing skill', () => {
    actor.usableSkills = () => [{ scope: 7, damage: { type: 3 } }]
    engine.$gameParty.items = () => []
    const command = windowFor([{ symbol: 'fight' }, { symbol: 'escape' }])
    new StoryBattleDriver(jest.fn(), jest.fn()).step({ _partyCommandWindow: command })
    expect(command.selected).toBe(0)
  })

  test('falls back after a planned item is absent from its native window', () => {
    const driver = new StoryBattleDriver(jest.fn(), jest.fn())
    const command = windowFor([{ symbol: 'attack' }, { symbol: 'item' }])
    driver.step({ _actorCommandWindow: command })
    const item = windowFor([])
    driver.step({ _itemWindow: item })
    expect(item.processCancel).toHaveBeenCalledTimes(1)
    driver.step({ _actorCommandWindow: command })
    expect(command.selected).toBe(0)
  })

  test('does not use a self-only potion to treat another actor', () => {
    potion.scope = 11
    const command = windowFor([{ symbol: 'attack' }, { symbol: 'item' }])
    new StoryBattleDriver(jest.fn(), jest.fn()).step({ _actorCommandWindow: command })
    expect(command.selected).toBe(0)
  })

  test('uses the displayed enemy order rather than troop indices', () => {
    const command = windowFor([])
    command._enemies = [
      { hp: 90, isAlive: () => true },
      { hp: 10, isAlive: () => true },
    ]
    new StoryBattleDriver(jest.fn(), jest.fn()).step({ _enemyWindow: command })
    expect(command.selected).toBe(1)
  })

  test('waits for native battle settlement and only confirms a paused message', () => {
    engine.BattleManager._phase = 'battleEnd'
    engine.BattleManager.updateBattleEnd = jest.fn()
    const press = jest.fn()
    const driver = new StoryBattleDriver(jest.fn(), press)
    const scene = { update: jest.fn(), _messageWindow: { pause: false } }
    driver.step(scene)
    expect(press).not.toHaveBeenCalled()
    scene._messageWindow.pause = true
    driver.step(scene)
    expect(press).toHaveBeenCalledTimes(1)
    expect(engine.BattleManager.updateBattleEnd).not.toHaveBeenCalled()
    expect(engine.BattleManager.update).not.toHaveBeenCalled()
    expect(scene.update).not.toHaveBeenCalled()
  })
})
