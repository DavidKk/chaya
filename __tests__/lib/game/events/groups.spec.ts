import {
  buildCommonEventsData,
  type CommonEventFilter,
  type CommonEventsData,
  filterCommonEventGroups,
  groupCommonEvents,
  isSeparatorEvent,
  separatorTitle,
} from '@/lib/game/events'

const cmd = (code: number, parameters: unknown[] = [], indent = 0) => ({ code, indent, parameters })

function data(): CommonEventsData {
  return buildCommonEventsData(
    {
      commonEvents: [
        null,
        { id: 1, name: 'Init', trigger: 0, switchId: 1, list: [cmd(121, [3, 3, 0]), cmd(0)] },
        { id: 2, name: '---- 戦闘 ----', trigger: 0, switchId: 1, list: [cmd(0)] },
        { id: 3, name: '勝利', trigger: 0, switchId: 1, list: [cmd(101, ['', 0, 0, 2]), cmd(401, ['やったね！']), cmd(0)] },
        { id: 4, name: 'Loop', trigger: 2, switchId: 4, list: [cmd(117, [3]), cmd(0)] },
        { id: 5, name: '【ショップ】', trigger: 0, switchId: 1, list: [cmd(0)] },
        { id: 6, name: '', trigger: 0, switchId: 1, list: [cmd(0)] },
        { id: 7, name: '■ Not a separator', trigger: 0, switchId: 1, list: [cmd(355, ['console.log(1)']), cmd(0)] },
      ],
      system: { switches: [], variables: [] },
      items: null,
      weapons: null,
      armors: null,
      actors: null,
      troops: null,
      mapInfos: null,
      maps: null,
    },
    (text) => ({ 'やったね！': '太好了！' })[text] ?? text,
    'disk'
  )
}

const base: CommonEventFilter = { trigger: 'all', query: '', showEmpty: false, onlyUncalled: false }

describe('common event groups', () => {
  it('treats empty, decorated entries as group headings', () => {
    expect(isSeparatorEvent({ rawName: '---- 戦闘 ----', commandCount: 0 })).toBe(true)
    expect(isSeparatorEvent({ rawName: '【ショップ】', commandCount: 0 })).toBe(true)
    expect(isSeparatorEvent({ rawName: '■ Not a separator', commandCount: 1 })).toBe(false)
    expect(isSeparatorEvent({ rawName: '', commandCount: 0 })).toBe(false)
    expect(isSeparatorEvent({ rawName: 'Plain', commandCount: 0 })).toBe(false)
    expect(separatorTitle('---- 戦闘 ----')).toBe('戦闘')
    expect(separatorTitle('【ショップ】')).toBe('ショップ')
  })

  it('splits events by separators, keeping order', () => {
    const groups = groupCommonEvents(data().events)
    expect(groups.map((g) => [g.id, g.title, g.events.map((e) => e.id)])).toEqual([
      [0, '', [1]],
      [2, '戦闘', [3, 4]],
      [5, 'ショップ', [6, 7]],
    ])
  })

  it('filters by trigger, empty events, never-called and content', () => {
    const d = data()
    const ids = (filter: Partial<CommonEventFilter>) => filterCommonEventGroups(d, { ...base, ...filter }).flatMap((g) => g.events.map((e) => e.id))
    expect(ids({})).toEqual([1, 3, 4, 7])
    expect(ids({ showEmpty: true })).toEqual([1, 3, 4, 6, 7])
    expect(ids({ trigger: 2 })).toEqual([4])
    // 3 is called by 4; parallel events are not "uncalled" candidates
    expect(ids({ onlyUncalled: true })).toEqual([1, 7])
    expect(ids({ query: '太好了' })).toEqual([3])
    expect(ids({ query: 'console.log' })).toEqual([7])
    expect(ids({ query: '4' })).toEqual([4])
  })

  it('drops groups whose events are all filtered out', () => {
    const groups = filterCommonEventGroups(data(), { ...base, trigger: 2 })
    expect(groups.map((g) => g.id)).toEqual([2])
  })
})
