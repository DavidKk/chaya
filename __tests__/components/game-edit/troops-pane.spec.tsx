/** @jest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { ConfirmProvider, type ConfirmRequest } from '@/components/confirm/ConfirmProvider'
import { TroopsPane } from '@/components/game-edit/events/TroopsPane'
import type { EventsSlot } from '@/components/game-edit/events/types'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { buildCommonEventsData } from '@/lib/game/events'
import { writeViewState } from '@/lib/view-state'

// The real confirm button ignores untrusted clicks, so tests answer the request directly.
const confirmMock = jest.fn<Promise<boolean>, [ConfirmRequest]>()
jest.mock('@/components/confirm/ConfirmProvider', () => ({
  ...jest.requireActual('@/components/confirm/ConfirmProvider'),
  useConfirm: () => confirmMock,
}))
const confirmText = () => renderToStaticMarkup(<>{confirmMock.mock.calls.at(-1)![0].description as ReactNode}</>)

const data = buildCommonEventsData(
  {
    commonEvents: null,
    system: null,
    items: null,
    weapons: null,
    armors: null,
    actors: null,
    enemies: [null, { name: 'Slime' }, { name: 'Bat' }],
    troops: [
      null,
      { name: 'Slime*2', members: [{ enemyId: 1 }, { enemyId: 1 }], pages: [{ list: [] }] },
      { name: 'Bats', members: [{ enemyId: 2 }, { enemyId: 2, hidden: true }], pages: [] },
      { name: 'Nobody', members: [], pages: [] },
    ],
    mapInfos: null,
    maps: null,
  },
  (t) => t,
  'live'
)

function slot(over: Partial<EventsSlot> = {}): EventsSlot {
  return {
    data,
    loading: false,
    error: '',
    live: true,
    canAct: true,
    onMap: true,
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
    battle: null,
    ...over,
  }
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  globalThis.CSS ??= { escape: (value: string) => value } as unknown as typeof CSS
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
let host: HTMLDivElement | null = null

async function render(s: EventsSlot, filter = '') {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <ConfirmProvider>
            <TroopsPane slot={s} filter={filter} />
          </ConfirmProvider>
        </NotificationProvider>
      </LocaleProvider>
    )
  )
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
  root = null
  window.sessionStorage.clear()
})

const aside = () => document.querySelector('aside') as HTMLElement
const buttonByText = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined

test('lists troops with member summaries and hides empty troops by default', async () => {
  const s = slot()
  await render(s)
  await act(async () => buttonByText('只看可遇到')!.click())
  expect(aside().textContent).toContain('Slime ×2')
  expect(aside().textContent).toContain('Bat ×2')
  expect(aside().textContent).not.toContain('Nobody')
  await act(async () => buttonByText('显示空敌群')!.click())
  expect(aside().textContent).toContain('Nobody')
  await act(async () => [...aside().querySelectorAll('button')].find((b) => b.textContent?.includes('Bats'))!.click())
  expect(s.onSelectTroop).toHaveBeenCalledWith(2)
})

test('searches by enemy name', async () => {
  await render(slot(), 'bat')
  await act(async () => buttonByText('只看可遇到')!.click())
  expect(aside().textContent).toContain('Bats')
  expect(aside().textContent).not.toContain('Slime*2')
})

test('disables the battle button off the map or offline', async () => {
  await render(slot({ troopId: 1, onMap: false }))
  expect(buttonByText('立即开战')!.disabled).toBe(true)
  await act(async () => root!.unmount())
  await render(slot({ troopId: 1, canAct: false }))
  expect(buttonByText('立即开战')!.disabled).toBe(true)
})

test('cancelling the confirm does not start a battle', async () => {
  confirmMock.mockResolvedValueOnce(false)
  const s = slot({ troopId: 1 })
  await render(s)
  await act(async () => buttonByText('立即开战')!.click())
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: '与「Slime*2」开战？', confirmLabel: '开战', confirmVariant: 'warn' }))
  expect(s.onAct).not.toHaveBeenCalled()
})

test('confirms with members and a game-over warning, then starts with the remembered options', async () => {
  confirmMock.mockResolvedValueOnce(true)
  const s = slot({ troopId: 1 })
  await render(s)
  await act(async () => buttonByText('立即开战')!.click())
  expect(confirmText()).toContain('Slime ×2')
  expect(confirmText()).toContain('战败将进入游戏结束画面')
  expect(s.onAct).toHaveBeenCalledWith({ op: 'troop', id: 1, canEscape: true, canLose: false })
  expect(s.afterRun).toHaveBeenCalled()
})

test('battle options toggle and are used for the next battle', async () => {
  confirmMock.mockResolvedValueOnce(true)
  const s = slot({ troopId: 1 })
  await render(s)
  await act(async () => (document.querySelector('[aria-label="战败后继续"]') as HTMLElement).click())
  await act(async () => buttonByText('立即开战')!.click())
  expect(confirmText()).not.toContain('战败将进入游戏结束画面')
  expect(s.onAct).toHaveBeenCalledWith({ op: 'troop', id: 1, canEscape: true, canLose: true })
})

test('reports a failed start', async () => {
  confirmMock.mockResolvedValueOnce(true)
  const s = slot({ troopId: 1, onAct: jest.fn().mockRejectedValue(new Error('对话进行中，请稍后再试')) })
  await render(s)
  await act(async () => buttonByText('立即开战')!.click())
  expect(document.body.textContent).toContain('开战失败：对话进行中，请稍后再试')
  expect(s.afterRun).not.toHaveBeenCalled()
})

test('starts with the remembered enemy count and lists it in the confirm', async () => {
  writeViewState('troopBattle', { canEscape: true, canLose: false, count: 3 })
  confirmMock.mockResolvedValueOnce(true)
  const s = slot({ troopId: 1 })
  await render(s)
  await act(async () => buttonByText('立即开战')!.click())
  expect(confirmText()).toContain('敌人数量：3')
  expect(s.onAct).toHaveBeenCalledWith({ op: 'troop', id: 1, canEscape: true, canLose: false, count: 3 })
})

const reachable = { ...data, troopEncounters: { 2: [{ mapId: 7, weight: 5, regionSet: [2] }] }, troopRefs: {}, names: { ...data.names, maps: Object.assign([], { 7: 'Cave' }) } }

test('"encounterable only" is on by default and keeps troops met on a map or called by an event', async () => {
  await render(slot({ data: reachable }))
  expect(buttonByText('只看可遇到')!.getAttribute('aria-checked')).toBe('true')
  expect(aside().textContent).toContain('Bats')
  expect(aside().textContent).not.toContain('Slime*2')
  await act(async () => buttonByText('只看可遇到')!.click())
  expect(aside().textContent).toContain('Slime*2')
})

test('detail shows where the troop appears (jumps to the map), callers and battle events', async () => {
  const s = slot({ data: reachable, troopId: 2 })
  await render(s)
  const appears = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('#7 Cave'))!
  expect(appears.textContent).toContain('仅区域 2 · 权重 5')
  await act(async () => appears.click())
  expect(s.onSelectMap).toHaveBeenCalledWith(7, null)
  expect(document.body.textContent).toContain('没有事件用“战斗处理”指定它')
  expect(document.body.textContent).toContain('没有战斗事件')
})

test('the troop page no longer hosts the current battle', async () => {
  const battle = {
    ended: false,
    enemies: [{ index: 0, enemyId: 1, name: 'Slime A', hp: 40, mhp: 100, alive: true, appeared: true }],
    party: [],
    partyIds: [],
    partyMax: 4,
    settling: false,
  }
  await render(slot({ onMap: false, battle }))
  expect(document.querySelector('input[aria-label="当前 HP Slime A"]')).toBeNull()
})
