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

  class DemoEnemy {
    constructor() {
      this._hp = 22
    }
    name() {
      return '森林史莱姆'
    }
    param(index) {
      return index === 0 ? 22 : 0
    }
    states() {
      return []
    }
  }

  const BattleManager = {
    _phase: '',
    _turnCount: 0,
    _action: null,
    setup() {
      this._phase = 'input'
      this._turnCount = 1
      this._action = null
      const enemy = new DemoEnemy()
      window.$gameTroop = { members: () => [enemy], enemyNames: () => [enemy.name()] }
    },
    actor() {
      return $gameActors.actor(1)
    },
    inputtingAction() {
      return this._action
    },
    processVictory() {
      this._phase = 'battleEnd'
    },
    processDefeat() {
      this._phase = 'battleEnd'
    },
    processEscape() {
      return false
    },
  }

  function command(symbol) {
    return {
      visible: true,
      openness: 255,
      active: false,
      _index: 0,
      index() {
        return this._index
      },
      currentSymbol: () => symbol,
      item: () => null,
    }
  }

  class Scene_Battle {
    constructor() {
      this._windowLayer = { children: [] }
      this._partyCommandWindow = command('fight')
      this._actorCommandWindow = command('attack')
      this._enemyWindow = command(null)
      this._enemyWindow.visible = false
      this._partyCommandWindow.active = true
    }
    update() {
      if (Input.isTriggered('cancel') && this._enemyWindow.active) {
        this._enemyWindow.active = false
        this._enemyWindow.visible = false
        this._actorCommandWindow.active = true
        BattleManager._action = null
        return
      }
      if (!Input.isTriggered('ok')) return
      if (this._partyCommandWindow.active) {
        this._partyCommandWindow.active = false
        this._actorCommandWindow.active = true
      } else if (this._actorCommandWindow.active) {
        this._actorCommandWindow.active = false
        this._enemyWindow.active = true
        this._enemyWindow.visible = true
        BattleManager._action = { isAttack: () => true, isGuard: () => false, isSkill: () => false, isItem: () => false }
      } else if (this._enemyWindow.active) {
        const enemy = $gameTroop.members()[0]
        enemy._hp = Math.max(0, enemy._hp - 12)
        this._enemyWindow.active = false
        this._enemyWindow.visible = false
        BattleManager._action = null
        if (enemy._hp === 0) {
          BattleManager.processVictory()
          SceneManager.goto(Scene_Map)
        } else {
          const actor = BattleManager.actor()
          actor.setHp(actor.hp - 3)
          BattleManager._turnCount += 1
          this._actorCommandWindow.active = true
        }
      }
    }
    draw(ctx) {
      const enemy = $gameTroop.members()[0]
      const actor = BattleManager.actor()
      ctx.fillStyle = '#173644'
      ctx.fillRect(0, 0, 816, 624)
      ctx.fillStyle = '#2f6347'
      ctx.fillRect(0, 410, 816, 214)
      ctx.fillStyle = '#91cfad'
      ctx.beginPath()
      ctx.ellipse(568, 300, 78, 64, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#182c37'
      ctx.beginPath()
      ctx.arc(540, 294, 7, 0, Math.PI * 2)
      ctx.arc(590, 294, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = '22px system-ui'
      ctx.fillText(`${enemy.name()}  HP ${enemy._hp}/${enemy.param(0)}`, 390, 170)
      ctx.fillText(`勇者  HP ${actor.hp}/${actor.mhp}`, 38, 460)
      ctx.fillText(this._partyCommandWindow.active ? '战斗' : this._actorCommandWindow.active ? '攻击' : '选择森林史莱姆', 38, 520)
      ctx.font = '16px system-ui'
      ctx.fillText('Enter 确认 · 可交给 Chaya 助手战斗', 38, 570)
    }
  }

  function startBattle() {
    storyActive = false
    pendingStory = []
    $gameMessage.clear()
    $gameActors.actor(1).recoverAll()
    BattleManager.setup(1)
    SceneManager.goto(Scene_Battle)
  }

  window.BattleManager = BattleManager
  window.Scene_Battle = Scene_Battle
  window.WalkDemo.AgentScenarios = {
    startBattle,
    startStory,
    update() {
      if (storyActive && SceneManager._scene instanceof Scene_Map && !$gameMessage.isBusy()) showNextLine()
    },
  }
})()
