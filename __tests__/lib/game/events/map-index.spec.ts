import { buildCommonEventsData, buildMapDetail, estimateActivePage, flattenMapTree, type MapEventPage, type MapNode, type RawEventSources } from '@/lib/game/events'

const cmd = (code: number, parameters: unknown[] = [], indent = 0) => ({ code, indent, parameters })

const page = (conditions: Record<string, unknown>, list = [cmd(0)], extra: Record<string, unknown> = {}) => ({
  conditions,
  list,
  trigger: 0,
  image: { characterName: '', tileId: 0 },
  ...extra,
})

function sources(): RawEventSources {
  return {
    commonEvents: [null, { id: 1, name: 'Warp', trigger: 0, switchId: 1, list: [cmd(201, [0, 2, 4, 5, 8, 0]), cmd(0)] }],
    system: { switches: [], variables: [] },
    items: null,
    weapons: null,
    armors: null,
    actors: null,
    troops: null,
    mapInfos: [null, { id: 1, name: '世界', parentId: 0, order: 2 }, { id: 2, name: '村', parentId: 1, order: 3 }, { id: 3, name: '城', parentId: 0, order: 1 }],
    maps: [
      {
        id: 1,
        data: {
          width: 20,
          height: 15,
          events: [
            null,
            { id: 1, name: '入口', x: 3, y: 4, pages: [page({}, [cmd(201, [0, 2, 4, 5, 8, 0]), cmd(201, [0, 2, 10, 11, 2, 0]), cmd(0)], { trigger: 1 })] },
            { id: 2, name: '宝箱', x: 5, y: 5, pages: [page({}, [cmd(126, [1, 0, 0, 1]), cmd(123, ['A', 0]), cmd(0)], { image: { characterName: '!Chest', tileId: 0 } })] },
            {
              id: 3,
              name: '村人',
              x: 7,
              y: 2,
              pages: [
                page({ variableValid: true, variableId: 9, variableValue: 3 }, [cmd(101, ['Actor1', 0, 0, 2]), cmd(401, ['こんにちは']), cmd(122, [9, 9, 1, 0, 1]), cmd(0)], {
                  image: { characterName: 'People1', tileId: 0 },
                }),
              ],
            },
          ],
        },
      },
      { id: 2, data: { width: 10, height: 10, events: [null] } },
    ],
  }
}

describe('map index', () => {
  it('builds tree nodes, event names and transfer entrances', () => {
    const data = buildCommonEventsData(sources(), (t) => t, 'disk')
    const byId = Object.fromEntries(data.mapIndex.nodes.map((n) => [n.id, n]))
    expect(byId[1]).toMatchObject({ eventCount: 3, eventNames: ['入口', '宝箱', '村人'] })
    expect(byId[2]).toMatchObject({ eventCount: 0 })
    expect(byId[3]).toMatchObject({ eventCount: null })
    const entrances = data.mapIndex.entrances[2]
    expect(entrances.map((e) => [e.x, e.y, e.from.kind])).toEqual([
      [4, 5, 'common'],
      [4, 5, 'map'],
      [10, 11, 'map'],
    ])
    expect(data.variableRefs[9]?.map((r) => [r.kind, r.id, r.eventId])).toEqual([['map', 1, 3]])
  })

  it('flattens the tree depth-first by order', () => {
    const nodes: MapNode[] = [
      { id: 1, name: 'A', rawName: 'A', parentId: 0, order: 2, eventCount: 0, eventNames: [] },
      { id: 2, name: 'B', rawName: 'B', parentId: 1, order: 3, eventCount: 0, eventNames: [] },
      { id: 3, name: 'C', rawName: 'C', parentId: 0, order: 1, eventCount: 0, eventNames: [] },
      { id: 4, name: 'D', rawName: 'D', parentId: 99, order: 4, eventCount: 0, eventNames: [] },
    ]
    expect(flattenMapTree(nodes).map((r) => [r.id, r.depth])).toEqual([
      [3, 0],
      [1, 0],
      [2, 1],
      [4, 0],
    ])
  })

  it('builds a single map detail with inferred types and translated texts', () => {
    const raw = sources()
    const detail = buildMapDetail(1, raw.maps![0].data, raw.mapInfos, (t) => ({ こんにちは: '你好', 世界: '世界地图' })[t] ?? t, 'disk')
    expect(detail).toMatchObject({ mapId: 1, name: '世界地图', width: 20, height: 15 })
    expect(detail.events.map((e) => [e.id, e.type])).toEqual([
      [1, 'transfer'],
      [2, 'chest'],
      [3, 'npc'],
    ])
    expect(detail.events[2].pages[0].conditions).toEqual({ variable: { id: 9, value: 3 } })
    expect(detail.texts).toEqual({ こんにちは: '你好' })
    expect(detail.live).toBeUndefined()
  })
})

describe('estimateActivePage', () => {
  const p = (conditions: MapEventPage['conditions']): MapEventPage => ({ conditions, trigger: 0, list: [], commandCount: 0, characterName: '', tileId: 0 })
  const ctx = { switches: { 1: true }, variables: { 2: 5 }, selfOn: 'A', itemCount: (id: number) => (id === 7 ? 1 : 0) }

  it('picks the last page whose conditions hold', () => {
    expect(estimateActivePage([p({}), p({ switch1: 1 }), p({ switch1: 2 })], ctx)).toEqual({ page: 2, exact: true })
    expect(estimateActivePage([p({ variable: { id: 2, value: 6 } })], ctx)).toEqual({ page: 0, exact: true })
    expect(estimateActivePage([p({}), p({ selfSwitch: 'A' }), p({ selfSwitch: 'B' })], ctx)).toEqual({ page: 2, exact: true })
    expect(estimateActivePage([p({ item: 7 })], ctx)).toEqual({ page: 1, exact: true })
  })

  it('marks actor conditions and unknown self switches as estimated', () => {
    expect(estimateActivePage([p({ actor: 1 })], ctx)).toEqual({ page: 1, exact: false })
    expect(estimateActivePage([p({ selfSwitch: 'C' })], { ...ctx, selfOn: undefined })).toEqual({ page: 1, exact: false })
  })
})
