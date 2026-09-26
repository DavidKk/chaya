/* Minimal RPG Maker-like scene for exercising the real Chaya plugin hooks. */
;(function () {
  'use strict'

  const examples = [
    { label: '応接室へ行く', text: '応接室へ行く。扉の向こうで誰かが待っている。' },
    { label: '夜まで休む', text: '今日はもう遅い。宿屋で夜まで休もう。' },
    { label: '・眠る前にセーブする', text: '・眠る前にセーブする\n明日の朝、もう一度ここへ戻ってこよう。' },
    { label: '村人に話しかける', text: 'この先の森には魔物がいる。夜になる前に村へ戻ろう。' },
    { label: '長い手紙を読む', text: 'これは長文スキップの確認です。'.repeat(24) },
  ]

  class CanvasContents {
    constructor(canvas) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.width = canvas.width
      this.height = canvas.height
      this.fontSize = 20
      this.textColor = '#fff'
      this.outlineColor = '#000'
    }
    clear() {
      this.ctx.clearRect(0, 0, this.width, this.height)
    }
    fillRect(x, y, width, height, color) {
      this.ctx.fillStyle = color
      this.ctx.fillRect(x, y, width, height)
    }
    measureTextWidth(text) {
      this.ctx.font = `${this.fontSize}px sans-serif`
      return this.ctx.measureText(text).width
    }
    drawText(text, x, y, width, height, align = 'left') {
      this.ctx.font = `${this.fontSize}px sans-serif`
      this.ctx.textBaseline = 'middle'
      this.ctx.textAlign = align
      const dx = align === 'center' ? x + width / 2 : align === 'right' ? x + width : x
      this.ctx.lineWidth = 3
      this.ctx.strokeStyle = this.outlineColor
      this.ctx.strokeText(text, dx, y + height / 2, width)
      this.ctx.fillStyle = this.textColor
      this.ctx.fillText(text, dx, y + height / 2, width)
    }
    destroy() {
      this.canvas.remove()
    }
  }

  class Window_Base {
    constructor(x, y, width, height) {
      if (x && typeof x === 'object') ({ x, y, width, height } = x)
      this.x = x || 0
      this.y = y || 0
      this.width = width || 100
      this.height = height || 40
      this.padding = 12
      this.parent = null
      this.opacity = 255
      this.backOpacity = 255
      this.element = document.createElement('canvas')
      this.element.className = 'rm-window'
      this.createContents()
      this.move(this.x, this.y, this.width, this.height)
    }
    set contentsOpacity(value) {
      this._contentsOpacity = value
      this.element.style.opacity = String(value / 255)
    }
    get contentsOpacity() {
      return this._contentsOpacity ?? 255
    }
    move(x, y, width, height) {
      Object.assign(this, { x, y, width, height })
      Object.assign(this.element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` })
    }
    createContents() {
      this.element.width = Math.max(1, this.width - this.padding * 2)
      this.element.height = Math.max(1, this.height - this.padding * 2)
      this.contents = new CanvasContents(this.element)
      this._windowContentsSprite = { bitmap: this.contents }
    }
    convertEscapeCharacters(text) {
      return String(text)
    }
    drawText(text) {
      this.lastText = String(text)
      return this.lastText
    }
    drawTextEx(text) {
      this.lastText = String(text)
      return this.lastText
    }
    processNormalCharacter() {}
    destroy() {
      this.element.remove()
    }
  }
  class Game_Message {
    constructor() {
      this._texts = []
      this._choices = []
    }
    clear() {
      this._texts = []
      this._choices = []
    }
    add(text) {
      this._texts.push(text)
    }
    setChoices(choices) {
      this._choices = choices
    }
    isChoice() {
      return this._choices.length > 0
    }
    isChoiceHelp() {
      return false
    }
    faceName() {
      return ''
    }
  }
  class Window_ChoiceList extends Window_Base {
    constructor() {
      super(0, 0, 10, 10)
      this.active = true
      this._index = 0
    }
    commandName(index) {
      return window.$gameMessage._choices[index] || ''
    }
    index() {
      return this._index
    }
    refresh() {
      window.renderDemoChoices?.()
    }
  }
  class Window_Message extends Window_Base {
    constructor() {
      super(12, 464, 792, 148)
      this._choiceWindow = new Window_ChoiceList()
    }
    startMessage() {
      window.renderDemoMessage?.()
    }
    startInput() {
      return window.$gameMessage.isChoice()
    }
    forceClear() {
      window.$gameMessage.clear()
    }
    update() {}
    isTriggered() {
      return false
    }
  }
  class Bitmap {
    drawText(text) {
      return text
    }
  }

  window.Window_Base = Window_Base
  window.Window_Message = Window_Message
  window.Window_ChoiceList = Window_ChoiceList
  window.Game_Message = Game_Message
  window.Bitmap = Bitmap
  window.Graphics = { boxWidth: 816, boxHeight: 624, _canvas: document.getElementById('scene') }
  window.SceneManager = {
    _stopped: false,
    _scene: {
      _windowLayer: { children: [] },
      addChild(win) {
        win.parent = this
        document.getElementById('scene').appendChild(win.element)
      },
      removeChild(win) {
        win.parent = null
        win.element.remove()
      },
    },
    stop() {
      this._stopped = true
    },
    resume() {
      this._stopped = false
    },
  }
  window.Input = { clear() {} }
  window.DataManager = {
    isDatabaseLoaded() {
      return true
    },
    onLoad() {},
  }
  window.PluginManager = { setParameters() {} }
  window.$gameMessage = new Game_Message()
  window.$gameParty = { gold: () => 0, members: () => [], numItems: () => 0, items: () => [], weapons: () => [], armors: () => [], gainGold() {}, loseGold() {}, gainItem() {} }
  window.$gameActors = { actor: () => null, _data: [] }
  window.$gameVariables = { value: () => 0, setValue() {} }
  window.$gameSwitches = { value: () => false, setValue() {} }
  window.$dataSystem = { gameTitle: '翻訳デバッグの町', currencyUnit: 'G', variables: [], switches: [], terms: { basic: [], commands: [], params: [], messages: {} } }
  for (const name of ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'States', 'Animations', 'Tilesets', 'CommonEvents', 'Troops'])
    window[`$data${name}`] = [null]
  window.$dataMap = { displayName: '翻訳デバッグの町', events: [null] }

  let selected = 0
  let messageWindow
  const choiceList = () => messageWindow._choiceWindow
  window.renderDemoChoices = () => {
    const root = document.getElementById('choices')
    const labels = examples.map((_, i) => choiceList().commandName(i))
    const previous = [...root.children]
    if (previous.length === labels.length && previous.every((node, i) => node.textContent === labels[i] && node.getAttribute('aria-selected') === String(i === selected))) return
    root.replaceChildren()
    for (let i = 0; i < labels.length; i++) {
      const button = document.createElement('button')
      button.className = 'choice'
      button.setAttribute('role', 'option')
      button.setAttribute('aria-selected', String(i === selected))
      button.textContent = labels[i]
      button.onclick = () => select(i)
      root.appendChild(button)
    }
  }
  window.renderDemoMessage = () => {
    const raw = window.$gameMessage._texts.join('\n')
    const rendered = messageWindow.drawTextEx(raw)
    const node = document.getElementById('message')
    if (node.textContent !== rendered) node.textContent = rendered
  }
  function select(index) {
    selected = (index + examples.length) % examples.length
    choiceList()._index = selected
    window.$gameMessage.clear()
    window.$gameMessage.setChoices(examples.map((item) => item.label))
    window.$gameMessage.add(examples[selected].text)
    messageWindow.startMessage()
    messageWindow.startInput()
    window.renderDemoChoices()
  }
  window.startDemoGame = () => {
    messageWindow = new Window_Message()
    window.DataManager.isDatabaseLoaded()
    window.DataManager.onLoad(window.$dataMap)
    const ready = window.__chayaTranslationRuntime?.request({ method: 'POST', path: '/api/translate', body: { mode: 'play-settings' } })
    Promise.resolve(ready).finally(() => select(0))
    document.addEventListener('keydown', (event) => {
      if (document.getElementById('chaya-game-edit-host')?.hasAttribute('data-open')) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        select(selected + 1)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        select(selected - 1)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        select(selected)
      }
    })
    setInterval(() => {
      if (window.SceneManager._stopped) return
      messageWindow.update()
      const state = window.ChayaTrans?.status?.()
      const label = state ? `插件已加载 · 词库 ${state.entries} 条 · ${state.playMode}` : '翻译插件未加载'
      const status = document.getElementById('status')
      if (status.textContent !== label) status.textContent = label
    }, 120)
  }
})()
