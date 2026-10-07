/**
 * @jest-environment node
 */
import {
  addEnemy,
  killEnemy,
  readBattleState,
  recoverEnemy,
  resizeTroop,
  reviveEnemy,
  settleBattleEnd,
  transformEnemy,
  writeEnemyHp,
  writeEnemyMhp,
} from '@/plugins/src/cheat/session/live-battle'

class SceneBattle {
  _spriteset: unknown
  _enemyWindow = { active: false, refresh: jest.fn() }
}
class SceneMap {}

const DATA = [null, { name: 'Slime', battlerName: 'slime' }, { name: 'Bat', battlerName: 'bat' }, { name: 'King', battlerName: 'king' }]

class FakeEnemy {
  hp = 100
  mhp = 100
  mmp = 20
  _letter = ''
  _hidden = false
  _screenX: number
  _screenY: number
  constructor(
    public id: number,
    x: number,
    y: number
  ) {
    this._screenX = x
    this._screenY = y
  }
  enemyId = () => this.id
  name = () => DATA[this.id]!.name + this._letter
  battlerName = () => DATA[this.id]!.battlerName
  isHidden = () => this._hidden
  isAlive = () => !this._hidden && this.hp > 0
  hide = () => (this._hidden = true)
  screenX = () => this._screenX
  screenY = () => this._screenY
  transform = jest.fn((id: number) => {
    this.id = id
    this.mhp = 300
    this.hp = Math.min(this.hp, this.mhp)
  })
  setHp = jest.fn((hp: number) => (this.hp = hp))
  setMp = jest.fn()
  isDead = () => !this._hidden && this.hp <= 0
  performCollapse = jest.fn()
  plus = 0
  paramBase = () => 100
  paramPlus = () => this.plus
  param = () => this.mhp
  addParam = jest.fn((_id: number, v: number) => {
    this.plus += v
    this.mhp = (100 + this.plus) * 2
    this.hp = Math.min(this.hp, this.mhp)
  })
  onBattleStart = jest.fn()
}

class FakeSprite {
  bitmap = { width: 100, height: 100, isReady: () => true }
  constructor(public _battler: FakeEnemy) {}
  setHome = jest.fn()
}

describe('cheat/live-battle', () => {
  const g = globalThis as Record<string, unknown>
  let troop: { _enemies: FakeEnemy[]; _namesCount: Record<string, number>; members: () => FakeEnemy[]; makeUniqueNames: jest.Mock; isAllDead: () => boolean }
  let scene: SceneBattle
  let field: { children: unknown[]; addChild: jest.Mock; removeChild: jest.Mock }
  let spriteset: { _battleField: typeof field; _enemySprites: FakeSprite[]; update: jest.Mock }
  let battleManager: { _phase: string; processVictory: jest.Mock; processDefeat: jest.Mock }

  beforeEach(() => {
    jest.useFakeTimers()
    const enemies = [new FakeEnemy(1, 300, 400), new FakeEnemy(1, 500, 400)]
    troop = { _enemies: enemies, _namesCount: {}, members: () => troop._enemies, makeUniqueNames: jest.fn(), isAllDead: () => troop._enemies.every((e) => !e.isAlive()) }
    field = { children: [], addChild: jest.fn((c) => field.children.push(c)), removeChild: jest.fn((c) => field.children.splice(field.children.indexOf(c), 1)) }
    spriteset = { _battleField: field, _enemySprites: enemies.map((e) => new FakeSprite(e)), update: jest.fn() }
    field.children.push(...spriteset._enemySprites)
    scene = new SceneBattle()
    scene._spriteset = spriteset
    battleManager = { _phase: 'input', processVictory: jest.fn(), processDefeat: jest.fn() }
    Object.assign(g, {
      Scene_Battle: SceneBattle,
      Scene_Map: SceneMap,
      SceneManager: { _scene: scene, _nextScene: null },
      BattleManager: battleManager,
      $gameTroop: troop,
      $dataEnemies: DATA,
      Game_Enemy: FakeEnemy,
      Sprite_Enemy: FakeSprite,
      Graphics: { boxWidth: 816, boxHeight: 624 },
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    for (const key of ['Scene_Battle', 'Scene_Map', 'SceneManager', 'BattleManager', '$gameTroop', '$dataEnemies', 'Game_Enemy', 'Sprite_Enemy', 'Graphics']) delete g[key]
  })

  describe('readBattleState', () => {
    it('lists the field with hp and flags', () => {
      troop._enemies[1]!.hp = 0
      troop._enemies.push(Object.assign(new FakeEnemy(2, 0, 0), { _hidden: true }))
      expect(readBattleState()).toEqual({
        ended: false,
        enemies: [
          { index: 0, enemyId: 1, name: 'Slime', hp: 100, mhp: 100, alive: true, appeared: true },
          { index: 1, enemyId: 1, name: 'Slime', hp: 0, mhp: 100, alive: false, appeared: true },
          { index: 2, enemyId: 2, name: 'Bat', hp: 100, mhp: 100, alive: true, appeared: false },
        ],
        party: [],
        partyIds: [],
        partyMax: 4,
        settling: false,
      })
    })

    it('is null outside battle and marks a settling battle as ended', () => {
      battleManager._phase = 'battleEnd'
      expect(readBattleState()?.ended).toBe(true)
      ;(g.SceneManager as { _scene: unknown })._scene = new SceneMap()
      expect(readBattleState()).toBeNull()
    })
  })

  describe('transformEnemy', () => {
    it('transforms, refills HP / MP and renames', () => {
      const enemy = troop._enemies[0]!
      enemy.hp = 30
      transformEnemy({ index: 0, fromEnemyId: 1, enemyId: 3 })
      expect(enemy.transform).toHaveBeenCalledWith(3)
      expect(enemy.setHp).toHaveBeenCalledWith(300)
      expect(enemy.setMp).toHaveBeenCalledWith(20)
      expect(troop.makeUniqueNames).toHaveBeenCalled()
    })

    it.each([
      ['field changed', () => {}, { index: 0, fromEnemyId: 2, enemyId: 3 }, '场上敌人已变化，请重试'],
      ['missing index', () => {}, { index: 9, fromEnemyId: 1, enemyId: 3 }, '场上敌人已变化，请重试'],
      ['fallen', () => (troop._enemies[0]!.hp = 0), { index: 0, fromEnemyId: 1, enemyId: 3 }, '该敌人已倒下'],
      ['not appeared', () => troop._enemies[0]!.hide(), { index: 0, fromEnemyId: 1, enemyId: 3 }, '该敌人尚未出现'],
      ['battle ended', () => (battleManager._phase = 'battleEnd'), { index: 0, fromEnemyId: 1, enemyId: 3 }, '战斗已结束'],
      ['unknown enemy', () => {}, { index: 0, fromEnemyId: 1, enemyId: 99 }, '敌人 99 不存在'],
      ['not in battle', () => ((g.SceneManager as { _scene: unknown })._scene = new SceneMap()), { index: 0, fromEnemyId: 1, enemyId: 3 }, '只能在战斗中使用'],
    ])('rejects when %s', (_label, arrange, req, message) => {
      arrange()
      expect(() => transformEnemy(req)).toThrow(message)
    })
  })

  describe('killEnemy', () => {
    it('drops HP to 0 and plays the collapse', () => {
      const enemy = troop._enemies[1]!
      killEnemy({ index: 1, fromEnemyId: 1 })
      expect(enemy.hp).toBe(0)
      expect(enemy.performCollapse).toHaveBeenCalled()
      expect(troop._enemies[0]!.hp).toBe(100)
      expect(battleManager.processVictory).not.toHaveBeenCalled()
    })

    it('settles victory when the last enemy falls during command input', () => {
      const enemyWindow = Object.assign(scene._enemyWindow, { active: true, deactivate: jest.fn(), hide: jest.fn() })
      troop._enemies[0]!.hp = 0
      killEnemy({ index: 1, fromEnemyId: 1 })
      expect(battleManager.processVictory).toHaveBeenCalledTimes(1)
      expect(enemyWindow.deactivate).toHaveBeenCalled()
      expect(enemyWindow.hide).toHaveBeenCalled()
    })

    it('leaves the end check to the engine outside command input or while a troop event runs', () => {
      troop._enemies[0]!.hp = 0
      battleManager._phase = 'turn'
      killEnemy({ index: 1, fromEnemyId: 1 })
      expect(battleManager.processVictory).not.toHaveBeenCalled()
    })

    it.each([
      ['field changed', () => {}, { index: 0, fromEnemyId: 2 }, '场上敌人已变化，请重试'],
      ['fallen', () => (troop._enemies[0]!.hp = 0), { index: 0, fromEnemyId: 1 }, '该敌人已倒下'],
      ['not appeared', () => troop._enemies[0]!.hide(), { index: 0, fromEnemyId: 1 }, '该敌人尚未出现'],
      ['battle ended', () => (battleManager._phase = 'battleEnd'), { index: 0, fromEnemyId: 1 }, '战斗已结束'],
    ])('rejects when %s', (_label, arrange, req, message) => {
      arrange()
      expect(() => killEnemy(req)).toThrow(message)
    })
  })

  describe('writeEnemyHp', () => {
    it('sets HP clamped to 0..mhp; 0 plays the collapse', () => {
      const enemy = troop._enemies[0]!
      writeEnemyHp({ index: 0, fromEnemyId: 1, hp: 37.8 })
      expect(enemy.hp).toBe(37)
      writeEnemyHp({ index: 0, fromEnemyId: 1, hp: 9999 })
      expect(enemy.hp).toBe(100)
      expect(enemy.performCollapse).not.toHaveBeenCalled()
      writeEnemyHp({ index: 0, fromEnemyId: 1, hp: -5 })
      expect(enemy.hp).toBe(0)
      expect(enemy.performCollapse).toHaveBeenCalled()
    })

    it('rejects a fallen enemy or a changed field', () => {
      expect(() => writeEnemyHp({ index: 0, fromEnemyId: 2, hp: 5 })).toThrow('场上敌人已变化，请重试')
      troop._enemies[0]!.hp = 0
      expect(() => writeEnemyHp({ index: 0, fromEnemyId: 1, hp: 5 })).toThrow('该敌人已倒下')
    })
  })

  describe('writeEnemyMhp', () => {
    it('reaches the target through the additive bonus, keeping the rate', () => {
      const enemy = troop._enemies[0]!
      enemy.mhp = 200
      writeEnemyMhp({ index: 0, fromEnemyId: 1, mhp: 600 })
      expect(enemy.addParam).toHaveBeenCalledWith(0, 200)
      expect(enemy.mhp).toBe(600)
      writeEnemyMhp({ index: 0, fromEnemyId: 1, mhp: 50 })
      expect(enemy.mhp).toBe(50)
      expect(enemy.hp).toBe(50)
    })
  })

  describe('settleBattleEnd', () => {
    it('force settles a stuck battle in any live phase, and does nothing otherwise', () => {
      battleManager._phase = 'turn'
      expect(settleBattleEnd({ force: true })).toBe(false)
      for (const e of troop._enemies) e.hp = 0
      expect(settleBattleEnd()).toBe(false)
      expect(settleBattleEnd({ force: true })).toBe(true)
      expect(battleManager.processVictory).toHaveBeenCalledTimes(1)

      battleManager._phase = 'battleEnd'
      expect(settleBattleEnd({ force: true })).toBe(false)
      battleManager._phase = 'input'
      ;(g.SceneManager as { _scene: unknown })._scene = new SceneMap()
      expect(settleBattleEnd({ force: true })).toBe(false)
      expect(battleManager.processVictory).toHaveBeenCalledTimes(1)
    })
  })

  describe('recoverEnemy', () => {
    it('refills HP / MP and revives a fallen enemy', () => {
      const [alive, fallen] = troop._enemies
      alive!.hp = 30
      recoverEnemy({ index: 0, fromEnemyId: 1 })
      expect(alive!.hp).toBe(100)
      expect(alive!.setMp).toHaveBeenCalledWith(20)
      fallen!.hp = 0
      scene._enemyWindow.active = true
      recoverEnemy({ index: 1, fromEnemyId: 1 })
      expect(fallen!.isAlive()).toBe(true)
      expect(scene._enemyWindow.refresh).toHaveBeenCalled()
    })

    it('rejects an enemy that has not appeared', () => {
      troop._enemies[0]!.hide()
      expect(() => recoverEnemy({ index: 0, fromEnemyId: 1 })).toThrow('该敌人尚未出现')
    })
  })

  describe('reviveEnemy', () => {
    it('brings a fallen enemy back at full HP and refreshes the target window', () => {
      const enemy = troop._enemies[1]!
      enemy.hp = 0
      scene._enemyWindow.active = true
      reviveEnemy({ index: 1, fromEnemyId: 1 })
      expect(enemy.hp).toBe(100)
      expect(enemy.isAlive()).toBe(true)
      expect(scene._enemyWindow.refresh).toHaveBeenCalled()
    })

    it.each([
      ['alive', () => {}, '该敌人未倒下'],
      ['not appeared', () => troop._enemies[0]!.hide(), '该敌人尚未出现'],
      ['battle ended', () => (battleManager._phase = 'battleEnd'), '战斗已结束'],
    ])('rejects when %s', (_label, arrange, message) => {
      arrange()
      expect(() => reviveEnemy({ index: 0, fromEnemyId: 1 })).toThrow(message)
    })
  })

  describe('addEnemy', () => {
    it('adds a sprite and an enemy that does not overlap the others, then refreshes the target window', () => {
      scene._enemyWindow.active = true
      addEnemy({ enemyId: 2 })
      expect(troop._enemies).toHaveLength(3)
      const added = troop._enemies[2]!
      expect(added.onBattleStart).toHaveBeenCalled()
      expect(spriteset._enemySprites).toHaveLength(3)
      expect(field.addChild).toHaveBeenCalledTimes(1)
      expect(troop.makeUniqueNames).toHaveBeenCalled()
      expect(scene._enemyWindow.refresh).toHaveBeenCalled()
      for (const other of troop._enemies.slice(0, 2)) expect(Math.abs(added.screenX() - other.screenX()) >= 108 || Math.abs(added.screenY() - other.screenY()) >= 108).toBe(true)
    })

    it('rejects a full field', () => {
      troop._enemies = Array.from({ length: 8 }, (_, i) => new FakeEnemy(1, i * 100, 400))
      expect(() => addEnemy({ enemyId: 2 })).toThrow('场上敌人已达上限')
    })

    it('rejects games without the standard battle field', () => {
      delete (spriteset as Partial<typeof spriteset>)._battleField
      expect(() => addEnemy({ enemyId: 2 })).toThrow('该游戏的战斗画面不支持追加敌人')
    })

    it('rolls back when building the sprite throws', () => {
      g.Sprite_Enemy = class {
        constructor() {
          throw new Error('boom')
        }
      }
      expect(() => addEnemy({ enemyId: 2 })).toThrow('该游戏的战斗画面不支持追加敌人')
      expect(troop._enemies).toHaveLength(2)
      expect(spriteset._enemySprites).toHaveLength(2)
    })

    it('rolls back when mounting throws', () => {
      field.addChild.mockImplementation(() => {
        throw new Error('boom')
      })
      expect(() => addEnemy({ enemyId: 2 })).toThrow('该游戏的战斗画面不支持追加敌人')
      expect(troop._enemies).toHaveLength(2)
      expect(spriteset._enemySprites).toHaveLength(2)
    })

    it('keeps the enemy out of the sprite list when a plugin chokes on it (per-sprite HP gauges)', () => {
      spriteset.update.mockImplementation(() => {
        if (spriteset._enemySprites.length > 2) throw new TypeError("Cannot read property 'x' of undefined")
      })
      addEnemy({ enemyId: 2 })
      expect(troop._enemies).toHaveLength(3)
      expect(spriteset._enemySprites).toHaveLength(2)
      expect(field.children).toHaveLength(3)
    })

    it('rolls everything back when the battle still breaks', () => {
      let calls = 0
      spriteset.update.mockImplementation(() => {
        calls++
        if (calls <= 2) throw new Error('broken')
      })
      expect(() => addEnemy({ enemyId: 2 })).toThrow('该游戏的战斗画面不支持追加敌人')
      expect(troop._enemies).toHaveLength(2)
      expect(spriteset._enemySprites).toHaveLength(2)
      expect(field.children).toHaveLength(2)
    })
  })

  describe('resizeTroop', () => {
    it('adds copies of visible members in order', () => {
      troop._enemies = [new FakeEnemy(1, 300, 400), new FakeEnemy(2, 500, 400), Object.assign(new FakeEnemy(3, 0, 0), { _hidden: true })]
      resizeTroop(5)
      expect(troop._enemies.map((e) => e.id)).toEqual([1, 2, 3, 1, 2, 1])
      expect(troop.makeUniqueNames).toHaveBeenCalled()
    })

    it('hides visible members beyond the count', () => {
      resizeTroop(1)
      expect(troop._enemies.map((e) => e.isHidden())).toEqual([false, true])
    })

    it('caps at eight', () => {
      resizeTroop(20)
      expect(troop._enemies).toHaveLength(8)
    })

    it('re-places copies with real image sizes once the battle scene has loaded them', () => {
      troop._enemies = [new FakeEnemy(1, 408, 400)]
      spriteset._enemySprites = [new FakeSprite(troop._enemies[0]!)]
      resizeTroop(2)
      const copy = troop._enemies[1]!
      const sprite = new FakeSprite(copy)
      sprite.bitmap = { width: 300, height: 100, isReady: () => true }
      spriteset._enemySprites.push(sprite)
      jest.advanceTimersByTime(150)
      expect(sprite.setHome).toHaveBeenCalledWith(copy.screenX(), copy.screenY())
      expect(Math.abs(copy.screenX() - 408)).toBeGreaterThanOrEqual(50 + 150 + 8)
    })
  })
})
