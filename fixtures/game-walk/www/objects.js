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
    _pressed: false,
    x: 0,
    y: 0,
    _onTrigger(x, y) {
      this._queue.push({ x, y })
      this._pressed = true
      this.x = x
      this.y = y
    },
    // Like RM TouchInput._onMove: the pointer only counts while the button is held
    _onMove(x, y) {
      if (!this._pressed) return
      this.x = x
      this.y = y
    },
    _onRelease(x, y) {
      this._pressed = false
      if (x != null) this.x = x
      if (y != null) this.y = y
    },
    isPressed() {
      return this._pressed
    },
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
      this._trigger = data.touch ? 1 : 0
      this._starting = false
      this._erased = false
    }
    get x() {
      return this._x
    }
    get y() {
      return this._y
    }
    page() {
      return this.list() ? {} : null
    }
    isTriggerIn(triggers) {
      return triggers.includes(this._trigger)
    }
    /** Doors are below-characters touch events; everything else blocks like a same-as-characters NPC */
    isNormalPriority() {
      return !this._data.touch
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
    clearStarting() {
      this._starting = false
    }
    /** Commands of the last page whose switch condition holds (RPG Maker picks the highest such page) */
    list() {
      const pages = window.$dataMap?.events?.[this._eventId]?.pages || []
      const page = [...pages].reverse().find((pg) => !pg.conditions.switch1Valid || $gameSwitches.value(pg.conditions.switch1Id))
      return page ? page.list : null
    }
    start() {
      interpreter.startEvent(this)
    }
  }

  class Game_Map {
    setup(mapId) {
      this._mapId = mapId
      this._events = MAPS[mapId].events.map((data) => new Game_Event(mapId, data))
      window.$dataMap = window.WalkDemo.rmMap(mapId)
      window.$dataTilesets = [null, window.WalkDemo.rmTileset]
      this._interpreter = interpreter
    }
    mapId() {
      return this._mapId
    }
    displayName() {
      return MAPS[this._mapId].name
    }
    isEventRunning() {
      return interpreter.isRunning()
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
    isValid(x, y) {
      return x >= 0 && y >= 0 && x < COLS && y < ROWS
    }
    deltaX(x1, x2) {
      return x1 - x2
    }
    deltaY(y1, y2) {
      return y1 - y2
    }
    distance(x1, y1, x2, y2) {
      return Math.abs(x1 - x2) + Math.abs(y1 - y2)
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
    isThrough() {
      return this._through
    }
    isInVehicle() {
      return false
    }
    isMapPassable(x, y, d) {
      const [dx, dy] = DIRS[d]
      return MAPS[$gameMap.mapId()].rows[y + dy]?.[x + dx] === '.'
    }
    isCollidedWithCharacters(x, y) {
      const event = $gameMap.eventAt(x, y)
      return !!event && event.isNormalPriority()
    }
    canPass(x, y, d) {
      const [dx, dy] = DIRS[d]
      if (!$gameMap.isValid(x + dx, y + dy)) return false
      if (this.isThrough()) return true
      return this.isMapPassable(x, y, d) && !this.isCollidedWithCharacters(x + dx, y + dy)
    }
    moveStraight(d) {
      this._direction = d
      if (!this.canPass(this._x, this._y, d)) return false
      const [dx, dy] = DIRS[d]
      this._x += dx
      this._y += dy
      return true
    }
    /** Game_Character.findDirectionTo as shipped with MV/MZ: A* capped at 12 steps, then the closest node by distance */
    findDirectionTo(goalX, goalY) {
      const searchLimit = 12
      const nodeList = []
      const openList = []
      const closedList = []
      const start = { parent: null, x: this.x, y: this.y, g: 0, f: $gameMap.distance(this.x, this.y, goalX, goalY) }
      let best = start
      if (this.x === goalX && this.y === goalY) return 0
      nodeList.push(start)
      openList.push(start.y * COLS + start.x)
      while (nodeList.length > 0) {
        let bestIndex = 0
        for (let i = 0; i < nodeList.length; i++) if (nodeList[i].f < nodeList[bestIndex].f) bestIndex = i
        const current = nodeList[bestIndex]
        const pos1 = current.y * COLS + current.x
        const g1 = current.g
        nodeList.splice(bestIndex, 1)
        openList.splice(openList.indexOf(pos1), 1)
        closedList.push(pos1)
        if (current.x === goalX && current.y === goalY) {
          best = current
          break
        }
        if (g1 >= searchLimit) continue
        for (const d of [2, 4, 6, 8]) {
          const x2 = current.x + DIRS[d][0]
          const y2 = current.y + DIRS[d][1]
          const pos2 = y2 * COLS + x2
          if (closedList.includes(pos2) || !this.canPass(current.x, current.y, d)) continue
          const g2 = g1 + 1
          const index2 = openList.indexOf(pos2)
          if (index2 < 0 || g2 < nodeList[index2].g) {
            let neighbor
            if (index2 >= 0) neighbor = nodeList[index2]
            else {
              neighbor = {}
              nodeList.push(neighbor)
              openList.push(pos2)
            }
            Object.assign(neighbor, { parent: current, x: x2, y: y2, g: g2, f: g2 + $gameMap.distance(x2, y2, goalX, goalY) })
            if (!best || neighbor.f - neighbor.g < best.f - best.g) best = neighbor
          }
        }
      }
      let node = best
      while (node.parent && node.parent !== start) node = node.parent
      const deltaX1 = node.x - start.x
      const deltaY1 = node.y - start.y
      if (deltaY1 > 0) return 2
      if (deltaX1 < 0) return 4
      if (deltaX1 > 0) return 6
      if (deltaY1 < 0) return 8
      const deltaX2 = this.x - goalX
      const deltaY2 = this.y - goalY
      if (Math.abs(deltaX2) > Math.abs(deltaY2)) return deltaX2 > 0 ? 4 : 6
      if (deltaY2 !== 0) return deltaY2 > 0 ? 8 : 2
      return 0
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
      return $gameActors._data.filter(Boolean)
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

  const compare = (a, b, op) => [a === b, a >= b, a <= b, a > b, a < b, a !== b][op] ?? false

  /**
   * Map interpreter over RPG Maker command lists ($dataMap pages / $dataCommonEvents), same shape as
   * Game_Interpreter: setup(list, eventId), _index, _branch[indent], isRunning().
   */
  const interpreter = {
    _list: null,
    _index: 0,
    _indent: 0,
    _branch: {},
    _eventId: 0,
    setup(list, eventId = 0) {
      this._list = list && list.length ? list.slice() : null
      this._index = 0
      this._branch = {}
      this._eventId = eventId
    },
    clear() {
      this.setup(null)
    },
    startEvent(event) {
      const list = event.list()
      if (!list) return
      event._starting = true
      this.setup(list, event.eventId())
    },
    isRunning() {
      return !!this._list || $gameMessage.isBusy()
    },
    update() {
      while (this._list && !$gameMessage.isBusy()) {
        const cmd = this._list[this._index]
        if (!cmd) {
          $gameMap.event(this._eventId)?.clearStarting()
          this._list = null
          break
        }
        this._indent = cmd.indent
        this.execute(cmd, cmd.parameters)
        this._index++
      }
    },
    /** Skip the body of the branch header at `_index` */
    skipBranch() {
      while (this._list[this._index + 1] && this._list[this._index + 1].indent > this._indent) this._index++
    },
    execute(cmd, p) {
      switch (cmd.code) {
        case 101: {
          const lines = []
          while (this._list[this._index + 1]?.code === 401) lines.push(this._list[++this._index].parameters[0])
          $gameMessage.setSpeakerName(p[4])
          $gameMessage.add(lines.join('\n'))
          const next = this._list[this._index + 1]
          if (next?.code === 102) {
            this._index++
            this.setupChoices(next.parameters)
          }
          SceneManager._scene._messageWindow.startMessage()
          return
        }
        case 102:
          this.setupChoices(p)
          $gameMessage.add('')
          SceneManager._scene._messageWindow.startMessage()
          return
        case 402:
          if (this._branch[this._indent] !== p[0]) this.skipBranch()
          return
        case 403:
          if (this._branch[this._indent] !== -2) this.skipBranch()
          return
        case 111: {
          const result = this.condition(p)
          this._branch[this._indent] = result
          if (!result) this.skipBranch()
          return
        }
        case 411:
          if (this._branch[this._indent] !== false) this.skipBranch()
          return
        case 115:
          this._index = this._list.length
          return
        case 117: {
          const list = window.$dataCommonEvents[p[0]]?.list || []
          const body = list.filter((c) => c.code !== 0 || c.indent > 0).map((c) => ({ ...c, indent: c.indent + this._indent }))
          this._list.splice(this._index + 1, 0, ...body)
          return
        }
        case 121:
          for (let id = p[0]; id <= p[1]; id++) $gameSwitches.setValue(id, p[2] === 0)
          return
        case 122:
          for (let id = p[0]; id <= p[1]; id++) {
            const operand = p[3] === 0 ? p[4] : $gameVariables.value(p[4])
            const cur = $gameVariables.value(id)
            $gameVariables.setValue(id, [operand, cur + operand, cur - operand, cur * operand][p[2]] ?? cur)
          }
          return
        case 125:
          $gameParty.gainGold((p[0] === 0 ? 1 : -1) * (p[1] === 0 ? p[2] : $gameVariables.value(p[2])))
          return
        case 126:
          $gameParty.gainItem($dataItems[p[0]], (p[1] === 0 ? 1 : -1) * (p[2] === 0 ? p[3] : $gameVariables.value(p[3])))
          return
        case 201:
          $gamePlayer.reserveTransfer(p[1], p[2], p[3], p[4])
          return
        case 314:
          $gameParty.members().forEach((actor) => actor.recoverAll())
          return
        default:
      }
    },
    setupChoices(p) {
      const indent = this._indent
      $gameMessage.setChoices(p[0], (n) => {
        this._branch[indent] = n
      })
    },
    condition(p) {
      switch (p[0]) {
        case 0:
          return !!$gameSwitches.value(p[1]) === (p[2] === 0)
        case 1:
          return compare($gameVariables.value(p[1]), p[2] === 0 ? p[3] : $gameVariables.value(p[3]), p[4])
        case 7:
          return compare($gameParty.gold(), p[1], [1, 2, 4][p[2]])
        case 8:
          return $gameParty.hasItem($dataItems[p[1]])
        default:
          return false
      }
    },
  }

  window.WalkDemo.interpreter = interpreter
  Object.assign(window, { Input, TouchInput, Game_Temp, Game_Map, Game_Event, Game_Player, Game_Actor, Game_Party, Game_Values, Game_Message, Game_System })
})()
