/* Walk demo game objects: input and the RM-style $game* classes ChayaAgent / ChayaEdit read. */
;(function () {
  'use strict'

  const { COLS, ROWS, MAPS, KEYS, DIRS } = window.WalkDemo

  function editPanelOpen() {
    return !!document.getElementById('chaya-game-edit-host')?.hasAttribute('data-open')
  }

  const Input = {
    _currentState: {},
    _previousState: {},
    _latest: {},
    update() {
      this._previousState = this._latest
      this._latest = { ...this._currentState }
    },
    isPressed(name) {
      if (name === 'cancel' || name === 'menu') return !!this._latest.escape || !!this._latest[name]
      return !!this._latest[name]
    },
    isTriggered(name) {
      const now = this.isPressed(name)
      const prev = name === 'cancel' || name === 'menu' ? !!this._previousState.escape || !!this._previousState[name] : !!this._previousState[name]
      return now && !prev
    },
    dir4() {
      for (const [name, d] of [
        ['down', 2],
        ['left', 4],
        ['right', 6],
        ['up', 8],
      ])
        if (this.isPressed(name)) return d
      return 0
    },
    clear() {
      this._currentState = {}
      this._latest = {}
      this._previousState = {}
    },
  }
  document.addEventListener('keydown', (event) => {
    const name = KEYS[event.key]
    if (!name || editPanelOpen()) return
    event.preventDefault()
    Input._currentState[name] = true
  })
  document.addEventListener('keyup', (event) => {
    const name = KEYS[event.key]
    if (name) Input._currentState[name] = false
  })

  const TouchInput = {
    _queue: [],
    _onTrigger(x, y) {
      this._queue.push({ x, y })
    },
    _onRelease() {},
    take() {
      return this._queue.shift() || null
    },
  }

  class Game_Temp {
    constructor() {
      this.clearDestination()
      this._commonEventId = 0
    }
    setDestination(x, y) {
      this._destinationX = x
      this._destinationY = y
    }
    clearDestination() {
      this._destinationX = null
      this._destinationY = null
    }
    isDestinationValid() {
      return this._destinationX !== null && this._destinationY !== null
    }
    reserveCommonEvent(id) {
      this._commonEventId = id
    }
  }

  class Game_Event {
    constructor(mapId, data) {
      this._mapId = mapId
      this._eventId = data.id
      this._data = data
      this._x = data.x
      this._y = data.y
      this._starting = false
    }
    eventId() {
      return this._eventId
    }
    event() {
      return { name: this._data.name }
    }
    isStarting() {
      return this._starting
    }
    start() {
      interpreter.startEvent(this)
    }
  }

  class Game_Map {
    setup(mapId) {
      this._mapId = mapId
      this._events = MAPS[mapId].events.map((data) => new Game_Event(mapId, data))
    }
    mapId() {
      return this._mapId
    }
    displayName() {
      return MAPS[this._mapId].name
    }
    width() {
      return COLS
    }
    height() {
      return ROWS
    }
    events() {
      return this._events
    }
    event(id) {
      return this._events.find((event) => event.eventId() === id) || null
    }
    eventAt(x, y) {
      return this._events.find((event) => event._x === x && event._y === y) || null
    }
    isPassable(x, y) {
      const row = MAPS[this._mapId].rows[y]
      if (!row || x < 0 || x >= COLS) return false
      const event = this.eventAt(x, y)
      if (event && !event._data.touch) return false
      return row[x] === '.' || !!event?._data.touch
    }
  }

  class Game_Player {
    constructor() {
      this._x = 8
      this._y = 9
      this._realX = 8
      this._realY = 9
      this._direction = 8
      this._through = false
      this._transfer = null
    }
    get x() {
      return this._x
    }
    get y() {
      return this._y
    }
    direction() {
      return this._direction
    }
    isMoving() {
      return this._realX !== this._x || this._realY !== this._y
    }
    moveSpeedRate() {
      return 1
    }
    setThrough(on) {
      this._through = !!on
    }
    locate(x, y) {
      this._x = this._realX = x
      this._y = this._realY = y
    }
    reserveTransfer(mapId, x, y, d) {
      this._transfer = { mapId, x, y, d: d || this._direction }
    }
    performTransfer() {
      const { mapId, x, y, d } = this._transfer
      this._transfer = null
      $gameTemp.clearDestination()
      $gameMap.setup(mapId)
      this.locate(x, y)
      this._direction = d
    }
    front() {
      const [dx, dy] = DIRS[this._direction]
      return { x: this._x + dx, y: this._y + dy }
    }
    moveStraight(d) {
      this._direction = d
      const [dx, dy] = DIRS[d]
      const nx = this._x + dx
      const ny = this._y + dy
      if (!this._through && !$gameMap.isPassable(nx, ny)) return false
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return false
      this._x = nx
      this._y = ny
      return true
    }
    /** Next step toward the destination (BFS over passable tiles), or 0 when unreachable */
    stepToward(tx, ty) {
      const key = (x, y) => y * COLS + x
      const prev = new Map([[key(this._x, this._y), null]])
      const queue = [[this._x, this._y]]
      while (queue.length) {
        const [x, y] = queue.shift()
        if (x === tx && y === ty) break
        for (const d of [2, 4, 6, 8]) {
          const [dx, dy] = DIRS[d]
          const nx = x + dx
          const ny = y + dy
          if (prev.has(key(nx, ny)) || (!this._through && !$gameMap.isPassable(nx, ny))) continue
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
          prev.set(key(nx, ny), { x, y, d })
          queue.push([nx, ny])
        }
      }
      // Each entry is { x, y: the tile it came from, d: the step out of that tile }
      let entry = prev.get(key(tx, ty))
      if (!entry) return 0
      while (entry.x !== this._x || entry.y !== this._y) entry = prev.get(key(entry.x, entry.y))
      return entry.d
    }
    update() {
      const dash = Input.isPressed('shift') || ConfigManager.alwaysDash
      const step = (1 / 12) * this.moveSpeedRate() * (dash ? 2 : 1)
      const toward = (real, target) => (real < target ? Math.min(target, real + step) : Math.max(target, real - step))
      const wasMoving = this.isMoving()
      this._realX = toward(this._realX, this._x)
      this._realY = toward(this._realY, this._y)
      if (wasMoving && !this.isMoving()) this.onStepEnd()
    }
    onStepEnd() {
      $gameVariables.setValue(1, $gameVariables.value(1) + 1)
      const event = $gameMap.eventAt(this._x, this._y)
      if (event?._data.touch) {
        const { mapId, x, y, d } = event._data.touch
        this.reserveTransfer(mapId, x, y, d)
      }
      if ($gameTemp._destinationX === this._x && $gameTemp._destinationY === this._y) $gameTemp.clearDestination()
    }
  }

  class Game_Actor {
    constructor(id, name) {
      this._actorId = id
      this._name = name
      this._level = 1
      this._exp = 0
      this._hp = 80
      this._mp = 20
      this._classId = 1
    }
    actorId() {
      return this._actorId
    }
    name() {
      return this._name
    }
    setName(name) {
      this._name = name
    }
    get level() {
      return this._level
    }
    get hp() {
      return this._hp
    }
    get mp() {
      return this._mp
    }
    get mhp() {
      return 90 + this._level * 10
    }
    get mmp() {
      return 15 + this._level * 5
    }
    param(i) {
      return i === 0 ? this.mhp : i === 1 ? this.mmp : 10 + this._level
    }
    setHp(n) {
      this._hp = Math.max(0, Math.min(this.mhp, Math.floor(n)))
    }
    setMp(n) {
      this._mp = Math.max(0, Math.min(this.mmp, Math.floor(n)))
    }
    recoverAll() {
      this._hp = this.mhp
      this._mp = this.mmp
    }
    expForLevel(level) {
      return (level - 1) * 100
    }
    currentExp() {
      return this._exp
    }
    currentLevelExp() {
      return this.expForLevel(this._level)
    }
    nextLevelExp() {
      return this.expForLevel(this._level + 1)
    }
    changeExp(exp) {
      this._exp = Math.max(0, Math.floor(exp))
      this._level = Math.max(1, Math.min(99, Math.floor(this._exp / 100) + 1))
    }
    gainExp(exp) {
      this.changeExp(this._exp + exp)
    }
    skills() {
      return []
    }
    states() {
      return []
    }
    equips() {
      return []
    }
    equipSlots() {
      return []
    }
    learnSkill() {}
    forgetSkill() {}
    addState() {}
    removeState() {}
    clearStates() {}
  }

  class Game_Party {
    constructor() {
      this._gold = 100
      this._items = {}
    }
    gold() {
      return this._gold
    }
    gainGold(n) {
      this._gold = Math.max(0, Math.min(99999999, this._gold + Math.floor(n)))
    }
    loseGold(n) {
      this.gainGold(-n)
    }
    members() {
      return [$gameActors.actor(1)]
    }
    numItems(item) {
      return (item && this._items[item.id]) || 0
    }
    hasItem(item) {
      return this.numItems(item) > 0
    }
    gainItem(item, n) {
      if (!item || !$dataItems.includes(item)) return
      this._items[item.id] = Math.max(0, Math.min(99, this.numItems(item) + Math.floor(n)))
    }
    items() {
      return $dataItems.filter((item) => item && this.numItems(item) > 0)
    }
    weapons() {
      return []
    }
    armors() {
      return []
    }
  }

  class Game_Values {
    constructor() {
      this._data = []
    }
    value(id) {
      return this._data[id] ?? 0
    }
    setValue(id, value) {
      this._data[id] = value
    }
  }

  class Game_Message {
    constructor() {
      this.clear()
    }
    clear() {
      this._texts = []
      this._choices = []
      this._speakerName = ''
      this._choiceCallback = null
    }
    setSpeakerName(name) {
      this._speakerName = name || ''
    }
    speakerName() {
      return this._speakerName
    }
    add(text) {
      this._texts.push(text)
    }
    allText() {
      return this._texts.join('\n')
    }
    setChoices(choices, callback) {
      this._choices = choices
      this._choiceCallback = callback
    }
    choices() {
      return this._choices
    }
    isChoice() {
      return this._choices.length > 0
    }
    isBusy() {
      return this._texts.length > 0 || this._choices.length > 0
    }
    onChoice(n) {
      if (this._choiceCallback) this._choiceCallback(n)
    }
  }

  class Game_System {
    constructor() {
      this._frames = 0
    }
    playtimeText() {
      const s = Math.floor(this._frames / 60)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
    }
  }

  /** Runs one event's commands, one message at a time */
  const interpreter = {
    queue: [],
    event: null,
    startEvent(event) {
      const data = event._data
      event._starting = true
      this.event = event
      if (data.talk) this.queue.push(...data.talk)
      if (data.chest) {
        const opened = $gameSwitches.value(100 + data.id)
        const item = $dataItems[data.chest.itemId]
        this.queue.push(opened ? { text: '宝箱是空的。' } : [{ gain: data.chest }, { switch: [100 + data.id, true] }, { text: `得到了 ${item.name} ×${data.chest.count}！` }])
      }
      this.queue = this.queue.flat()
    },
    isRunning() {
      return this.queue.length > 0 || $gameMessage.isBusy()
    },
    update() {
      while (this.queue.length && !$gameMessage.isBusy()) {
        const cmd = this.queue.shift()
        if (cmd.switch) $gameSwitches.setValue(...cmd.switch)
        if (cmd.gain) $gameParty.gainItem($dataItems[cmd.gain.itemId], cmd.gain.count)
        if (cmd.heal) $gameParty.members().forEach((actor) => actor.recoverAll())
        if (cmd.text) {
          $gameMessage.setSpeakerName(cmd.speaker)
          $gameMessage.add(cmd.text)
          if (cmd.choices) $gameMessage.setChoices(cmd.choices, (n) => this.queue.unshift(...(cmd.branches[n] || [])))
          SceneManager._scene._messageWindow.startMessage()
        }
      }
      if (!this.isRunning() && this.event) {
        this.event._starting = false
        this.event = null
      }
    },
  }

  window.WalkDemo.interpreter = interpreter
  Object.assign(window, { Input, TouchInput, Game_Temp, Game_Map, Game_Event, Game_Player, Game_Actor, Game_Party, Game_Values, Game_Message, Game_System })
})()
