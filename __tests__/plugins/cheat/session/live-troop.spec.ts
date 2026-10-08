/**
 * @jest-environment node
 */
import { startTroopBattle } from '@/plugins/src/cheat/session/live-troop'

class SceneMap {}
class SceneBattle {}

describe('cheat/live-troop startTroopBattle', () => {
  const g = globalThis as Record<string, unknown>
  let interpreterBusy: boolean
  let messageBusy: boolean
  let transferring: boolean
  let sceneManager: { _scene: unknown; _nextScene: unknown; push: jest.Mock; goto: jest.Mock }
  let battleManager: { setup: jest.Mock; setEventCallback: jest.Mock }
  let makeEncounterCount: jest.Mock

  beforeEach(() => {
    interpreterBusy = false
    messageBusy = false
    transferring = false
    makeEncounterCount = jest.fn()
    sceneManager = { _scene: new SceneMap(), _nextScene: null, push: jest.fn(), goto: jest.fn() }
    battleManager = { setup: jest.fn(), setEventCallback: jest.fn() }
    Object.assign(g, {
      Scene_Map: SceneMap,
      Scene_Battle: SceneBattle,
      SceneManager: sceneManager,
      BattleManager: battleManager,
      $dataEnemies: [null, { name: 'Slime' }],
      $dataTroops: [null, { members: [{ enemyId: 1 }] }, { members: [{ enemyId: 9 }] }],
      $gameMap: { _interpreter: { isRunning: () => interpreterBusy } },
      $gameMessage: { isBusy: () => messageBusy },
      $gamePlayer: { isTransferring: () => transferring, makeEncounterCount },
      $gameParty: { battleMembers: () => [{}] },
    })
  })

  afterEach(() => {
    for (const key of ['Scene_Map', 'Scene_Battle', 'SceneManager', 'BattleManager', '$dataEnemies', '$dataTroops', '$gameMap', '$gameMessage', '$gamePlayer', '$gameParty'])
      delete g[key]
  })

  it('starts like Battle Processing: setup, reset steps, push the battle scene', () => {
    startTroopBattle({ id: 1, canEscape: false, canLose: true })
    expect(battleManager.setup).toHaveBeenCalledWith(1, false, true)
    expect(battleManager.setEventCallback).toHaveBeenCalledWith(null)
    expect(makeEncounterCount).toHaveBeenCalled()
    expect(sceneManager.push).toHaveBeenCalledWith(SceneBattle)
    expect(sceneManager.goto).not.toHaveBeenCalled()
  })

  it('resizes the troop to the chosen count before the battle scene builds sprites', () => {
    class Enemy {
      constructor(public id: number) {}
      enemyId = () => this.id
      isHidden = () => false
      screenX = () => 400
      screenY = () => 400
    }
    const troop = { _enemies: [new Enemy(1)], members: () => troop._enemies, makeUniqueNames: jest.fn() }
    Object.assign(g, { $gameTroop: troop, Game_Enemy: Enemy })
    try {
      startTroopBattle({ id: 1, count: 3 })
      expect(troop._enemies.map((e) => e.id)).toEqual([1, 1, 1])
      expect(sceneManager.push).toHaveBeenCalledWith(SceneBattle)
    } finally {
      delete g.$gameTroop
      delete g.Game_Enemy
    }
  })

  it('defaults to escapable and game over on defeat', () => {
    startTroopBattle({ id: 1 })
    expect(battleManager.setup).toHaveBeenCalledWith(1, true, false)
  })

  it.each([
    ['not on the map', () => (sceneManager._scene = new SceneBattle()), '请回到地图场景再开战'],
    ['changing scenes', () => (sceneManager._nextScene = SceneBattle), '场景切换中，请稍后再试'],
    ['transferring', () => (transferring = true), '传送中，请稍后再试'],
    ['an event is running', () => (interpreterBusy = true), '有事件正在执行，请等它结束再试'],
    ['a message is open', () => (messageBusy = true), '对话进行中，请稍后再试'],
  ])('rejects when %s', (_label, arrange, message) => {
    arrange()
    expect(() => startTroopBattle({ id: 1 })).toThrow(message)
    expect(battleManager.setup).not.toHaveBeenCalled()
  })

  it('rejects missing troops and troops without existing enemies', () => {
    expect(() => startTroopBattle({ id: 5 })).toThrow('敌群 5 不存在或没有敌人')
    expect(() => startTroopBattle({ id: 2 })).toThrow('敌群 2 不存在或没有敌人')
    expect(sceneManager.push).not.toHaveBeenCalled()
  })

  it('rejects a party with no battle members (instant game over)', () => {
    g.$gameParty = { battleMembers: () => [] }
    expect(() => startTroopBattle({ id: 1 })).toThrow('队伍中没有可出战的角色')
    expect(battleManager.setup).not.toHaveBeenCalled()
  })

  it('rejects a count for a troop whose enemies all appear mid-battle, but starts it without one', () => {
    ;(g.$dataTroops as unknown[])[3] = { members: [{ enemyId: 1, hidden: true }] }
    expect(() => startTroopBattle({ id: 3, count: 2 })).toThrow('该敌群的敌人都是中途出现，不能设置数量')
    expect(battleManager.setup).not.toHaveBeenCalled()
    startTroopBattle({ id: 3 })
    expect(battleManager.setup).toHaveBeenCalledWith(3, true, false)
  })
})
