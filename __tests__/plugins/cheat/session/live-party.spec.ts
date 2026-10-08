import { Cheats } from '@/plugins/src/cheat/runtime/cheats'
import { joinActor, readParty, readPartyRoster, recoverActor, reviveActor, writeActorVital } from '@/plugins/src/cheat/session/live-party'

class FakeActor {
  hp = 200
  mp = 30
  tp = 10
  plus = [0, 0]
  dead = false
  constructor(
    public id: number,
    public label: string
  ) {}
  get mhp() {
    return (300 + this.plus[0]!) * 2
  }
  get mmp() {
    return 50 + this.plus[1]!
  }
  actorId = () => this.id
  name = () => this.label
  maxTp = () => 100
  isAlive = () => !this.dead
  isDead = () => this.dead
  setHp = jest.fn((hp: number) => {
    this.hp = hp
    this.dead = hp <= 0
  })
  setMp = jest.fn((mp: number) => (this.mp = mp))
  setTp = jest.fn((tp: number) => (this.tp = tp))
  deathStateId = () => 1
  removeState = jest.fn(() => (this.dead = false))
  performCollapse = jest.fn()
  paramBase = (id: number) => (id === 0 ? 300 : 50)
  paramPlus = (id: number) => this.plus[id]!
  param = (id: number) => (id === 0 ? this.mhp : this.mmp)
  addParam = jest.fn((id: number, v: number) => (this.plus[id]! += v))
}

class SceneBattle {}

describe('cheat/live-party', () => {
  const g = globalThis as Record<string, unknown>
  let members: FakeActor[]
  let reserve: FakeActor[]
  let refreshStatus: jest.Mock
  let battleManager: { _phase: string; refreshStatus: jest.Mock; processDefeat: jest.Mock; processVictory: jest.Mock }

  beforeEach(() => {
    members = [new FakeActor(1, 'Harold'), new FakeActor(4, 'Lucius')]
    reserve = [new FakeActor(5, 'Reid')]
    refreshStatus = jest.fn()
    battleManager = { _phase: 'input', refreshStatus, processDefeat: jest.fn(), processVictory: jest.fn() }
    Object.assign(g, {
      Scene_Battle: SceneBattle,
      SceneManager: { _scene: new SceneBattle(), _nextScene: null },
      BattleManager: battleManager,
      $gameTroop: { members: () => [], isAllDead: () => false },
      $gameParty: {
        battleMembers: () => members,
        isAllDead: () => members.every((a) => a.dead),
        members: () => [...members, ...reserve],
        maxBattleMembers: () => 4,
        addActor: jest.fn((id: number) => members.push(new FakeActor(id, `A${id}`))),
      },
      $dataActors: [null, {}, {}, {}, {}, {}, {}],
    })
  })

  afterEach(() => {
    for (const key of ['Scene_Battle', 'SceneManager', 'BattleManager', '$gameTroop', '$gameParty', '$dataActors']) delete g[key]
  })

  it('reads battle members by id', () => {
    members[1]!.dead = true
    expect(readParty()).toEqual([
      { actorId: 1, name: 'Harold', hp: 200, mhp: 600, mp: 30, mmp: 50, mhpCap: 9999, mmpCap: 9999, tp: 10, maxTp: 100, alive: true },
      { actorId: 4, name: 'Lucius', hp: 200, mhp: 600, mp: 30, mmp: 50, mhpCap: 9999, mmpCap: 9999, tp: 10, maxTp: 100, alive: false },
    ])
  })

  it("sends each actor's paramMax caps (MZ: max HP 9999, max MP uncapped)", () => {
    Object.assign(members[0]!, { paramMax: (id: number) => (id === 0 ? 9999 : Infinity) })
    const [first] = readParty()
    expect([first!.mhpCap, first!.mmpCap]).toEqual([9999, 9_999_999])
  })

  it('rejects an unknown vital key instead of writing HP', () => {
    expect(() => writeActorVital({ actorId: 1, key: 'atk' as never, value: 5 })).toThrow('未知属性：atk')
    expect(members[0]!.setHp).not.toHaveBeenCalled()
  })

  it('clamps current values, scales caps and redraws the status window', () => {
    const actor = members[1]!
    writeActorVital({ actorId: 4, key: 'mp', value: 999 })
    expect(actor.mp).toBe(50)
    writeActorVital({ actorId: 4, key: 'tp', value: 150 })
    expect(actor.tp).toBe(100)
    writeActorVital({ actorId: 4, key: 'mhp', value: 1000 })
    expect(actor.addParam).toHaveBeenCalledWith(0, 200)
    expect(actor.mhp).toBe(1000)
    writeActorVital({ actorId: 4, key: 'mmp', value: 0 })
    expect(actor.mmp).toBe(0)
    expect(refreshStatus).toHaveBeenCalledTimes(4)
  })

  it('HP 0 knocks the actor out', () => {
    writeActorVital({ actorId: 1, key: 'hp', value: 0 })
    expect(members[0]!.performCollapse).toHaveBeenCalled()
    expect(() => writeActorVital({ actorId: 1, key: 'hp', value: 10 })).toThrow('该角色已倒下')
    expect(battleManager.processDefeat).not.toHaveBeenCalled()
    writeActorVital({ actorId: 4, key: 'hp', value: 0 })
    expect(battleManager.processDefeat).toHaveBeenCalledTimes(1)
  })

  it('invincibility suppresses the automatic defeat (it restores the party next tick)', () => {
    jest.spyOn(Cheats, 'getGod').mockReturnValue(true)
    writeActorVital({ actorId: 1, key: 'hp', value: 0 })
    writeActorVital({ actorId: 4, key: 'hp', value: 0 })
    expect(battleManager.processDefeat).not.toHaveBeenCalled()
    jest.restoreAllMocks()
  })

  it('revives a fallen actor at full HP; recover also refills MP', () => {
    const actor = members[0]!
    expect(() => reviveActor({ actorId: 1 })).toThrow('该角色未倒下')
    actor.dead = true
    reviveActor({ actorId: 1 })
    expect(actor.removeState).toHaveBeenCalledWith(1)
    expect(actor.hp).toBe(600)
    actor.dead = true
    actor.mp = 0
    recoverActor({ actorId: 1 })
    expect(actor.isAlive()).toBe(true)
    expect([actor.hp, actor.mp]).toEqual([600, 50])
  })

  it('joins an actor through addActor; rejects members, unknown ids and a full battle party', () => {
    expect(readPartyRoster()).toEqual({ partyIds: [1, 4, 5], partyMax: 4 })
    joinActor({ actorId: 2 })
    expect(members.map((a) => a.id)).toEqual([1, 4, 2])
    expect(refreshStatus).toHaveBeenCalled()
    expect(() => joinActor({ actorId: 5 })).toThrow('该角色已在队伍中')
    expect(() => joinActor({ actorId: 9 })).toThrow('角色 9 不存在')
    joinActor({ actorId: 3 })
    expect(() => joinActor({ actorId: 6 })).toThrow('出战人数已满（4）')
  })

  it('takes the actor back out when a hidden member keeps it off the battle line', () => {
    const party = g.$gameParty as { addActor: jest.Mock; removeActor?: jest.Mock }
    party.addActor.mockImplementation((id: number) => reserve.push(new FakeActor(id, `A${id}`)))
    party.removeActor = jest.fn((id: number) => (reserve = reserve.filter((a) => a.id !== id)))
    expect(() => joinActor({ actorId: 2 })).toThrow('出战位已被占满（可能有隐藏成员），无法加入')
    expect(party.removeActor).toHaveBeenCalledWith(2)
    expect(reserve.map((a) => a.id)).toEqual([5])
  })

  it.each([
    ['not in battle', () => (g.SceneManager = { _scene: {}, _nextScene: null }), '只能在战斗中使用'],
    ['battle ended', () => (battleManager._phase = 'battleEnd'), '战斗已结束'],
    ['not a battle member', () => (members = []), '该角色不在战斗中'],
  ])('rejects when %s', (_label, arrange, message) => {
    arrange()
    expect(() => recoverActor({ actorId: 1 })).toThrow(message)
  })
})
