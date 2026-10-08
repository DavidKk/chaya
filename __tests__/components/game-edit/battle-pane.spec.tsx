/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { BattlePane } from '@/components/game-edit/battle/BattlePane'
import type { EventsSlot } from '@/components/game-edit/events/types'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import type { BattleState } from '@/lib/game/battle'
import { buildCommonEventsData } from '@/lib/game/events'

const data = buildCommonEventsData(
  {
    commonEvents: null,
    system: null,
    items: null,
    weapons: null,
    armors: null,
    actors: [null, { name: 'Harold' }, { name: 'Therese' }, { name: 'Marsha' }],
    enemies: [null, { name: 'Slime' }, { name: 'Bat' }],
    troops: [null, { name: 'Slime*2', members: [{ enemyId: 1 }, { enemyId: 1 }], pages: [] }],
    mapInfos: null,
    maps: null,
  },
  (t) => t,
  'live'
)

const battle: BattleState = {
  ended: false,
  settling: false,
  enemies: [
    { index: 0, enemyId: 1, name: 'Slime A', hp: 40, mhp: 100, mhpCap: 999999, alive: true, appeared: true },
    { index: 1, enemyId: 1, name: 'Slime B', hp: 0, mhp: 100, mhpCap: 999999, alive: false, appeared: true },
  ],
  party: [
    { actorId: 1, name: 'Harold', hp: 210, mhp: 320, mp: 40, mmp: 60, mhpCap: 9999, mmpCap: 9999, tp: 12, maxTp: 100, alive: true },
    { actorId: 2, name: 'Therese', hp: 0, mhp: 280, mp: 30, mmp: 90, mhpCap: 9999, mmpCap: 9999, tp: 0, maxTp: 100, alive: false },
  ],
  partyIds: [1, 2],
  partyMax: 4,
}

function slot(over: Partial<EventsSlot> = {}): EventsSlot {
  return {
    data,
    loading: false,
    error: '',
    live: true,
    canAct: true,
    onMap: false,
    commonId: null,
    onSelectCommon: jest.fn(),
    onAct: jest.fn().mockResolvedValue(undefined),
    onSwitchChange: jest.fn(),
    onVarChange: jest.fn(),
    afterRun: jest.fn(),
    mapId: null,
    eventId: null,
    onSelectMap: jest.fn(),
    eventPage: null,
    onSelectEventPage: jest.fn(),
    mapDetail: null,
    mapLoading: false,
    mapError: '',
    player: null,
    recentMaps: [],
    troopId: null,
    onSelectTroop: jest.fn(),
    battle,
    ...over,
  }
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  })
})

let root: Root | null = null
const handlers = { onRunAction: jest.fn(), onOpenTroops: jest.fn(), onOpenActor: jest.fn() }

async function render(s: EventsSlot | undefined, session: { locks: Record<string, unknown>; god: boolean } = { locks: {}, god: false }) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <BattlePane slot={s} session={session as never} {...handlers} />
        </NotificationProvider>
      </LocaleProvider>
    )
  )
}

afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  root = null
  jest.clearAllMocks()
})

const rowButton = (name: string, action: string) =>
  [...document.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(name))!.querySelector(`button[aria-label*="${action}"]`) as HTMLButtonElement | null
const input = (label: string) => document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
const flowButton = (label: string) => document.querySelector(`[role="group"] button[aria-label="${label}"]`) as HTMLButtonElement
const buttonByText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement

async function edit(label: string, value: string, key: string) {
  const el = input(label)
  await act(async () => el.focus())
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

test('outside battle: empty state links to the troop page', async () => {
  await render(slot({ battle: null }))
  expect(document.body.textContent).toContain('当前不在战斗中')
  await act(async () => buttonByText('去敌群开战').click())
  expect(handlers.onOpenTroops).toHaveBeenCalled()
})

test('battle flow and side-wide actions use the run actions', async () => {
  await render(slot())
  await act(async () => flowButton('战斗胜利').click())
  expect(handlers.onRunAction).toHaveBeenCalledWith('battle:victory')
  await act(async () => buttonByText('HP:1').click())
  expect(handlers.onRunAction).toHaveBeenCalledWith('battle:enemyHp1')
  await act(async () => buttonByText('恢复').click())
  expect(handlers.onRunAction).toHaveBeenCalledWith('battle:partyHeal')

  await act(async () => root!.unmount())
  await render(slot({ battle: { ...battle, ended: true, settling: true } }))
  expect(flowButton('战斗胜利').disabled).toBe(true)
  expect(flowButton('结算胜负').disabled).toBe(true)

  await act(async () => root!.unmount())
  await render(slot({ battle: { ...battle, ended: true } }))
  expect(flowButton('战斗胜利').disabled).toBe(false)
  expect(flowButton('结算胜负').getAttribute('data-variant')).toBe('accent')
  expect(input('当前 HP Slime A').disabled).toBe(true)
  await act(async () => flowButton('结算胜负').click())
  expect(handlers.onRunAction).toHaveBeenCalledWith('battle:settle')

  await act(async () => root!.unmount())
  const head = document.createElement('div')
  document.body.append(head)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <BattlePane slot={slot()} session={{ locks: {}, god: false } as never} {...handlers} headSlot={head} />
        </NotificationProvider>
      </LocaleProvider>
    )
  )
  expect(head.querySelector('button[aria-label="战斗逃跑"]')).not.toBeNull()
  expect(host.querySelector('button[aria-label="战斗逃跑"]')).toBeNull()
})

test('enemies: replace through the picker, kill / revive / copy, HP inputs', async () => {
  const s = slot()
  await render(s)
  expect(input('当前 HP Slime A').value).toBe('40')
  expect(input('HP 上限 Slime A').value).toBe('100')
  expect(input('当前 HP Slime B').disabled).toBe(true)
  expect(rowButton('Slime B', '替换')!.disabled).toBe(true)
  await act(async () => rowButton('Slime A', '替换')!.click())
  expect(document.body.textContent).toContain('变身后 HP / MP 回满')
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('#2') && b.textContent.includes('Bat'))!.click())
  expect(s.onAct).toHaveBeenCalledWith({ op: 'enemyTransform', index: 0, fromEnemyId: 1, enemyId: 2 })

  expect(rowButton('Slime B', '杀死')).toBeNull()
  await act(async () => rowButton('Slime B', '复活')!.click())
  expect(s.onAct).toHaveBeenCalledWith({ op: 'enemyRevive', index: 1, fromEnemyId: 1 })
  await act(async () => rowButton('Slime A', '杀死')!.click())
  expect(s.onAct).toHaveBeenCalledWith({ op: 'enemyKill', index: 0, fromEnemyId: 1 })
  await act(async () => rowButton('Slime B', '回满')!.click())
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'enemyRecover', index: 1, fromEnemyId: 1 })
  expect(document.body.textContent).toContain('「Slime B」已回满')
  await act(async () => rowButton('Slime A', '复制')!.click())
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'enemyAdd', enemyId: 1 })

  await edit('当前 HP Slime A', '70', 'Escape')
  expect(s.onAct).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'enemyHp' }))
  await edit('当前 HP Slime A', '70', 'Enter')
  expect(s.onAct).toHaveBeenCalledWith({ op: 'enemyHp', index: 0, fromEnemyId: 1, hp: 70 })
  await edit('HP 上限 Slime A', '500', 'Enter')
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'enemyMhp', index: 0, fromEnemyId: 1, mhp: 500 })
})

test('enemies: add is disabled when the field is full; replace waits for enemy names', async () => {
  const full: BattleState = { ...battle, enemies: Array.from({ length: 8 }, (_, i) => ({ ...battle.enemies[0]!, index: i, name: `Slime ${i}` })) }
  await render(slot({ battle: full }))
  expect((document.querySelector('button[aria-label="追加敌人"]') as HTMLButtonElement).disabled).toBe(true)
  expect(rowButton('Slime 0', '复制')!.disabled).toBe(true)

  await act(async () => root!.unmount())
  await render(slot({ data: null }))
  expect(rowButton('Slime A', '替换')!.disabled).toBe(true)
})

test('party: HP / MP / TP edits, knock out, revive, full heal, open in Actors', async () => {
  const s = slot()
  await render(s)
  expect(input('当前 MP Harold').value).toBe('40')
  expect(input('TP Harold').value).toBe('12')
  expect(input('当前 HP Therese').disabled).toBe(true)

  await edit('当前 HP Harold', '100', 'Enter')
  expect(s.onAct).toHaveBeenCalledWith({ op: 'actorVital', actorId: 1, key: 'hp', value: 100 })
  await edit('MP 上限 Harold', '80', 'Enter')
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorVital', actorId: 1, key: 'mmp', value: 80 })
  await edit('TP Harold', '50', 'Enter')
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorVital', actorId: 1, key: 'tp', value: 50 })

  await act(async () => rowButton('Harold', '倒下')!.click())
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorVital', actorId: 1, key: 'hp', value: 0 })
  await act(async () => rowButton('Therese', '复活')!.click())
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorRevive', actorId: 2 })
  expect(document.body.textContent).toContain('已复活「Therese」')
  await act(async () => rowButton('Therese', '回满')!.click())
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorRecover', actorId: 2 })

  await act(async () => (document.querySelector('button[aria-label="在角色页打开 Harold"]') as HTMLButtonElement).click())
  expect(handlers.onOpenActor).toHaveBeenCalledWith(1)
})

test('party: add an ally from actors not in the party; disabled when the battle party is full', async () => {
  const s = slot()
  await render(s)
  await act(async () => (document.querySelector('button[aria-label="追加队友"]') as HTMLButtonElement).click())
  expect(document.querySelector('input[aria-label="搜索角色名称或编号"]')).toBeTruthy()
  const options = [...document.querySelectorAll('li button')].map((b) => b.textContent)
  expect(options).toEqual(['#3Marsha'])
  await act(async () => (document.querySelector('li button') as HTMLButtonElement).click())
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorJoin', actorId: 3 })
  expect(document.body.textContent).toContain('「Marsha」已加入队伍')

  await act(async () => root!.unmount())
  await render(slot({ battle: { ...battle, partyMax: 2 } }))
  expect((document.querySelector('button[aria-label="追加队友"]') as HTMLButtonElement).disabled).toBe(true)
})

test('current values slide and apply on release; the max part does not open the slider', async () => {
  const s = slot()
  await render(s)
  await act(async () => input('MP 上限 Harold').focus())
  expect(document.querySelector('input[aria-label="当前 MP Harold 滑块"]')).toBeNull()

  await act(async () => input('当前 HP Harold').focus())
  const range = document.querySelector('input[aria-label="当前 HP Harold 滑块"]') as HTMLInputElement
  expect(range).toBeTruthy()
  await act(async () => range.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '50')
    range.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(input('当前 HP Harold').value).toBe('50')
  expect(s.onAct).not.toHaveBeenCalled()
  await act(async () => window.dispatchEvent(new Event('pointerup')))
  expect(s.onAct).toHaveBeenCalledWith({ op: 'actorVital', actorId: 1, key: 'hp', value: 50 })
})

test('party: locked HP and invincible mode block the matching controls', async () => {
  await render(slot(), { locks: { 'hp:1': 320 }, god: false })
  expect(input('当前 HP Harold').disabled).toBe(true)
  expect(input('当前 MP Harold').disabled).toBe(false)
  expect(rowButton('Harold', '倒下')!.disabled).toBe(true)

  await act(async () => root!.unmount())
  await render(slot(), { locks: {}, god: true })
  expect(input('当前 HP Harold').disabled).toBe(true)
  expect(input('当前 MP Harold').disabled).toBe(true)
  expect(input('TP Harold').disabled).toBe(false)
  expect(rowButton('Harold', '倒下')!.disabled).toBe(true)
})

test("max fields are capped by each battler's own paramMax", async () => {
  const mz: BattleState = {
    ...battle,
    enemies: [{ ...battle.enemies[0]!, mhpCap: 9_999_999 }],
    party: [{ ...battle.party[0]!, mhpCap: 9999, mmpCap: 9_999_999 }],
  }
  const s = slot({ battle: mz })
  await render(s)
  await edit('HP 上限 Slime A', '5000000', 'Enter')
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'enemyMhp', index: 0, fromEnemyId: 1, mhp: 5000000 })
  await edit('MP 上限 Harold', '20000', 'Enter')
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorVital', actorId: 1, key: 'mmp', value: 20000 })
  await edit('HP 上限 Harold', '20000', 'Enter')
  expect(s.onAct).toHaveBeenLastCalledWith({ op: 'actorVital', actorId: 1, key: 'mhp', value: 9999 })
})

test('overlapping ops keep actions disabled until every one has finished', async () => {
  const pending: Array<() => void> = []
  const s = slot({ onAct: jest.fn(() => new Promise<void>((resolve) => pending.push(resolve))) })
  await render(s)
  await edit('当前 HP Harold', '100', 'Enter')
  await edit('当前 MP Harold', '10', 'Enter')
  expect(s.onAct).toHaveBeenCalledTimes(2)
  expect(rowButton('Slime A', '杀死')!.disabled).toBe(true)
  await act(async () => pending[0]!())
  expect(rowButton('Slime A', '杀死')!.disabled).toBe(true)
  await act(async () => pending[1]!())
  expect(rowButton('Slime A', '杀死')!.disabled).toBe(false)
})
