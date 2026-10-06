import { installEngineHooks } from '@/plugins/src/translator/engine/engine-hooks'

it('keeps dialogue and choices original in subtitle mode while preserving cached playback', () => {
  class BitmapStub {
    drawText(text: string) {
      return text
    }
  }
  class Base {
    convertEscapeCharacters(text: string) {
      return text
    }
    drawText(text: string) {
      return new BitmapStub().drawText(text)
    }
    drawTextEx(text: string) {
      return this.drawText(this.convertEscapeCharacters(text))
    }
    processNormalCharacter(text: string) {
      return new BitmapStub().drawText(text)
    }
  }
  class Message extends Base {}
  class ChoiceList extends Base {}
  class GameMessage {
    texts: string[] = []
    choices: string[] = []
    clear() {
      this.texts = []
      this.choices = []
    }
    add(text: string) {
      this.texts.push(text)
    }
    setChoices(choices: string[]) {
      this.choices = choices
    }
  }
  const globals = { window: {}, Window_Base: Base, Window_Message: Message, Window_ChoiceList: ChoiceList, Bitmap: BitmapStub, Game_Message: GameMessage }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  try {
    let mode: 'realtime' | 'subtitle' | 'pretranslated' = 'subtitle'
    const remove = installEngineHooks(
      (text) => `ZH:${text}`,
      () => mode
    )
    const game = new GameMessage()
    game.add('こんにちは')
    game.setChoices(['はい', 'いいえ'])
    expect(game.texts).toEqual(['こんにちは'])
    expect(game.choices).toEqual(['はい', 'いいえ'])
    expect(new Message().convertEscapeCharacters('こんにちは')).toBe('こんにちは')
    expect(new Message().processNormalCharacter('こ')).toBe('こ')
    expect(new ChoiceList().drawTextEx('はい')).toBe('はい')
    expect(new Base().drawText('メニュー')).toBe('ZH:メニュー')

    mode = 'realtime'
    expect(new Message().convertEscapeCharacters('こんにちは')).toBe('ZH:こんにちは')
    expect(new Message().drawTextEx('こんにちは')).toBe('ZH:こんにちは')
    expect(new Message().drawText('こんにちは')).toBe('ZH:こんにちは')
    expect(new Message().processNormalCharacter('你')).toBe('ZH:你')
    expect(new ChoiceList().drawTextEx('はい')).toBe('はい')
    game.add('次の会話')
    expect(game.texts[1]).toBe('次の会話')

    mode = 'pretranslated'
    game.add('次の会話')
    game.setChoices(['進む'])
    expect(game.texts[2]).toBe('ZH:次の会話')
    expect(game.choices).toEqual(['ZH:進む'])
    expect((game as unknown as Record<symbol, string[]>)[Symbol.for('chaya.originalMessageLines')]).toEqual(['こんにちは', '次の会話', '次の会話'])
    game.clear()
    game.add('新しい台詞')
    expect((game as unknown as Record<symbol, string[]>)[Symbol.for('chaya.originalMessageLines')]).toEqual(['新しい台詞'])
    remove()
    expect(new Base().drawText('メニュー')).toBe('メニュー')
    expect(new BitmapStub().drawText('メニュー')).toBe('メニュー')
    expect(globals.window).not.toHaveProperty('TranslationManager')
    const removeNext = installEngineHooks((text) => `NEW:${text}`)
    expect(new Base().drawText('メニュー')).toBe('NEW:メニュー')
    game.add('次')
    expect(game.texts.at(-1)).toBe('NEW:次')
    removeNext()
  } finally {
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

it('translates direct canvas text without translating Bitmap text twice', () => {
  class CanvasContext {
    fillText(text: string) {
      return text
    }
    strokeText(text: string) {
      return text
    }
    measureText(text: string) {
      return { width: text.length }
    }
  }
  class BitmapStub {
    drawText(text: string) {
      return new CanvasContext().fillText(text)
    }
  }
  class Base {
    convertEscapeCharacters(text: string) {
      return text
    }
    drawText(text: string) {
      return new BitmapStub().drawText(text)
    }
    drawTextEx(text: string) {
      return this.drawText(text)
    }
  }
  const globals = { window: {}, Window_Base: Base, Bitmap: BitmapStub, CanvasRenderingContext2D: CanvasContext }
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  try {
    const translate = jest.fn((text: unknown) => (text === '敵の攻撃' ? '敌人攻击' : text === '長い文言' ? '短' : String(text)))
    const remove = installEngineHooks(translate)
    const canvas = new CanvasContext()
    expect(canvas.fillText('敵の攻撃')).toBe('敌人攻击')
    expect(canvas.strokeText('敵の攻撃')).toBe('敌人攻击')
    expect(canvas.measureText('敵の攻撃').width).toBe(4)
    expect(canvas.measureText('長い文言').width).toBe(1)
    translate.mockClear()
    expect(new BitmapStub().drawText('敵の攻撃')).toBe('敌人攻击')
    expect(translate).toHaveBeenCalledTimes(1)
    translate.mockClear()
    expect(new Base().drawText('敵の攻撃')).toBe('敌人攻击')
    expect(translate).toHaveBeenCalledTimes(1)
    remove()
    expect(canvas.fillText('敵の攻撃')).toBe('敵の攻撃')
  } finally {
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
