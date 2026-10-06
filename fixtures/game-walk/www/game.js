/* Minimal RPG Maker-like walking game (windows, scenes, drawing, boot); data.js and objects.js load first. */
;(function () {
  'use strict'

  const { TILE, COLS, ROWS, W, H, FRAME_MS, SAVE_KEY, MAPS, DIRS, COMMON_EVENTS, MENU, interpreter } = window.WalkDemo

  /** Only what ChayaTrans hooks; drawing happens in `render()` */
  class Window_Base {
    convertEscapeCharacters(value) {
      return String(value)
    }
    drawText(value) {
      return String(value)
    }
    drawTextEx(value) {
      return String(value)
    }
    processNormalCharacter() {}
  }
  class Bitmap {
    drawText(value) {
      return value
    }
  }

  class Window_ChoiceList extends Window_Base {
    constructor() {
      super()
      this.visible = false
      this.active = false
      this._index = 0
    }
    start() {
      this.visible = true
      this.active = true
      this._index = 0
    }
    index() {
      return this._index
    }
    update() {
      const count = $gameMessage.choices().length
      if (Input.isTriggered('down')) this._index = (this._index + 1) % count
      if (Input.isTriggered('up')) this._index = (this._index + count - 1) % count
      if (Input.isTriggered('ok')) this.choose(this._index)
    }
    choose(index) {
      this.visible = false
      this.active = false
      $gameMessage.onChoice(index)
      $gameMessage.clear()
    }
  }

  class Window_Message extends Window_Base {
    constructor() {
      super()
      this.visible = false
      this.active = false
      this._choiceListWindow = new Window_ChoiceList()
    }
    startMessage() {
      this.visible = true
      this.active = true
      if ($gameMessage.isChoice()) this._choiceListWindow.start()
    }
    update() {
      if (!$gameMessage.isBusy()) {
        this.visible = false
        this.active = false
        return
      }
      if (this._choiceListWindow.active) this._choiceListWindow.update()
      else if (Input.isTriggered('ok')) $gameMessage.clear()
      if (!$gameMessage.isBusy()) {
        this.visible = false
        this.active = false
      }
    }
    /** Tap: pick the touched choice, otherwise close the message */
    onTap(x, y) {
      const list = this._choiceListWindow
      if (list.active) {
        const box = choiceBox()
        const row = Math.floor((y - box.y - 8) / 36)
        if (x >= box.x && x < box.x + box.w && row >= 0 && row < $gameMessage.choices().length) list.choose(row)
        return
      }
      $gameMessage.clear()
      this.visible = false
      this.active = false
    }
  }

  function choiceBox() {
    const h = $gameMessage.choices().length * 36 + 16
    return { x: W - 232, y: H - 172 - h, w: 220, h }
  }

  class Scene_Map {
    constructor() {
      this._windowLayer = { children: [] }
      this._messageWindow = new Window_Message()
      this._choiceListWindow = this._messageWindow._choiceListWindow
    }
    update() {
      if ($gamePlayer._transfer && !$gamePlayer.isMoving()) $gamePlayer.performTransfer()
      if ($gameTemp._commonEventId && !interpreter.isRunning()) {
        interpreter.setup($dataCommonEvents[$gameTemp._commonEventId]?.list)
        $gameTemp._commonEventId = 0
      }
      const tap = TouchInput.take()
      interpreter.update()
      if ($gameMessage.isBusy()) {
        $gameTemp.clearDestination()
        if (tap) this._messageWindow.onTap(tap.x, tap.y)
        else this._messageWindow.update()
      } else if (!interpreter.isRunning() && !$gamePlayer.isMoving()) {
        if (tap) $gameTemp.setDestination(Math.floor(tap.x / TILE), Math.floor(tap.y / TILE))
        const d = Input.dir4()
        if (Input.isTriggered('menu')) SceneManager.goto(Scene_Menu)
        else if (Input.isTriggered('ok')) {
          const front = $gamePlayer.front()
          $gameMap.eventAt(front.x, front.y)?.start()
        } else if (d) {
          $gameTemp.clearDestination()
          $gamePlayer.moveStraight(d)
        } else if ($gameTemp.isDestinationValid()) {
          const step = $gamePlayer.stepToward($gameTemp._destinationX, $gameTemp._destinationY)
          if (step) $gamePlayer.moveStraight(step)
          else $gameTemp.clearDestination()
        }
      }
      $gamePlayer.update()
    }
  }

  class Scene_Menu {
    constructor() {
      this._windowLayer = { children: [] }
      this._commandWindow = {
        visible: true,
        openness: 255,
        active: true,
        _index: 0,
        index: () => this._commandWindow._index,
        currentSymbol: () => MENU[this._commandWindow._index].symbol,
      }
      this._help = '选择一个指令。'
    }
    update() {
      const win = this._commandWindow
      const tap = TouchInput.take()
      if (tap && tap.x >= 24 && tap.x < 224) {
        const row = Math.floor((tap.y - 24) / 44)
        if (row >= 0 && row < MENU.length) {
          win._index = row
          this.run(MENU[row].symbol)
          return
        }
      }
      if (Input.isTriggered('down')) win._index = (win._index + 1) % MENU.length
      if (Input.isTriggered('up')) win._index = (win._index + MENU.length - 1) % MENU.length
      if (Input.isTriggered('ok')) this.run(win.currentSymbol())
      else if (Input.isTriggered('cancel')) SceneManager.goto(Scene_Map)
    }
    run(symbol) {
      if (symbol === 'item') {
        const items = $gameParty.items().map((item) => `${item.name} ×${$gameParty.numItems(item)}`)
        this._help = items.length ? `物品：${items.join('、')}` : '物品：（空）'
      } else if (symbol === 'status') {
        const a = $gameActors.actor(1)
        this._help = `${a.name()}  Lv ${a.level}  HP ${a.hp}/${a.mhp}  MP ${a.mp}/${a.mmp}`
      } else if (symbol === 'save') {
        this._help = DataManager.saveGame(1) ? '已存档到 1 号位。' : '存档失败。'
      } else SceneManager.goto(Scene_Map)
    }
  }

  const DataManager = {
    isDatabaseLoaded: () => true,
    onLoad() {},
    saveGame(id) {
      const data = {
        mapId: $gameMap.mapId(),
        x: $gamePlayer.x,
        y: $gamePlayer.y,
        d: $gamePlayer.direction(),
        gold: $gameParty._gold,
        items: $gameParty._items,
        variables: $gameVariables._data,
        switches: $gameSwitches._data,
        actor: { ...$gameActors.actor(1) },
      }
      localStorage.setItem(SAVE_KEY + id, JSON.stringify(data))
      return true
    },
    loadGame(id) {
      const raw = localStorage.getItem(SAVE_KEY + id)
      if (!raw) return false
      const data = JSON.parse(raw)
      $gameMap.setup(data.mapId)
      $gamePlayer.locate(data.x, data.y)
      $gamePlayer._direction = data.d
      Object.assign($gameParty, { _gold: data.gold, _items: data.items })
      $gameVariables._data = data.variables
      $gameSwitches._data = data.switches
      Object.assign($gameActors.actor(1), data.actor)
      $gameMessage.clear()
      interpreter.clear()
      return true
    },
  }

  const scene = () => SceneManager._scene
  let canvas
  const SceneManager = {
    _scene: null,
    _stopped: false,
    goto(SceneClass) {
      Input.clear()
      this._scene = SceneClass === Scene_Map && mapScene ? mapScene : new SceneClass()
    },
    snap() {
      return { canvas, width: W, height: H }
    },
    exit() {
      window.close()
    },
    stop() {
      this._stopped = true
    },
    resume() {
      this._stopped = false
    },
  }
  let mapScene = null

  // ---------- drawing ----------
  function panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(16, 27, 44, 0.92)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = '#b0c9d9'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  }
  function text(ctx, value, x, y, size = 20, color = '#fff') {
    ctx.font = `${size}px sans-serif`
    ctx.fillStyle = color
    ctx.textBaseline = 'top'
    ctx.fillText(value, x, y)
  }
  function drawMap(ctx) {
    const map = MAPS[$gameMap.mapId()]
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const c = map.rows[y][x]
        ctx.fillStyle = c === '#' ? '#4a4a52' : c === '~' ? '#2f6fb0' : map.ground
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE)
        if (c === 'T') {
          ctx.fillStyle = '#1f4a26'
          ctx.beginPath()
          ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE * 0.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    for (const event of $gameMap.events()) {
      const { color, name, touch } = event._data
      ctx.fillStyle = color
      if (touch) ctx.fillRect(event._x * TILE + 8, event._y * TILE + 8, TILE - 16, TILE - 16)
      else ctx.fillRect(event._x * TILE + 4, event._y * TILE + 4, TILE - 8, TILE - 8)
      text(ctx, name, event._x * TILE - 8, event._y * TILE - 16, 13)
    }
    const px = $gamePlayer._realX * TILE + TILE / 2
    const py = $gamePlayer._realY * TILE + TILE / 2
    ctx.fillStyle = '#3b8eea'
    ctx.beginPath()
    ctx.arc(px, py, TILE * 0.36, 0, Math.PI * 2)
    ctx.fill()
    const [dx, dy] = DIRS[$gamePlayer.direction()]
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(px + dx * 10, py + dy * 10, 5, 0, Math.PI * 2)
    ctx.fill()
    panel(ctx, 8, 8, 220, 36)
    text(ctx, `${map.name}  (${$gamePlayer.x}, ${$gamePlayer.y})`, 18, 16, 16)
  }
  function wrap(ctx, value, width) {
    const lines = []
    for (const para of String(value).split('\n')) {
      let line = ''
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > width) {
          lines.push(line)
          line = ''
        }
        line += ch
      }
      lines.push(line)
    }
    return lines
  }
  function drawMessage(ctx) {
    if (!$gameMessage.isBusy()) return
    panel(ctx, 12, H - 160, W - 24, 148)
    let y = H - 148
    if ($gameMessage.speakerName()) {
      text(ctx, $gameMessage.speakerName(), 30, y, 18, '#ffd27a')
      y += 26
    }
    ctx.font = '20px sans-serif'
    for (const line of wrap(ctx, $gameMessage.allText(), W - 80)) {
      text(ctx, line, 30, y)
      y += 28
    }
    const list = scene()._choiceListWindow
    if (list?.visible) {
      const box = choiceBox()
      panel(ctx, box.x, box.y, box.w, box.h)
      $gameMessage.choices().forEach((choice, i) => {
        if (i === list.index()) {
          ctx.fillStyle = '#35627c'
          ctx.fillRect(box.x + 8, box.y + 8 + i * 36, box.w - 16, 32)
        }
        text(ctx, choice, box.x + 20, box.y + 12 + i * 36)
      })
    }
  }
  function drawMenu(ctx, menu) {
    drawMap(ctx)
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, W, H)
    panel(ctx, 24, 24, 200, MENU.length * 44 + 16)
    MENU.forEach((item, i) => {
      if (i === menu._commandWindow._index) {
        ctx.fillStyle = '#35627c'
        ctx.fillRect(32, 32 + i * 44, 184, 40)
      }
      text(ctx, item.name, 48, 40 + i * 44)
    })
    panel(ctx, 240, 24, W - 264, 120)
    const a = $gameActors.actor(1)
    text(ctx, `${a.name()}  Lv ${a.level}`, 260, 40)
    text(ctx, `HP ${a.hp}/${a.mhp}   MP ${a.mp}/${a.mmp}`, 260, 72, 18)
    text(ctx, `${$gameParty.gold()} ${$dataSystem.currencyUnit}   游戏时间 ${$gameSystem.playtimeText()}`, 260, 104, 16, '#cde')
    panel(ctx, 240, 156, W - 264, 56)
    text(ctx, menu._help, 260, 172, 18)
  }
  function render() {
    const ctx = canvas.getContext('2d')
    const current = scene()
    if (typeof current.draw === 'function') current.draw(ctx)
    else if (current instanceof Scene_Menu) drawMenu(ctx, current)
    else {
      drawMap(ctx)
      drawMessage(ctx)
    }
  }

  // ---------- globals ----------
  Object.assign(window, {
    Window_Base,
    Window_Message,
    Window_ChoiceList,
    Bitmap,
    Scene_Map,
    Scene_Menu,
    SceneManager,
    DataManager,
    ConfigManager: { alwaysDash: false },
    PluginManager: { setParameters() {} },
    $dataSystem: {
      gameTitle: 'Chaya 行走测试',
      currencyUnit: 'G',
      variables: [null, '步数'],
      switches: [null, '听过村长的话'],
      terms: { basic: [], commands: [], params: [], messages: {} },
    },
    $dataItems: [
      null,
      { id: 1, name: '药草', description: '回复 28 HP。' },
      { id: 2, name: '旧钥匙', description: '不知道能打开哪扇门。' },
      { id: 3, name: '以太水', description: '回复 12 MP。' },
    ],
    $dataActors: [null, { id: 1, name: '剑士', description: '' }, { id: 2, name: '术士', description: '' }],
    $dataMapInfos: window.WalkDemo.MAP_INFOS,
    $dataCommonEvents: [null, { id: 1, name: '回复', trigger: 0, switchId: 1, list: window.WalkDemo.rmEventList(COMMON_EVENTS[1]) }],
  })
  for (const name of ['Classes', 'Skills', 'Weapons', 'Armors', 'Enemies', 'States', 'Animations', 'Tilesets', 'Troops']) window[`$data${name}`] = [null]

  window.startWalkDemo = () => {
    canvas = document.getElementById('game')
    window.Graphics = { width: W, height: H, boxWidth: W, boxHeight: H, _canvas: canvas }
    Object.assign(window, {
      $gameTemp: new Game_Temp(),
      $gameSystem: new Game_System(),
      $gameMessage: new Game_Message(),
      $gameMap: new Game_Map(),
      $gamePlayer: new Game_Player(),
      $gameParty: new Game_Party(),
      $gameVariables: new Game_Values(),
      $gameSwitches: new Game_Values(),
      $gameTroop: { members: () => [] },
    })
    const actors = [null, new Game_Actor(1, '剑士'), new Game_Actor(2, '术士')]
    window.$gameActors = { _data: actors, actor: (id) => actors[id] || null }
    $gameMap.setup(1)
    mapScene = new Scene_Map()
    SceneManager._scene = mapScene
    canvas.addEventListener('mousedown', (event) => {
      const rect = canvas.getBoundingClientRect()
      TouchInput._onTrigger(((event.clientX - rect.left) * W) / rect.width, ((event.clientY - rect.top) * H) / rect.height)
    })
    setInterval(() => {
      if (SceneManager._stopped) return
      $gameSystem._frames++
      Input.update()
      scene().update()
      window.WalkDemo.AgentScenarios?.update()
      render()
    }, FRAME_MS)
    const scenario = typeof process !== 'undefined' ? process.env.CHAYA_DEMO_SCENARIO : ''
    if (scenario === 'battle') setTimeout(() => window.WalkDemo.AgentScenarios?.startBattle(), 1_500)
    if (scenario === 'qte') setTimeout(() => window.WalkDemo.AgentScenarios?.startQteBattle(), 1_500)
    if (scenario === 'story') setTimeout(() => window.WalkDemo.AgentScenarios?.startStory(), 1_500)
    if (scenario === 'choice') setTimeout(() => window.WalkDemo.AgentScenarios?.startStory(true), 1_500)
  }
})()
