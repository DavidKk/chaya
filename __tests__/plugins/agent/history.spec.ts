/** @jest-environment jsdom */
import { plainText, readHistory, resetHistory, startHistory } from '@/plugins/src/agent/history'

type Globals = Record<string, unknown>

const g = globalThis as unknown as Globals
const message = { text: '', speaker: '', list: [] as string[], allText: () => message.text, speakerName: () => message.speaker, choices: () => message.list }

class Window_Message {
  startMessage() {}
}
class Window_ChoiceList {
  start() {}
}
class Game_Message {
  onChoice(_n: number) {}
}
class Game_Map {
  setup(_id: number) {}
  displayName() {
    return '王都'
  }
}

let stop: () => void

beforeEach(() => {
  localStorage.clear()
  resetHistory()
  Object.assign(g, {
    Window_Message,
    Window_ChoiceList,
    Game_Message,
    Game_Map,
    $gameMessage: message,
    $gameMap: new Game_Map(),
    $gameVariables: { value: (n: number) => n * 10 },
    $gameActors: { actor: () => ({ name: () => 'リード' }) },
    $gameSystem: { playtimeText: () => '00:01:02' },
    BattleManager: { setup() {}, processVictory() {} },
    DataManager: { loadGame: () => Promise.resolve(true) },
  })
  stop = startHistory()
})

afterEach(() => {
  stop()
  for (const key of [
    'Window_Message',
    'Window_ChoiceList',
    'Game_Message',
    'Game_Map',
    '$gameMessage',
    '$gameMap',
    '$gameVariables',
    '$gameActors',
    '$gameSystem',
    'BattleManager',
    'DataManager',
    'ChayaTrans',
  ])
    delete g[key]
})

const say = (text: string, speaker = '') => {
  Object.assign(message, { text, speaker })
  new Window_Message().startMessage()
}

describe('agent story history', () => {
  it('expands variables and names, then strips control codes', () => {
    expect(plainText('\\C[2]\\N[1]は\\V[3]Gを\\{手に入れた\\}！\\.')).toBe('リードは30Gを手に入れた！')
  })

  it('records dialogue, choices, the pick and map changes in order, merging repeats', () => {
    say('こんにちは', 'リード')
    say('こんにちは', 'リード')
    message.list = ['はい', 'いいえ']
    new Window_ChoiceList().start()
    new Game_Message().onChoice(1)
    new Game_Map().setup(5)
    const { entries, lastSeq, dropped } = readHistory({})
    expect(entries.map((e) => e.kind)).toEqual(['message', 'choices', 'choice', 'map'])
    expect(entries[0]).toMatchObject({ speaker: 'リード', text: 'こんにちは', repeat: 2, playtime: '00:01:02' })
    expect(entries[1].choices).toEqual(['はい', 'いいえ'])
    expect(entries[2]).toMatchObject({ index: 1, text: 'いいえ' })
    expect(entries[3]).toMatchObject({ mapId: 5, mapName: '王都' })
    expect(lastSeq).toBe(5)
    expect(dropped).toBe(0)
  })

  it('filters by kind, limit and afterSeq', () => {
    say('一')
    say('二')
    new Game_Map().setup(2)
    say('三')
    expect(readHistory({ kinds: ['message'] }).entries.map((e) => e.text)).toEqual(['一', '二', '三'])
    expect(readHistory({ limit: 1 }).entries.map((e) => e.text)).toEqual(['三'])
    expect(readHistory({ afterSeq: 2 }).entries.map((e) => e.kind)).toEqual(['map', 'message'])
  })

  it('exposes a repeated line through the incremental cursor', () => {
    say('再见')
    const start = readHistory({}).lastSeq
    say('再见')
    expect(readHistory({ afterSeq: start })).toMatchObject({ lastSeq: start + 1, entries: [{ text: '再见', repeat: 2, seq: start + 1 }] })
  })

  it('attaches cached translations at read time', () => {
    g.ChayaTrans = { translate: (text: string) => ({ こんにちは: '你好', はい: '是' })[text] ?? text }
    say('こんにちは')
    message.list = ['はい', 'いいえ']
    new Window_ChoiceList().start()
    const [line, choices] = readHistory({}).entries
    expect(line).toMatchObject({ text: 'こんにちは', translated: '你好' })
    expect(choices).toMatchObject({ choices: ['はい', 'いいえ'], translatedChoices: ['是', 'いいえ'] })
  })

  it('records loads after the save resolves and persists on stop', async () => {
    await (g.DataManager as { loadGame: (slot: number) => Promise<unknown> }).loadGame(3)
    await Promise.resolve()
    expect(readHistory({}).entries.at(-1)).toMatchObject({ kind: 'load', slot: 3 })
    stop()
    stop = () => {}
    const saved = Object.keys(localStorage).find((key) => key.startsWith('chaya.agent.history:'))
    expect(saved && JSON.parse(localStorage.getItem(saved)!).entries).toHaveLength(1)
  })
})
