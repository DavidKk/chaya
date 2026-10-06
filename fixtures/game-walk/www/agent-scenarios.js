/* Repeatable RPG Maker-shaped scenes for exercising ChayaAgent's managed turns. */
;(function () {
  'use strict'

  const story = [
    { speaker: '村长', text: '昨夜的大雨冲断了通往森林的桥。' },
    { speaker: '工匠', text: '我们连夜修好了桥，今天已经可以通行。' },
    { speaker: '村长', text: '森林入口在村子东边，出发前记得带上药草。' },
  ]
  let pendingStory = []
  let storyActive = false
  let qteDemo = false

  function showNextLine() {
    const line = pendingStory.shift()
    if (!line) {
      storyActive = false
      return
    }
    $gameMessage.setSpeakerName(line.speaker)
    $gameMessage.add(line.text)
    if (line.choices) {
      $gameMessage.setChoices(line.choices, (index) => {
        pendingStory = [index === 0 ? { speaker: '村长', text: '那就从东边出发吧，祝你一路平安。' } : { speaker: '村长', text: '先在村里休息，准备好了再出发。' }]
      })
    }
    SceneManager._scene._messageWindow.startMessage()
  }

  function startStory(withChoice = false) {
    SceneManager.goto(Scene_Map)
    $gameMessage.clear()
    pendingStory = withChoice ? [story[0], { speaker: '村长', text: '桥已经修好了。你现在要去森林吗？', choices: ['现在出发', '稍后再去'] }] : story.slice()
    storyActive = true
    showNextLine()
  }

  const skills = {
    slash: { id: 1, name: '剑气', mpCost: 4, target: 'enemy', power: 22 },
    fire: { id: 2, name: '火球', mpCost: 4, target: 'enemy', power: 24 },
    heal: { id: 3, name: '治疗', mpCost: 5, target: 'ally', power: 38 },
  }

  class DemoEnemy {
    constructor(name, hp, power) {
      this._name = name
      this._hp = hp
      this._mhp = hp
      this.power = power
      this.charged = false
    }
    name() {
      return this._name
    }
    param(index) {
      return index === 0 ? this._mhp : 0
    }
    states() {
      return this.charged ? [{ name: '蓄力：下一轮猛扑' }] : []
    }
  }

  const BattleManager = {
    _phase: '',
    _turnCount: 0,
    _actorIndex: 0,
    _action: null,
    _log: [],
    setup() {
      this._phase = 'input'
      this._turnCount = 1
      this._actorIndex = 0
      this._action = null
      this._log = ['森林史莱姆与灰狼挡住了去路。']
      const enemies = [new DemoEnemy('森林史莱姆', 32, 6), new DemoEnemy('蓄力灰狼', 40, 10)]
      window.$gameTroop = { members: () => enemies, enemyNames: () => enemies.map((enemy) => enemy.name()) }
    },
    actor() {
      return $gameParty.members()[this._actorIndex] || null
    },
    inputtingAction() {
      return this._action
    },
    log(line) {
      this._log.push(line)
      this._log = this._log.slice(-3)
    },
    processVictory() {
      this._phase = 'battleEnd'
    },
    processDefeat() {
      this._phase = 'battleEnd'
    },
    processEscape() {
      this._phase = 'battleEnd'
      return true
    },
  }

  function command(options) {
    return {
      visible: false,
      openness: 255,
      active: false,
      _index: 0,
      options,
      index() {
        return this._index
      },
      currentSymbol() {
        return this.options[this._index]?.symbol || null
      },
      item() {
        return this.options[this._index]?.item || null
      },
      select(index) {
        this._index = Math.max(0, Math.min(index, this.options.length - 1))
      },
      setOptions(next) {
        this.options = next
        this.select(0)
      },
    }
  }

  function action(type, detail) {
    return {
      type,
      detail,
      isAttack: () => type === 'attack',
      isGuard: () => type === 'guard',
      isSkill: () => type === 'skill',
      isItem: () => type === 'item',
    }
  }

  class Scene_Battle {
    constructor() {
      this._windowLayer = { children: [] }
      this._qte = null
      this._qteScheduled = false
      this._qteResult = null
      this._partyCommandWindow = command([
        { symbol: 'fight', label: '战斗' },
        { symbol: 'escape', label: '逃跑' },
      ])
      this._actorCommandWindow = command([
        { symbol: 'attack', label: '攻击' },
        { symbol: 'skill', label: '技能' },
        { symbol: 'item', label: '道具' },
        { symbol: 'guard', label: '防御' },
      ])
      this._skillWindow = command([])
      this._itemWindow = command([])
      this._enemyWindow = command([])
      this._allyWindow = command([])
      this._menus = ['_partyCommandWindow', '_actorCommandWindow', '_skillWindow', '_itemWindow', '_enemyWindow', '_allyWindow']
      this.show('_partyCommandWindow')
    }
    show(name) {
      for (const key of this._menus) this[key].visible = this[key].active = key === name
      this._activeMenu = name
    }
    menu() {
      return this[this._activeMenu]
    }
    refreshTargets() {
      this._enemyWindow.setOptions(
        $gameTroop
          .members()
          .filter((enemy) => enemy._hp > 0)
          .map((enemy) => ({ label: enemy.name(), item: { name: enemy.name(), hp: enemy._hp, mhp: enemy._mhp, states: enemy.states() }, enemy }))
      )
      this._allyWindow.setOptions(
        $gameParty
          .members()
          .filter((actor) => actor.hp > 0)
          .map((actor) => ({ label: actor.name(), item: { name: actor.name(), hp: actor.hp, mhp: actor.mhp, mp: actor.mp, mmp: actor.mmp }, actor }))
      )
    }
    nextActor() {
      BattleManager._action = null
      if (!$gameTroop.members().some((enemy) => enemy._hp > 0)) {
        BattleManager.processVictory()
        SceneManager.goto(Scene_Map)
        return
      }
      const members = $gameParty.members()
      do BattleManager._actorIndex += 1
      while (BattleManager._actorIndex < members.length && members[BattleManager._actorIndex].hp <= 0)
      if (BattleManager._actorIndex < members.length) this.show('_actorCommandWindow')
      else this.enemyTurn()
    }
    enemyTurn() {
      BattleManager._phase = 'turn'
      for (const enemy of $gameTroop.members().filter((entry) => entry._hp > 0)) {
        if (enemy.name() === '蓄力灰狼' && !enemy.charged && BattleManager._turnCount % 2 === 1) {
          enemy.charged = true
          BattleManager.log('灰狼正在蓄力，下轮会发动猛扑。')
          continue
        }
        const alive = $gameParty.members().filter((actor) => actor.hp > 0)
        if (!alive.length) break
        const target = enemy.name() === '蓄力灰狼' ? alive[0] : alive[alive.length - 1]
        const damage = enemy.charged ? 28 : enemy.power
        const actual = target._guarding ? Math.ceil(damage / 4) : damage
        target.setHp(target.hp - actual)
        BattleManager.log(`${enemy.name()}攻击${target.name()}，造成 ${actual} 伤害${target._guarding ? '（防御）' : ''}。`)
        enemy.charged = false
      }
      for (const actor of $gameParty.members()) actor._guarding = false
      if (!$gameParty.members().some((actor) => actor.hp > 0)) {
        BattleManager.processDefeat()
        SceneManager.goto(Scene_Map)
        return
      }
      BattleManager._turnCount += 1
      BattleManager._actorIndex = $gameParty.members().findIndex((actor) => actor.hp > 0)
      BattleManager._phase = 'input'
      this.show('_actorCommandWindow')
    }
    update() {
      if (this._qte) {
        if (Input.isTriggered(this._qte.key)) {
          this._qteResult = 'success'
          window.ChayaAgentQteSource.lastResult = { id: this._qte.id, result: 'success' }
          BattleManager.log('闪避成功，躲开了突袭。')
          this._qte = null
        } else if (Date.now() >= this._qte.expiresAt) {
          this._qteResult = 'missed'
          window.ChayaAgentQteSource.lastResult = { id: this._qte.id, result: 'missed' }
          $gameActors.actor(1).setHp($gameActors.actor(1).hp - 12)
          BattleManager.log('闪避失败，剑士受到 12 点伤害。')
          this._qte = null
        }
        return
      }
      const menu = this.menu()
      if (Input.isTriggered('down') && menu.options.length) menu.select((menu.index() + 1) % menu.options.length)
      if (Input.isTriggered('up') && menu.options.length) menu.select((menu.index() + menu.options.length - 1) % menu.options.length)
      if (Input.isTriggered('cancel')) {
        if (this._activeMenu === '_enemyWindow' || this._activeMenu === '_allyWindow')
          this.show(BattleManager._action?.type === 'attack' ? '_actorCommandWindow' : BattleManager._action?.type === 'skill' ? '_skillWindow' : '_itemWindow')
        else if (this._activeMenu === '_skillWindow' || this._activeMenu === '_itemWindow') this.show('_actorCommandWindow')
        else if (this._activeMenu === '_actorCommandWindow' && BattleManager._actorIndex === 0) this.show('_partyCommandWindow')
        BattleManager._action = null
        return
      }
      if (!Input.isTriggered('ok') || !menu.options.length) return
      const selected = menu.options[menu.index()]
      const actor = BattleManager.actor()
      if (this._activeMenu === '_partyCommandWindow') {
        if (selected.symbol === 'escape') {
          BattleManager.processEscape()
          SceneManager.goto(Scene_Map)
        } else {
          this.show('_actorCommandWindow')
          if (qteDemo && !this._qteScheduled) {
            this._qteScheduled = true
            window.setTimeout(() => {
              if (SceneManager._scene !== this) return
              const startedAt = Date.now()
              this._qte = { id: `forest-dodge-${startedAt}`, key: 'left', startedAt, expiresAt: startedAt + 700 }
            }, 300)
          }
        }
      } else if (this._activeMenu === '_actorCommandWindow') {
        if (selected.symbol === 'guard') {
          actor._guarding = true
          BattleManager.log(`${actor.name()}摆出防御姿态。`)
          this.nextActor()
        } else if (selected.symbol === 'attack') {
          BattleManager._action = action('attack')
          this.refreshTargets()
          this.show('_enemyWindow')
        } else if (selected.symbol === 'skill') {
          this._skillWindow.setOptions(actor.skills().map((skill) => ({ label: `${skill.name} (${skill.mpCost} MP)`, item: skill, skill })))
          this.show('_skillWindow')
        } else {
          this._itemWindow.setOptions($gameParty.items().map((item) => ({ label: `${item.name} ×${$gameParty.numItems(item)}`, item, consumable: item })))
          this.show('_itemWindow')
        }
      } else if (this._activeMenu === '_skillWindow') {
        if (actor.mp < selected.skill.mpCost) {
          BattleManager.log(`${actor.name()}的 MP 不足。`)
          return
        }
        BattleManager._action = action('skill', selected.skill)
        this.refreshTargets()
        this.show(selected.skill.target === 'ally' ? '_allyWindow' : '_enemyWindow')
      } else if (this._activeMenu === '_itemWindow') {
        BattleManager._action = action('item', selected.consumable)
        this.refreshTargets()
        this.show('_allyWindow')
      } else if (this._activeMenu === '_enemyWindow') {
        const enemy = selected.enemy
        const chosen = BattleManager._action
        const power = chosen.type === 'skill' ? chosen.detail.power : actor.actorId() === 1 ? 14 : 9
        if (chosen.type === 'skill') actor.setMp(actor.mp - chosen.detail.mpCost)
        enemy._hp = Math.max(0, enemy._hp - power)
        BattleManager.log(`${actor.name()}对${enemy.name()}使用${chosen.type === 'skill' ? chosen.detail.name : '攻击'}，造成 ${power} 伤害。`)
        this.nextActor()
      } else if (this._activeMenu === '_allyWindow') {
        const target = selected.actor
        const chosen = BattleManager._action
        if (chosen.type === 'skill') {
          actor.setMp(actor.mp - chosen.detail.mpCost)
          target.setHp(target.hp + chosen.detail.power)
        } else {
          $gameParty.gainItem(chosen.detail, -1)
          if (chosen.detail.id === 3) target.setMp(target.mp + 12)
          else target.setHp(target.hp + 28)
        }
        BattleManager.log(`${actor.name()}对${target.name()}使用${chosen.detail.name}。`)
        this.nextActor()
      }
    }
    draw(ctx) {
      ctx.fillStyle = '#132632'
      ctx.fillRect(0, 0, 816, 624)
      ctx.fillStyle = '#243b45'
      ctx.fillRect(18, 16, 780, 58)
      ctx.fillStyle = '#f3f7f6'
      ctx.font = 'bold 22px system-ui'
      ctx.fillText(`森林遭遇  /  第 ${BattleManager._turnCount} 回合`, 36, 52)
      const enemies = $gameTroop.members()
      enemies.forEach((enemy, index) => {
        const x = 58 + index * 392
        const selected = this._enemyWindow.active && this._enemyWindow.item()?.name === enemy.name()
        ctx.fillStyle = selected ? '#3d5660' : '#203943'
        ctx.fillRect(x, 94, 336, 190)
        ctx.fillStyle = enemy._hp ? (index ? '#a77b72' : '#83bd9a') : '#56707a'
        ctx.beginPath()
        if (index) {
          ctx.moveTo(x + 130, 198)
          ctx.lineTo(x + 155, 128)
          ctx.lineTo(x + 175, 160)
          ctx.lineTo(x + 208, 128)
          ctx.lineTo(x + 228, 198)
          ctx.closePath()
          ctx.fill()
          ctx.fillRect(x + 124, 190, 112, 38)
        } else {
          ctx.ellipse(x + 170, 186, 68, 52, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = '#f3f7f6'
        ctx.font = 'bold 18px system-ui'
        ctx.fillText(enemy.name(), x + 18, 122)
        ctx.font = '16px system-ui'
        ctx.fillText(`HP ${enemy._hp}/${enemy._mhp}`, x + 18, 262)
        if (enemy.charged) {
          ctx.fillStyle = '#ffc579'
          ctx.fillText('蓄力：下一轮猛扑', x + 163, 262)
        }
      })
      $gameParty.members().forEach((actor, index) => {
        const x = 58 + index * 392
        ctx.fillStyle = BattleManager.actor() === actor ? '#314c54' : '#243b45'
        ctx.fillRect(x, 304, 336, 105)
        ctx.fillStyle = '#f3f7f6'
        ctx.font = 'bold 18px system-ui'
        ctx.fillText(`${actor.name()}${actor._guarding ? '  防御中' : ''}`, x + 18, 334)
        ctx.font = '16px system-ui'
        ctx.fillText(`HP ${actor.hp}/${actor.mhp}   MP ${actor.mp}/${actor.mmp}`, x + 18, 369)
      })
      const menu = this.menu()
      ctx.fillStyle = '#263c48'
      ctx.fillRect(18, 426, 780, 110)
      ctx.fillStyle = '#f3f7f6'
      ctx.font = 'bold 17px system-ui'
      ctx.fillText(
        `${BattleManager.actor()?.name() || '队伍'} · ${this._activeMenu === '_enemyWindow' ? '选择敌人' : this._activeMenu === '_allyWindow' ? '选择队友' : '选择行动'}`,
        36,
        455
      )
      menu.options.forEach((option, index) => {
        const x = 36 + (index % 4) * 186
        const y = 490 + Math.floor(index / 4) * 28
        ctx.fillStyle = index === menu.index() ? '#f1c56f' : '#d8e4e7'
        ctx.fillText(`${index === menu.index() ? '▶ ' : '   '}${option.label}`, x, y)
      })
      ctx.fillStyle = '#c5d6d8'
      ctx.font = '15px system-ui'
      ctx.fillText(BattleManager._log.at(-1) || '', 36, 568)
      ctx.fillText('方向键选择  ·  Enter 确认  ·  Esc 返回', 36, 600)
      if (this._qte) {
        ctx.fillStyle = '#111e27'
        ctx.fillRect(120, 175, 576, 240)
        ctx.strokeStyle = '#f1c56f'
        ctx.lineWidth = 4
        ctx.strokeRect(120, 175, 576, 240)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 30px system-ui'
        ctx.fillText('突袭！按 ← 闪避', 245, 285)
        ctx.font = '18px system-ui'
        ctx.fillText(`剩余 ${Math.max(0, this._qte.expiresAt - Date.now())} ms`, 310, 335)
      }
    }
  }

  function startBattle(withQte = false) {
    qteDemo = withQte
    window.ChayaAgentQteSource.lastResult = null
    storyActive = false
    pendingStory = []
    $gameMessage.clear()
    const warrior = $gameActors.actor(1)
    const mage = $gameActors.actor(2)
    warrior.recoverAll()
    mage.recoverAll()
    warrior.setHp(45)
    warrior.setMp(7)
    mage.setHp(38)
    mage.setMp(2)
    warrior.skills = () => [skills.slash]
    mage.skills = () => [skills.fire, skills.heal]
    for (const actor of [warrior, mage]) {
      actor.canUse = (skill) => actor.mp >= skill.mpCost
      actor.skillMpCost = (skill) => skill.mpCost
      actor._guarding = false
    }
    $gameParty._items = {}
    $gameParty.gainItem($dataItems[1], 2)
    $gameParty.gainItem($dataItems[3], 1)
    BattleManager.setup(1)
    SceneManager.goto(Scene_Battle)
  }

  window.BattleManager = BattleManager
  window.Scene_Battle = Scene_Battle
  window.ChayaAgentQteSource = function currentQte() {
    return SceneManager._scene instanceof Scene_Battle ? SceneManager._scene._qte : null
  }
  window.WalkDemo.AgentScenarios = {
    startBattle,
    startQteBattle: () => startBattle(true),
    startStory,
    update() {
      if (storyActive && SceneManager._scene instanceof Scene_Map && !$gameMessage.isBusy()) showNextLine()
    },
  }
})()
