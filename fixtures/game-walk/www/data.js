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
        '#..TT############',
        '#....########.###',
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
            {
              ifSwitch: 1,
              then: [
                { speaker: '村长', text: '又见面了！森林入口就在村子东边（右侧中间）。' },
                { speaker: '村长', text: '宝箱里的东西会帮到你的，快去吧。' },
              ],
              else: [
                { speaker: '村长', text: '欢迎来到 Chaya 村，旅行者。' },
                {
                  speaker: '村长',
                  text: '东边的森林里有一个宝箱。你要去看看吗？',
                  choices: ['去森林', '再想想'],
                  branches: [[{ switch: [1, true] }, { speaker: '村长', text: '出口在村子东边（右侧中间）。路上小心！' }], [{ speaker: '村长', text: '想好了再来找我。' }]],
                },
              ],
            },
          ],
        },
        { id: 2, name: '森林入口', x: 16, y: 6, color: '#8fd0ff', touch: { mapId: 2, x: 1, y: 6, d: 6 } },
        { id: 3, name: '村长家门口', x: 13, y: 3, color: '#8fd0ff', touch: { mapId: 3, x: 8, y: 11, d: 8 } },
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
    3: {
      name: '村长的家',
      parentId: 1,
      ground: '#8a6a4a',
      rows: [
        '#################',
        '#################',
        '##.............##',
        '##.............##',
        '##..~~.....~~..##',
        '##.............##',
        '##.............##',
        '##.............##',
        '##.............##',
        '##.............##',
        '##.............##',
        '##.............##',
        '########.########',
      ],
      events: [
        { id: 1, name: '村长夫人', x: 5, y: 6, color: '#e080a0', talk: [{ speaker: '村长夫人', text: '我家老头子又在外面跟人聊天了吧。' }] },
        { id: 2, name: '出门', x: 8, y: 12, color: '#8fd0ff', touch: { mapId: 1, x: 13, y: 4, d: 2 } },
      ],
    },
  }
  /** RPG Maker MapInfos: parentId builds the map tree */
  const MAP_INFOS = [null, ...Object.entries(MAPS).map(([id, map]) => ({ id: Number(id), name: map.name, parentId: map.parentId ?? 0, order: Number(id), expanded: true }))]
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

  // RPG Maker shaped copies of MAPS ($dataMap / data/MapXXX.json) so Chaya's map pages can read them
  const rmCommand = (code, indent, parameters) => ({ code, indent, parameters })
  function rmList(steps, indent = 0) {
    const list = []
    for (const step of steps) {
      if (step.ifSwitch) {
        list.push(rmCommand(111, indent, [0, step.ifSwitch, 0]), ...rmList(step.then ?? [], indent + 1), rmCommand(0, indent + 1, []))
        list.push(rmCommand(411, indent, []), ...rmList(step.else ?? [], indent + 1), rmCommand(0, indent + 1, []))
        list.push(rmCommand(412, indent, []))
      }
      if (step.switch) list.push(rmCommand(121, indent, [step.switch[0], step.switch[0], step.switch[1] ? 0 : 1]))
      if (step.gain) list.push(rmCommand(126, indent, [step.gain.itemId, 0, 0, step.gain.count]))
      if (step.heal) list.push(rmCommand(314, indent, [0, 0]))
      if (step.text) {
        list.push(rmCommand(101, indent, ['', 0, 0, 2, step.speaker || '']))
        list.push(rmCommand(401, indent, [step.text]))
      }
      if (step.choices) {
        list.push(rmCommand(102, indent, [step.choices, -1, 0, 2, 0]))
        step.choices.forEach((choice, i) => {
          list.push(rmCommand(402, indent, [i, choice]))
          list.push(...rmList(step.branches?.[i] ?? [], indent + 1), rmCommand(0, indent + 1, []))
        })
        list.push(rmCommand(404, indent, []))
      }
    }
    return list
  }
  const rmConditions = (switchId) => ({
    actorId: 1,
    actorValid: false,
    itemId: 1,
    itemValid: false,
    selfSwitchCh: 'A',
    selfSwitchValid: false,
    switch1Id: switchId || 1,
    switch1Valid: !!switchId,
    switch2Id: 1,
    switch2Valid: false,
    variableId: 1,
    variableValid: false,
    variableValue: 0,
  })
  const rmImage = { tileId: 0, characterName: '', direction: 2, pattern: 1, characterIndex: 0 }
  const rmPage = (list, { switchId, trigger = 0, priorityType = 1, characterName = '' } = {}) => ({
    conditions: rmConditions(switchId),
    directionFix: false,
    image: { ...rmImage, characterName },
    list: [...list, rmCommand(0, 0, [])],
    moveFrequency: 3,
    moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
    moveSpeed: 3,
    moveType: 0,
    priorityType,
    stepAnime: false,
    through: false,
    trigger,
    walkAnime: true,
  })
  function rmEventPages(ev) {
    if (ev.touch) return [rmPage([rmCommand(201, 0, [0, ev.touch.mapId, ev.touch.x, ev.touch.y, ev.touch.d, 0])], { trigger: 1, priorityType: 0 })]
    if (ev.chest) {
      const opened = 100 + ev.id
      return [
        rmPage(rmList([{ gain: ev.chest }, { switch: [opened, true] }, { text: '打开了宝箱。' }]), { characterName: '!Chest' }),
        rmPage(rmList([{ text: '宝箱是空的。' }]), { switchId: opened, characterName: '!Chest' }),
      ]
    }
    return [rmPage(rmList(ev.talk || []), { characterName: 'People1' })]
  }
  // Tile ids per map character; flags: 0x10 star (no effect), 0x0f blocked in all directions
  const RM_TILE = { '.': 1, '#': 2, T: 3, '~': 4 }
  const rmTileset = { id: 1, name: 'Walk demo', mode: 1, note: '', tilesetNames: [], flags: [0x10, 0x00, 0x0f, 0x0f, 0x0f] }
  function rmMap(mapId) {
    const map = MAPS[mapId]
    if (!map) return null
    const events = [null]
    for (const ev of map.events) events[ev.id] = { id: ev.id, name: ev.name, note: '', x: ev.x, y: ev.y, pages: rmEventPages(ev) }
    const ground = map.rows.flatMap((row) => [...row].map((ch) => RM_TILE[ch] ?? 1))
    const data = [...ground, ...new Array(COLS * ROWS * 5).fill(0)]
    return { displayName: map.name, width: COLS, height: ROWS, tilesetId: 1, events, data }
  }

  /** Steps → a full RM command list (ends with the code 0 terminator) */
  const rmEventList = (steps) => [...rmList(steps), rmCommand(0, 0, [])]

  window.WalkDemo = { TILE, COLS, ROWS, W, H, FRAME_MS, SAVE_KEY, MAPS, MAP_INFOS, KEYS, DIRS, COMMON_EVENTS, MENU, rmMap, rmTileset, rmEventList }
})()
