import { installSubtitleOverlay } from '@/plugins/src/translator/engine/subtitle-overlay'

it.each([
  ['MV', 18],
  ['MZ', 12],
  ['MV', 28],
] as const)('keeps all subtitle glyphs inside the %s content area with padding %i', (engine, padding) => {
  class DomNode {
    style = { setProperty: jest.fn() }
    dataset: Record<string, string> = {}
    textContent = ''
    innerHTML = ''
    children: DomNode[] = []
    attributes = new Map<string, string>()
    mark = { textContent: '' }
    label = { textContent: '' }
    appendChild(node: DomNode) {
      this.children.push(node)
      return node
    }
    remove() {
      this.attributes.clear()
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value)
    }
    removeAttribute(name: string) {
      this.attributes.delete(name)
    }
    hasAttribute(name: string) {
      return this.attributes.has(name)
    }
    querySelector(selector: string) {
      return selector === '.chaya-status-label' ? this.label : this.mark
    }
  }
  const document = { head: new DomNode(), body: new DomNode(), createElement: () => new DomNode() }
  const scene = {
    children: [] as unknown[],
    addChild(child: { parent?: unknown }) {
      child.parent = this
      this.children.push(child)
    },
    removeChild(child: unknown) {
      this.children = this.children.filter((item) => item !== child)
    },
  }
  class Base {
    parent: unknown
    opacity = 255
    contentsOpacity = 255
    backOpacity = 255
    interactive = true
    interactiveChildren = true
    active = true
    element = { style: { pointerEvents: '' } }
    padding = padding
    contents = {
      width: 700,
      height: 200,
      ctx: {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: '',
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
      },
      fontSize: 20,
      textColor: '',
      outlineColor: '',
      drawText: jest.fn(),
      fillRect: jest.fn(),
      clear: jest.fn(),
      measureTextWidth: (text: string) => text.length * 20,
      destroy: jest.fn(),
    }
    _windowContentsSprite: { bitmap?: typeof this.contents } = { bitmap: this.contents }
    y: number
    constructor(
      public x: number,
      y: number,
      public width: number,
      public height: number
    ) {
      if (typeof x === 'object') Object.assign(this, x)
      else this.y = y
      this.createContents()
    }
    move(x: number, y: number, width: number, height: number) {
      this.x = x
      this.y = y
      this.width = width
      this.height = height
    }
    createContents() {
      this.contents.width = this.width - this.padding * 2
      this.contents.height = this.height - this.padding * 2
      this._windowContentsSprite.bitmap = this.contents
    }
    destroy = jest.fn()
  }
  class Message extends Base {
    update() {
      return 'frame'
    }
  }
  let pointerMove: ((event: { clientX: number; clientY: number }) => void) | undefined
  let pointerOut: ((event: { relatedTarget: unknown }) => void) | undefined
  const host: { Utils: { RPGMAKER_NAME: string }; Rectangle: unknown; __chayaSubtitleCleanup?: () => void; addEventListener: jest.Mock; removeEventListener: jest.Mock } = {
    Utils: { RPGMAKER_NAME: engine },
    innerWidth: 816,
    innerHeight: 624,
    addEventListener: jest.fn((type, handler) => {
      if (type === 'pointermove') pointerMove = handler
      if (type === 'pointerout') pointerOut = handler
    }),
    removeEventListener: jest.fn(),
    Rectangle: class {
      constructor(
        public x: number,
        public y: number,
        public width: number,
        public height: number
      ) {}
    },
  }
  const gameMessage = { _texts: ['こんにちは'], _choices: [] }
  const globals = {
    window: host,
    Window_Base: Base,
    Window_Message: Message,
    SceneManager: { _scene: scene },
    Graphics: { boxWidth: 816, boxHeight: 624, _canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 816, height: 624 }) } },
    $gameMessage: gameMessage,
    document,
    requestAnimationFrame: (callback: FrameRequestCallback) => callback(0),
  }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  jest.useFakeTimers()
  let now = 0
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now)
  const assertTextFits = (win: Base) => {
    for (const [text, x, y, width, height] of win.contents.drawText.mock.calls) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + width).toBeLessThanOrEqual(win.contents.width)
      expect(y + height).toBeLessThanOrEqual(win.contents.height)
      expect(win.contents.measureTextWidth(text)).toBeLessThanOrEqual(width)
    }
    expect(win.y + win.height).toBeLessThanOrEqual(globals.Graphics.boxHeight)
  }
  try {
    const show = installSubtitleOverlay()
    const message = new Message(0, 460, 816, 160)
    show({ text: '你好，村子就在前面。', choices: [] }, message)
    expect(message.update()).toBe('frame')
    expect(scene.children).toHaveLength(1)
    const overlay = scene.children[0] as Base
    expect(overlay.y + overlay.height).toBeLessThan(message.y)
    expect(overlay.contents.drawText).toHaveBeenCalled()
    assertTextFits(overlay)

    const longText = Array.from({ length: 28 }, (_, index) => `第${index + 1}行完整字幕`)
    show({ text: longText.join('\n'), choices: [] }, message)
    message.update()
    const paged = scene.children[0] as Base
    for (let page = 0; page < 28; page++) {
      now += 60_000
      message.update()
    }
    const rendered = new Set(paged.contents.drawText.mock.calls.map(([text]) => text))
    expect([...rendered]).toEqual(expect.arrayContaining(longText))
    expect([...rendered].some((line: string) => line.endsWith('…'))).toBe(false)
    assertTextFits(paged)
    ;(message as Message & { _choiceWindow: { active: boolean; index: () => number } })._choiceWindow = { active: true, index: () => 1 }
    show({ text: '你好，村子就在前面。', choices: ['前进', '留下'] }, message)
    message.update()
    expect(scene.children).toHaveLength(1)
    expect((scene.children[0] as Base).contents.drawText).toHaveBeenCalledWith('2. 留下', expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), 'center')
    show({ text: '到街上去', choices: [], choiceHelp: true }, message)
    message.update()
    expect(scene.children).toHaveLength(1)
    expect((scene.children[0] as Base).contents.drawText).toHaveBeenCalledWith('到街上去', expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), 'center')
    assertTextFits(scene.children[0] as Base)
    show({ text: '异步译文', choices: [], replace: true }, message)
    message.update()
    const replacement = scene.children[0] as Base
    expect(replacement.x).toBe(message.x)
    expect(replacement.y).toBe(message.y)
    expect(replacement.contents.fillRect).toHaveBeenCalledWith(0, 0, replacement.contents.width, replacement.contents.height, 'rgba(0, 0, 0, 1)')
    expect(replacement.contents.drawText).toHaveBeenCalledWith('异步译文', expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), 'left')
    show({ text: '', choices: [], replace: true, pending: true }, message)
    message.update()
    expect(scene.children).toHaveLength(0)
    const indicator = document.body.children[0]
    expect(indicator.dataset.kind).toBe('pending')
    expect(indicator.dataset.phase).toBe('icon')
    expect(indicator.label.textContent).toBe('翻译中')
    expect(indicator.style.setProperty).toHaveBeenCalledWith('--chaya-status-width', '70px')
    jest.advanceTimersByTime(180)
    expect(indicator.dataset.phase).toBe('expanded')
    expect(document.head.children[0].textContent).toContain('position: fixed')
    expect(document.head.children[0].textContent).toContain('animation: chaya-status-spin')
    expect(document.head.children[0].textContent).toContain('pointer-events: none')
    expect(document.head.children[0].textContent).toContain('background: rgba(0, 0, 0, .76)')
    expect(document.head.children[0].textContent).toContain('font: 700 12px/16px')
    expect(document.head.children[0].textContent).toContain('color: #fff; font: 700 12px/16px')
    pointerMove?.({ clientX: 790, clientY: 590 })
    expect(indicator.dataset.corner).toBe('top')
    pointerMove?.({ clientX: 20, clientY: 590 })
    expect(indicator.dataset.corner).toBe('bottom')
    pointerMove?.({ clientX: 790, clientY: 30 })
    expect(indicator.dataset.corner).toBe('bottom')
    pointerMove?.({ clientX: 790, clientY: 590 })
    expect(indicator.dataset.corner).toBe('top')
    pointerOut?.({ relatedTarget: null })
    expect(indicator.dataset.corner).toBe('bottom')
    show(null)
    expect(indicator.dataset.phase).toBe('icon')
    show({ text: '', choices: [], replace: true, pending: true }, message)
    expect(indicator.dataset.phase).toBe('icon')
    jest.advanceTimersByTime(180)
    expect(indicator.dataset.phase).toBe('expanded')
    show({ text: '', choices: [], replace: true, badge: 'translated' }, message)
    expect(indicator.dataset.kind).toBe('pending')
    jest.advanceTimersByTime(179)
    expect(indicator.dataset.kind).toBe('pending')
    jest.advanceTimersByTime(1)
    expect(indicator.dataset.kind).toBe('translated')
    expect(indicator.dataset.phase).toBe('expanded')
    expect(indicator.mark.textContent).toBe('✓')
    expect(indicator.label.textContent).toBe('已翻译')
    show({ text: '', choices: [], replace: true, badge: 'cached' }, message)
    expect(indicator.dataset.kind).toBe('pending')
    expect(indicator.dataset.phase).toBe('icon')
    jest.advanceTimersByTime(179)
    expect(indicator.dataset.phase).toBe('icon')
    expect(indicator.label.textContent).toBe('')
    expect(indicator.attributes.get('aria-label')).toBe('处理中')
    jest.advanceTimersByTime(1)
    expect(indicator.dataset.kind).toBe('cached')
    expect(indicator.dataset.phase).toBe('icon')
    expect(indicator.mark.textContent).toBe('✓')
    // 快速切换 A → B 时，A 的完成定时器不能覆盖 B 的状态。
    show({ text: '', choices: [], replace: true, badge: 'translated' }, message)
    jest.advanceTimersByTime(80)
    now += 80
    show({ text: '', choices: [], replace: true, badge: 'skipped' }, message)
    jest.advanceTimersByTime(100)
    now += 100
    expect(indicator.dataset.kind).toBe('pending')
    jest.advanceTimersByTime(80)
    now += 80
    expect(indicator.dataset.kind).toBe('skipped')
    expect(indicator.label.textContent).toBe('已跳过')

    // 异步翻译在 spinner 入场前完成，不应展开「翻译中」。
    show({ text: '', choices: [], replace: true, pending: true }, message)
    jest.advanceTimersByTime(80)
    now += 80
    show({ text: '', choices: [], replace: true, badge: 'translated' }, message)
    jest.advanceTimersByTime(99)
    now += 99
    expect(indicator.dataset.kind).toBe('pending')
    expect(indicator.dataset.phase).toBe('icon')
    jest.advanceTimersByTime(1)
    now += 1
    expect(indicator.dataset.kind).toBe('translated')
    expect(indicator.dataset.phase).toBe('icon')
    // 翻译中已展开时，完成结果立即替换图标与文字。
    show({ text: '', choices: [], replace: true, pending: true }, message)
    jest.advanceTimersByTime(180)
    now += 180
    expect(indicator.dataset.phase).toBe('expanded')
    show({ text: '', choices: [], replace: true, badge: 'translated' }, message)
    expect(indicator.dataset.kind).toBe('translated')
    expect(indicator.dataset.phase).toBe('expanded')
    for (const [badge, mark] of [
      ['partial', '!'],
      ['untranslated', '×'],
      ['skipped', '−'],
    ] as const) {
      show({ text: '', choices: [], replace: true, badge }, message)
      expect(indicator.dataset.kind).toBe('pending')
      jest.advanceTimersByTime(180)
      expect(indicator.dataset.kind).toBe(badge)
      expect(indicator.dataset.phase).toBe('icon')
      expect(indicator.mark.textContent).toBe(mark)
    }
    expect(document.body.children).toHaveLength(1)
    jest.advanceTimersByTime(180)
    expect(indicator.dataset.phase).toBe('expanded')
    jest.advanceTimersByTime(3819)
    expect(indicator.dataset.phase).toBe('expanded')
    jest.advanceTimersByTime(1)
    expect(indicator.dataset.phase).toBe('icon')
    jest.advanceTimersByTime(180)
    expect(indicator.dataset.phase).toBe('hidden')
    gameMessage._texts = ['次の会話']
    message.update()
    expect(scene.children).toHaveLength(0)
    gameMessage._texts = ['こんにちは']
    message.update()
    expect(scene.children).toHaveLength(0)
    show({ text: '', choices: [], badge: 'untranslated' }, message)
    message.update()
    expect(() => show(null)).not.toThrow()
    expect(() => host.__chayaSubtitleCleanup?.()).not.toThrow()
    expect(scene.children).toHaveLength(0)
    expect(overlay.contents.destroy).toHaveBeenCalled()
  } finally {
    clock.mockRestore()
    jest.useRealTimers()
    host.__chayaSubtitleCleanup?.()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
