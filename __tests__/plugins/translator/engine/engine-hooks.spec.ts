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
