import { DEFAULT_PLAY_SETTINGS } from '@/lib/translate/play-settings'
import { createDialogueSubtitles, installDialogueSubtitles } from '@/plugins/src/translator/engine/dialogue-subtitles'

describe('non-blocking dialogue subtitles', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  function setup() {
    const settings = { ...DEFAULT_PLAY_SETTINGS, mode: 'subtitle' as 'subtitle' | 'realtime' | 'pretranslated' }
    const request = jest.fn<Promise<Array<{ src: string; zh: string | null }>>, [string[], AbortSignal]>()
    const status = jest.fn()
    const show = jest.fn()
    const cached = jest.fn((text: string) => text)
    return { request, cached, settings, status, show, subtitles: createDialogueSubtitles({ settings: () => settings, request, cached, show, status }) }
  }

  it('starts inference immediately without mutating the visible original, then displays a subtitle', async () => {
    const { subtitles, request, show } = setup()
    const message = { _texts: ['こんにちは', '村へ行こう'], _choices: ['行くif(s[1])', '行かない'] }
    request.mockImplementation(async (texts) =>
      texts.map((src) => ({ src, zh: ({ 行かない: '不去', こんにちは: '你好', 村へ行こう: '去村子吧', '行くif(s[1])': '去if(s[1])' } as Record<string, string>)[src] }))
    )
    subtitles.begin(message)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toEqual(['こんにちは', '村へ行こう'])
    expect(message._texts).toEqual(['こんにちは', '村へ行こう'])
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '你好\n去村子吧', choices: ['', ''], pending: true }, undefined)
    expect(request.mock.calls[1][0]).toEqual(['行くif(s[1])', '行かない'])
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '你好\n去村子吧', choices: ['去', '不去'], badge: 'translated' }, undefined)
    expect(message._texts).toEqual(['こんにちは', '村へ行こう'])
  })

  it('replaces only the still-visible text when realtime inference resolves', async () => {
    const { subtitles, settings, request, show } = setup()
    settings.mode = 'realtime'
    let finish!: (items: Array<{ src: string; zh: string }>) => void
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const message = { _texts: ['こんにちは'], _choices: [] }
    subtitles.begin(message)
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], replace: true, pending: true }, undefined)
    expect(message._texts).toEqual(['こんにちは'])
    finish([{ src: 'こんにちは', zh: '你好' }])
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '你好', choices: [], replace: true, badge: 'translated' }, undefined)
    subtitles.reset()
    message._texts = ['次へ']
    subtitles.begin(message)
    expect(show).not.toHaveBeenLastCalledWith({ text: '你好', choices: [], replace: true, badge: 'translated' }, undefined)
  })

  it('reports an engine failure when no translation was produced', async () => {
    const { subtitles, request, status, show } = setup()
    request.mockResolvedValue([{ src: 'こんにちは', zh: null, error: 'Ollama 未启动' }])
    subtitles.begin({ _texts: ['こんにちは'] })
    await Promise.resolve()
    expect(status).toHaveBeenLastCalledWith(false, 'Ollama 未启动')
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], badge: 'untranslated' }, undefined)
  })

  it('uses the saved translation on the second showing without retaining the previous overlay', async () => {
    const { subtitles, request, cached, show, settings } = setup()
    settings.mode = 'realtime'
    const library = new Map<string, string>()
    cached.mockImplementation((text) => library.get(text) || text)
    request.mockImplementation(async (texts) => {
      library.set(texts[0], '你好')
      return [{ src: texts[0], zh: '你好' }]
    })
    const message = { _texts: ['こんにちは'] }
    subtitles.begin(message)
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '你好', choices: [], replace: true, badge: 'translated' }, undefined)

    subtitles.reset()
    message._texts = ['次の会話']
    subtitles.begin(message)
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], replace: true, pending: true }, undefined)
    subtitles.reset()
    message._texts = ['こんにちは']
    subtitles.begin(message)
    expect(request).toHaveBeenCalledTimes(2)
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], replace: true, badge: 'cached' }, undefined)
  })

  it('reuses translated dialogue lines and only requests missing lines', async () => {
    const { subtitles, cached, request, show } = setup()
    cached.mockImplementation((text) => (text === 'こんにちは' ? '你好' : text === '行く' ? '去' : text))
    request.mockImplementation(async (texts) => texts.map((src) => ({ src, zh: src === '村へ行こう' ? '去村子吧' : null })))
    subtitles.begin({ _texts: ['こんにちは', '村へ行こう'], _choices: ['行く', '待つ'] })
    expect(show).toHaveBeenLastCalledWith({ text: '你好\n村へ行こう', choices: ['去', ''], pending: true }, undefined)
    expect(request.mock.calls[0][0]).toEqual(['村へ行こう'])
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '你好\n去村子吧', choices: ['去', ''], pending: true }, undefined)
    expect(request.mock.calls[1][0]).toEqual(['待つ'])
  })

  it('uses cached realtime text in the original window and overlays only async misses', async () => {
    const { subtitles, settings, cached, request, show } = setup()
    settings.mode = 'realtime'
    cached.mockImplementation((text) => (text === 'こんにちは' ? '你好' : text))
    request.mockImplementation(async (texts) => texts.map((src) => ({ src, zh: '去村子吧' })))
    subtitles.begin({ _texts: ['こんにちは'], _choices: [] })
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: '你好' }), undefined)
    expect(request).not.toHaveBeenCalled()

    subtitles.begin({ _texts: ['こんにちは', '村へ行こう'], _choices: [] })
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: '你好\n村へ行こう' }), undefined)
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '你好\n去村子吧', choices: [], replace: true, badge: 'translated' }, undefined)
  })

  it('renders cached choices in place and updates missing choices after inference', async () => {
    const { settings, cached, request, show, status } = setup()
    settings.mode = 'realtime'
    cached.mockImplementation((text) => (text === '進む' ? '前进' : text))
    request.mockImplementation(async (texts) => texts.map((src) => ({ src, zh: '返回' })))
    const message = { _texts: [] as string[], _choices: ['進む', '戻る'], isChoice: () => true }
    class MessageWindow {
      startMessage() {}
      startInput() {}
      forceClear() {}
    }
    class ChoiceWindow {
      commandName(index: number) {
        return message._choices[index]
      }
    }
    const host: { __chayaDialogueCleanup?: () => void } = {}
    const globals = { window: host, Window_Message: MessageWindow, Window_ChoiceList: ChoiceWindow, Game_Message: { prototype: { clear() {} } }, $gameMessage: message }
    const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    Object.assign(globalThis, globals)
    try {
      installDialogueSubtitles({ settings: () => settings, cached, request, show, status })
      const choices = new ChoiceWindow()
      expect(choices.commandName(0)).toBe('前进')
      expect(choices.commandName(1)).toBe('戻る')
      new MessageWindow().startInput()
      await Promise.resolve()
      expect(choices.commandName(0)).toBe('前进')
      expect(choices.commandName(1)).toBe('返回')
      expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: '前进' }), expect.anything())
    } finally {
      host.__chayaDialogueCleanup?.()
      for (const key of Object.keys(globals)) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })

  it('uses a complete stored multi-line translation without inference', () => {
    const { subtitles, cached, request, show } = setup()
    cached.mockImplementation((text) => (text === 'こんにちは\n村へ行こう' ? '你好\n去村子吧' : text))
    subtitles.begin({ _texts: ['こんにちは', '村へ行こう'] })
    expect(show).toHaveBeenLastCalledWith({ text: '你好\n去村子吧', choices: [], badge: 'cached' }, undefined)
    expect(request).not.toHaveBeenCalled()
  })

  it('prefers a complete multi-line translation over partial individual line hits', () => {
    const { subtitles, cached, request, show } = setup()
    cached.mockImplementation((text) => ({ 'こんにちは\n村へ行こう': '您好\n一起前往村庄', こんにちは: '你好' })[text] || text)
    subtitles.begin({ _texts: ['こんにちは', '村へ行こう'] })
    expect(show).toHaveBeenLastCalledWith({ text: '您好\n一起前往村庄', choices: [], badge: 'cached' }, undefined)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not treat a partially translated multi-line lookup as a complete hit', async () => {
    const { subtitles, settings, cached, request, show } = setup()
    settings.mode = 'realtime'
    cached.mockImplementation((text) => (text === 'こんにちは\n村へ行こう' ? '你好\n村へ行こう' : text === 'こんにちは' ? '你好' : text))
    request.mockResolvedValue([{ src: '村へ行こう', zh: '去村子吧' }])
    subtitles.begin({ _texts: ['こんにちは', '村へ行こう'], _choices: [] })
    expect(request).toHaveBeenCalledWith(['村へ行こう'], expect.any(AbortSignal))
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], replace: true, pending: true }, undefined)
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '你好\n去村子吧', choices: [], replace: true, badge: 'translated' }, undefined)
  })

  it('retries an old lookup that kept an untranslated Japanese kanji phrase', async () => {
    const { subtitles, settings, cached, request, show } = setup()
    settings.mode = 'realtime'
    cached.mockImplementation((text) => (text === '応接室へ行く' ? '去応接室' : text))
    request.mockResolvedValue([{ src: '応接室へ行く', zh: '去会客室' }])
    subtitles.begin({ _texts: ['応接室へ行く'], _choices: [], isChoiceHelp: () => true })
    expect(request).toHaveBeenCalledWith(['応接室へ行く'], expect.any(AbortSignal))
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], replace: true, choiceHelp: true, pending: true }, undefined)
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '去会客室', choices: [], replace: true, choiceHelp: true, badge: 'translated' }, undefined)
  })

  it('cancels the previous request on a fast skip and ignores its late response', async () => {
    const { subtitles, request, show } = setup()
    const finish: Array<(items: Array<{ src: string; zh: string }>) => void> = []
    request.mockImplementation(() => new Promise((resolve) => finish.push(resolve)))
    const message = { _texts: ['一つ目'], _choices: [] }
    subtitles.begin(message)
    const oldSignal = request.mock.calls[0][1]
    subtitles.reset()
    message._texts = ['二つ目']
    subtitles.begin(message)
    expect(oldSignal.aborted).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    finish[0]([{ src: '一つ目', zh: '旧字幕' }])
    await Promise.resolve()
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: '旧字幕' }), undefined)
    finish[1]([{ src: '二つ目', zh: '新字幕' }])
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '新字幕', choices: [], badge: 'translated' }, undefined)
  })

  it('shows cached subtitles immediately and never calls the model in pretranslated mode', () => {
    const { subtitles, settings, request, cached, show } = setup()
    cached.mockReturnValue('你好')
    subtitles.begin({ _texts: ['こんにちは'] })
    expect(show).toHaveBeenLastCalledWith({ text: '你好', choices: [], badge: 'cached' }, undefined)
    expect(request).not.toHaveBeenCalled()
    Object.assign(settings, { mode: 'pretranslated' })
    subtitles.begin({ _texts: ['村へ行こう'] })
    expect(show).toHaveBeenLastCalledWith(null)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not send large passages or oversized choice sets to the model', () => {
    const { subtitles, request } = setup()
    subtitles.begin({ _texts: ['あ'.repeat(361)], _choices: [] })
    subtitles.begin({ _texts: [], _choices: Array(8).fill('はい') })
    expect(request).not.toHaveBeenCalled()
  })

  it('translates only the hovered choice help and cancels stale help when the selection moves', async () => {
    const { subtitles, request, show } = setup()
    const finish: Array<(items: Array<{ src: string; zh: string }>) => void> = []
    request.mockImplementation(() => new Promise((resolve) => finish.push(resolve)))
    const message = { _texts: ['街へ出かける'], _choices: Array(12).fill('選択肢'), isChoiceHelp: () => true }
    subtitles.begin(message)
    expect(request.mock.calls[0][0]).toEqual(['街へ出かける'])
    message._texts = ['村へ戻る']
    subtitles.begin(message)
    expect(request.mock.calls[0][1].aborted).toBe(true)
    finish[0]([{ src: '街へ出かける', zh: '到街上去' }])
    await Promise.resolve()
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: '到街上去' }), undefined)
    finish[1]([{ src: '村へ戻る', zh: '返回村庄' }])
    await Promise.resolve()
    expect(show).toHaveBeenLastCalledWith({ text: '返回村庄', choices: [], choiceHelp: true, badge: 'translated' }, undefined)
  })

  it('looks up the original choice help again when returning to a translated option', async () => {
    const { subtitles, settings, cached, request, show } = setup()
    settings.mode = 'realtime'
    const original = '翌朝9:00まで睡眠をとる'
    const detail = '・1時間あたりの睡眠で\\c[18]スタミナ10回復\\c[0]します。'
    const library = new Map([
      [original, '一觉睡到第二天早上9:00'],
      [detail, '・每个小时的睡眠都会恢复\\c[18]10耐力\\c[0]。'],
    ])
    cached.mockImplementation((text) => library.get(text) || text)
    request.mockResolvedValue([{ src: '別の選択肢', zh: '另一个选项' }])
    const message = { _texts: [original, '', detail], _choices: ['選ぶ'], isChoiceHelp: () => true }

    subtitles.begin(message)
    expect(request).not.toHaveBeenCalled()
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], replace: true, choiceHelp: true, badge: 'cached' }, undefined)

    message._texts = ['別の選択肢']
    subtitles.begin(message)
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)

    message._texts = [original, '', detail]
    subtitles.begin(message)
    expect(cached).toHaveBeenCalledWith(original)
    expect(request).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], replace: true, choiceHelp: true, badge: 'cached' }, undefined)
    expect(message._texts).toEqual([original, '', detail])
  })

  it('aborts at the time limit while leaving the original visible', async () => {
    const { subtitles, request, show } = setup()
    let finish!: (items: Array<{ src: string; zh: string }>) => void
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const message = { _texts: ['こんにちは'], _choices: [] }
    subtitles.begin(message)
    await jest.advanceTimersByTimeAsync(8_000)
    expect(request.mock.calls[0][1].aborted).toBe(true)
    finish([{ src: 'こんにちは', zh: '你好' }])
    await Promise.resolve()
    expect(show).not.toHaveBeenCalledWith(expect.objectContaining({ text: '你好' }), undefined)
    expect(message._texts).toEqual(['こんにちは'])
    expect(show).toHaveBeenLastCalledWith({ text: '', choices: [], badge: 'untranslated' }, undefined)
  })

  it('keeps the engine start methods synchronous, including choices-only events', () => {
    const { settings, cached, request, show, status } = setup()
    request.mockImplementation(() => new Promise(() => {}))
    const message = { _texts: ['こんにちは'], _choices: ['進む'], isChoice: () => true }
    const originalMessage = jest.fn(() => 'shown')
    const originalInput = jest.fn(() => true)
    const originalClear = jest.fn()
    const originalForceClear = jest.fn(() => 'closed')
    const proto = { startMessage: originalMessage, startInput: originalInput, forceClear: originalForceClear }
    const host: { __chayaDialogueCleanup?: () => void } = {}
    const globals = { window: host, Window_Message: { prototype: proto }, Game_Message: { prototype: { clear: originalClear } }, $gameMessage: message }
    const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    Object.assign(globalThis, globals)
    try {
      installDialogueSubtitles({ settings: () => settings, cached, request, show, status })
      expect(proto.startMessage()).toBe('shown')
      expect(originalMessage).toHaveBeenCalledTimes(1)
      expect(request).toHaveBeenCalledTimes(1)
      expect(proto.startInput()).toBe(true)
      expect(originalInput).toHaveBeenCalledTimes(1)
      expect(request).toHaveBeenCalledTimes(1)
      globals.Game_Message.prototype.clear()
      expect(request.mock.calls[0][1].aborted).toBe(true)
      message._texts = []
      expect(proto.startInput()).toBe(true)
      expect(request).toHaveBeenCalledTimes(2)
      expect(proto.forceClear()).toBe('closed')
      expect(request.mock.calls[1][1].aborted).toBe(true)
      expect(show).toHaveBeenLastCalledWith(null)
    } finally {
      host.__chayaDialogueCleanup?.()
      for (const key of Object.keys(globals)) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })
})

it('preserves later MPP_ChoiceEX initialization across repeated hot replacement', () => {
  class GameMessage {
    _texts: string[] = []
    _choices: string[] = []
    _helpTexts!: string[]
    constructor() {
      this.clear()
    }
    clear() {
      this._texts = []
      this._choices = []
    }
    isChoice() {
      return false
    }
    isChoiceHelp() {
      return this._helpTexts.length > 0
    }
  }
  class MessageWindow {
    startMessage() {
      return 'shown'
    }
    startInput() {
      return false
    }
  }
  const host: { __chayaDialogueCleanup?: () => void } = {}
  const globals = { window: host, Game_Message: GameMessage, Window_Message: MessageWindow, $gameMessage: new GameMessage() }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  const settings = () => ({ ...DEFAULT_PLAY_SETTINGS, mode: 'realtime' as const })
  const show = jest.fn()
  const options = { settings, show, cached: (text: string) => text, request: jest.fn(async () => []), status: jest.fn() }
  try {
    installDialogueSubtitles(options)
    // Same load order as the game: ChayaLoader first, MPP_ChoiceEX later.
    const previousClear = GameMessage.prototype.clear
    GameMessage.prototype.clear = function () {
      previousClear.call(this)
      this._helpTexts = []
    }
    const mppClear = GameMessage.prototype.clear
    for (let i = 0; i < 3; i++) {
      host.__chayaDialogueCleanup?.()
      expect(GameMessage.prototype.clear).toBe(mppClear)
      installDialogueSubtitles(options)
      const fresh = new GameMessage()
      expect(() => fresh.isChoiceHelp()).not.toThrow()
      expect(fresh.isChoiceHelp()).toBe(false)
      show.mockClear()
      fresh.clear()
      expect(show).toHaveBeenCalledTimes(1)
    }
  } finally {
    host.__chayaDialogueCleanup?.()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
