import { buildCommonEventsData, interpretCommands, isRiskyEffects, type RawEventSources, summarizeEffects } from '@/lib/game/events'

const cmd = (code: number, parameters: unknown[] = [], indent = 0) => ({ code, indent, parameters })

function sources(overrides: Partial<RawEventSources> = {}): RawEventSources {
  return {
    commonEvents: [
      null,
      { id: 1, name: '開始', trigger: 1, switchId: 5, list: [cmd(121, [5, 5, 1]), cmd(0)] },
      { id: 2, name: '', trigger: 0, switchId: 1, list: [cmd(0)] },
      { id: 3, name: '呼び出し', trigger: 0, switchId: 1, list: [cmd(117, [1]), cmd(102, [['はい', 'いいえ']]), cmd(402, [0, 'はい']), cmd(0)] },
    ],
    system: { switches: ['', '', '', '', '', '開始済み'], variables: [] },
    items: null,
    weapons: null,
    armors: null,
    actors: null,
    troops: [null, { id: 1, name: 'スライム', pages: [{ list: [cmd(117, [1]), cmd(0)] }] }],
    mapInfos: [null, { id: 1, name: '村' }],
    maps: [
      {
        id: 1,
        data: {
          events: [
            null,
            {
              id: 7,
              name: '村長',
              pages: [{ conditions: { switch1Valid: true, switch1Id: 5, switch2Valid: false, switch2Id: 9 }, list: [cmd(117, [1]), cmd(111, [0, 5, 0]), cmd(0)] }],
            },
          ],
        },
      },
    ],
    ...overrides,
  }
}

const tr = (text: string) => ({ 開始: '开始', はい: '是', 村: '村庄', 村長: '村长' })[text] ?? text

describe('buildCommonEventsData', () => {
  it('keeps every non-null slot and counts commands without the trailing empty command', () => {
    const data = buildCommonEventsData(sources(), tr, 'disk')
    expect(data.events.map((e) => [e.id, e.name, e.commandCount])).toEqual([
      [1, '开始', 1],
      [2, '', 0],
      [3, '呼び出し', 3],
    ])
  })

  it('collects callers from common events, troops and map event pages', () => {
    const data = buildCommonEventsData(sources(), tr, 'disk')
    expect(data.calledBy[1]).toEqual([
      { kind: 'common', id: 3, name: '呼び出し' },
      { kind: 'troop', id: 1, name: 'スライム', page: 1 },
      { kind: 'map', id: 1, name: '村庄', eventId: 7, eventName: '村长', page: 1 },
    ])
  })

  it('collects switch references once per location', () => {
    const data = buildCommonEventsData(sources(), tr, 'disk')
    expect(data.switchRefs[5]).toEqual([
      { kind: 'common', id: 1, name: '开始' },
      { kind: 'map', id: 1, name: '村庄', eventId: 7, eventName: '村长', page: 1 },
    ])
    expect(data.switchRefs[9]).toBeUndefined()
  })

  it('translates choice texts including 402 branches', () => {
    const data = buildCommonEventsData(sources(), tr, 'disk')
    expect(data.texts).toEqual({ はい: '是' })
  })

  it('reports map scan status and failures', () => {
    expect(buildCommonEventsData(sources({ maps: null }), tr, 'live')).toMatchObject({ mapsScanned: false, mapsFailed: 0 })
    expect(buildCommonEventsData(sources({ mapsFailed: 2 }), tr, 'live')).toMatchObject({ mapsScanned: true, mapsFailed: 2 })
  })
})

describe('summarizeEffects', () => {
  it('flags transfers and battles as risky', () => {
    expect(isRiskyEffects(summarizeEffects([cmd(201, [0, 2, 3, 4])]))).toBe(true)
    expect(isRiskyEffects(summarizeEffects([cmd(301, [0, 1])]))).toBe(true)
    expect(isRiskyEffects(summarizeEffects([cmd(121, [1, 1, 0])]))).toBe(false)
  })
})

describe('interpretCommands', () => {
  it('shows unknown commands with a parameter preview', () => {
    const data = buildCommonEventsData(sources(), tr, 'disk')
    const [line] = interpretCommands([cmd(199, ['x'.repeat(300)])], data.names, data.texts)
    expect(line.key).toBe('other')
    expect(String(line.args?.params).length).toBeLessThanOrEqual(121)
  })

  it('links common event calls', () => {
    const data = buildCommonEventsData(sources(), tr, 'disk')
    const lines = interpretCommands([cmd(117, [1])], data.names, data.texts)
    expect(lines[0].link).toEqual({ kind: 'common', id: 1 })
  })
})
