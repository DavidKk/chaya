/* Walk demo data: constants, maps, common events and the menu. */
;(function () {
  'use strict'

  const TILE = 48
  const COLS = 17
  const ROWS = 13
  const W = COLS * TILE
  const H = ROWS * TILE
  const FRAME_MS = 1000 / 60
  const SAVE_KEY = 'chaya-walk-demo-save-'

  // # wall · T tree · ~ water · . ground
  const MAPS = {
    1: {
      name: '村庄',
      ground: '#5d8a4a',
      rows: [
        '#################',
        '#...............#',
        '#..TT.......TT..#',
        '#...............#',
        '#...............#',
        '#...............#',
        '#................',
        '#...............#',
        '#..~~~..........#',
        '#..~~~......TT..#',
        '#...............#',
        '#...............#',
        '#################',
      ],
      events: [
        {
          id: 1,
          name: '村长',
          x: 8,
          y: 4,
          color: '#e0a040',
          talk: [
            { speaker: '村长', text: '欢迎来到 Chaya 村，旅行者。' },
            {
              speaker: '村长',
              text: '东边的森林里有一个宝箱。你要去看看吗？',
              choices: ['去森林', '再想想'],
              branches: [[{ switch: [1, true] }, { speaker: '村长', text: '出口在村子东边（右侧中间）。路上小心！' }], [{ speaker: '村长', text: '想好了再来找我。' }]],
            },
          ],
        },
        { id: 2, name: '森林入口', x: 16, y: 6, color: '#8fd0ff', touch: { mapId: 2, x: 1, y: 6, d: 6 } },
      ],
    },
    2: {
      name: '森林',
      ground: '#3f6b3a',
      rows: [
        '#################',
        '#TTTTTTTTTTTTTTT#',
        '#T.............T#',
        '#T..T.....T....T#',
        '#T.............T#',
        '#T.............T#',
        '...............T#',
        '#T...T.........T#',
        '#T.............T#',
        '#T......T......T#',
        '#T.............T#',
        '#TTTTTTTTTTTTTTT#',
        '#################',
      ],
      events: [
        { id: 1, name: '宝箱', x: 11, y: 5, color: '#b0763a', chest: { itemId: 1, count: 1 } },
        { id: 2, name: '村庄出口', x: 0, y: 6, color: '#8fd0ff', touch: { mapId: 1, x: 15, y: 6, d: 4 } },
      ],
    },
  }
  for (const map of Object.values(MAPS)) {
    if (map.rows.length !== ROWS || map.rows.some((row) => row.length !== COLS)) throw new Error(`bad map ${map.name}`)
  }

  const KEYS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'ok',
    ' ': 'ok',
    z: 'ok',
    Z: 'ok',
    Escape: 'escape',
    x: 'escape',
    X: 'escape',
    Shift: 'shift',
  }
  const DIRS = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] }

  const COMMON_EVENTS = { 1: [{ heal: true }, { text: '一阵暖风吹过，HP / MP 全部恢复了。' }] }

  const MENU = [
    { symbol: 'item', name: '物品' },
    { symbol: 'status', name: '状态' },
    { symbol: 'save', name: '存档' },
    { symbol: 'close', name: '关闭' },
  ]

  window.WalkDemo = { TILE, COLS, ROWS, W, H, FRAME_MS, SAVE_KEY, MAPS, KEYS, DIRS, COMMON_EVENTS, MENU }
})()
