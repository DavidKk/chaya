import { readSceneWindows } from '@/plugins/src/agent/window-state'

describe('readSceneWindows', () => {
  it('exposes equip slot labels and empty/current items as options', () => {
    const actor = {
      equips: () => [null, { id: 60, name: 'Hat0' }],
      equipSlots: () => [1, 2],
    }
    const slotWindow = {
      visible: true,
      openness: 255,
      active: true,
      _index: 0,
      _actor: actor,
      maxItems: () => 2,
      maxCols: () => 1,
      index: () => 0,
      slotName: (index: number) => (index === 0 ? '武器' : '头盔'),
      item: () => null,
    }
    const windows = readSceneWindows({ _slotWindow: slotWindow }, (value) => value)
    expect(windows).toEqual([
      expect.objectContaining({
        name: 'slotWindow',
        active: true,
        index: 0,
        options: [
          { label: '武器: <空>', symbol: 'slot:0', enabled: true, index: 0, itemId: null, item: null },
          {
            label: '头盔: Hat0',
            symbol: 'slot:1',
            enabled: true,
            index: 1,
            itemId: 60,
            item: { id: 60, name: 'Hat0' },
          },
        ],
      }),
    ])
  })

  it('exposes item-list _data rows for choosing a bag weapon', () => {
    const itemWindow = {
      visible: true,
      openness: 255,
      active: true,
      _index: 1,
      _data: [null, { id: 5, name: 'Thief dagger' }],
      maxCols: () => 1,
      index: () => 1,
      item: () => ({ id: 5, name: 'Thief dagger' }),
    }
    const windows = readSceneWindows({ itemWindow }, (value) => value)
    expect(windows[0]).toMatchObject({
      name: 'itemWindow',
      active: true,
      index: 1,
      options: [
        { label: '<空>', index: 0, itemId: null },
        { label: 'Thief dagger', index: 1, itemId: 5 },
      ],
    })
  })

  it('keeps command-window _list options', () => {
    const commandWindow = {
      visible: true,
      openness: 255,
      active: false,
      _index: 0,
      _list: [
        { label: '装备', symbol: 'equip', enabled: true },
        { label: '清除', symbol: 'clear', enabled: true },
      ],
      maxCols: () => 1,
      index: () => 0,
      currentSymbol: () => 'equip',
    }
    const windows = readSceneWindows({ commandWindow }, (value) => value)
    expect(windows[0].options).toEqual([
      { label: '装备', symbol: 'equip', enabled: true, index: 0 },
      { label: '清除', symbol: 'clear', enabled: true, index: 1 },
    ])
  })
})
