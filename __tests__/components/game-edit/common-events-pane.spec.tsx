/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { CommonEventsPane } from '@/components/game-edit/events/CommonEventsPane'
import type { EventsSlot } from '@/components/game-edit/events/types'
import { emptySession } from '@/components/game-edit/types'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { buildCommonEventsData, type CommonEventsData } from '@/lib/game/events'

const cmd = (code: number, parameters: unknown[] = [], indent = 0) => ({ code, indent, parameters })

function data(): CommonEventsData {
  return buildCommonEventsData(
    {
      commonEvents: [
        null,
        { id: 1, name: 'Heal', trigger: 0, switchId: 1, list: [cmd(125, [0, 0, 100]), cmd(0)] },
        { id: 2, name: 'Boss', trigger: 0, switchId: 1, list: [cmd(301, [0, 1, false, false]), cmd(0)] },
        { id: 3, name: 'Clock', trigger: 2, switchId: 4, list: [cmd(230, [60]), cmd(0)] },
      ],
      system: { switches: ['', '', '', '', 'Clock on'], variables: [] },
      items: null,
      weapons: null,
      armors: null,
      actors: null,
      troops: [null, { id: 1, name: 'Dragon', pages: [] }],
      mapInfos: null,
      maps: null,
    },
    (t) => t,
    'live'
  )
}

function slot(overrides: Partial<EventsSlot> = {}): EventsSlot {
  return {
    data: data(),
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
    ...overrides,
  }
}

let navigationCase = 0
beforeEach(() => history.pushState({}, '', `/test-view?case=${++navigationCase}`))

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
            <CommonEventsPane slot={s} filter={filter} session={{ ...emptySession(), switches: { 4: true } }} />
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
})

const buttonByText = (text: string, exact = true) =>
  [...document.querySelectorAll('button')].find((b) => (exact ? b.textContent?.trim() === text : b.textContent?.includes(text))) as HTMLButtonElement | undefined

test('shows the unavailable and no-match states', async () => {
  await render(slot({ data: null, unavailable: true }))
  expect(document.body.textContent).toContain('连接游戏后可浏览')
  await act(async () => root!.unmount())

  await render(slot(), 'zzz-nothing')
  expect(document.body.textContent).toContain('无匹配')
})

test('lists events with live switch state and selects on click', async () => {
  const s = slot()
  await render(s)
  expect(document.body.textContent).toContain('Heal')
  expect(document.body.textContent).toContain('并行 · 开')
  await act(async () => buttonByText('Heal', false)!.click())
  expect(s.onSelectCommon).toHaveBeenCalledWith(1)
})

test('disables run off the map and runs safe events without confirmation', async () => {
  await render(slot({ commonId: 1, onMap: false }))
  expect(buttonByText('执行')!.disabled).toBe(true)
  await act(async () => root!.unmount())

  const s = slot({ commonId: 1 })
  await render(s)
  await act(async () => buttonByText('执行')!.click())
  expect(s.onAct).toHaveBeenCalledWith({ op: 'commonEvent', id: 1 })
})

test('asks before running events with risky effects', async () => {
  const s = slot({ commonId: 2 })
  await render(s)
  await act(async () => buttonByText('执行')!.click())
  expect(s.onAct).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Boss')
})

test('displays orphaned alert, unstuck button, and candidate events to advance', async () => {
  const s = slot({
    eventActivity: {
      entries: [],
      transparent: true,
      movementLocked: true,
      faded: true,
      candidates: [{ mapId: 225, eventId: 4, page: 0, name: 'Scene', trigger: 3, missingConditions: ['#450'] }],
    },
  })
  await render(s)
  expect(document.body.textContent).toContain('没有事件运行，但主角仍透明或被锁定移动')
  expect(document.body.textContent).toContain('可推进剧情事件')
  expect(document.body.textContent).toContain('Scene')
  expect(document.body.textContent).toContain('缺 #450')

  const unstuckBtn = buttonByText('脱离卡死')!
  expect(unstuckBtn).not.toBeNull()
  await act(async () => unstuckBtn.click())
  expect(s.onAct).toHaveBeenCalledWith({ op: 'runAction', id: 'fix:unstuck' })

  const runBtn = buttonByText('强制执行')!
  expect(runBtn).not.toBeNull()
  await act(async () => runBtn.click())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('强制执行「Scene」？')
  const confirmBtn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === '强制执行') as HTMLButtonElement
  await act(async () => confirmBtn.click())
  expect(s.onAct).toHaveBeenCalledWith({ op: 'mapEvent', mapId: 225, eventId: 4, page: 0, from: 0 })
})

test('allows switching between running events and candidate events and toggling collapse', async () => {
  const s = slot({
    eventActivity: {
      entries: [
        {
          path: 'common:3',
          commonEventId: 3,
          mapId: 0,
          eventId: 0,
          page: null,
          name: 'Clock',
          index: 0,
          code: 230,
          previousCode: null,
          waitMode: '',
          child: false,
          token: 'token:3',
          waiting: false,
          skipBlocked: null,
          restartBlocked: null,
          advanceBlocked: null,
        },
      ],
      transparent: false,
      movementLocked: false,
      faded: false,
      candidates: [{ mapId: 225, eventId: 4, page: 0, name: 'Scene', trigger: 3, missingConditions: ['#450'] }],
    },
  })
  await render(s)
  expect(document.body.textContent).toContain('当前执行')
  expect(document.body.textContent).toContain('可推进剧情事件')
  // Default is running since runningCount > 0
  expect(document.body.textContent).toContain('Clock')

  // Switch to candidates tab
  const candTab = buttonByText('可推进剧情事件', false)!
  await act(async () => candTab.click())
  expect(document.body.textContent).toContain('Scene')

  // Collapse the panel
  const collapseBtn = document.querySelector('button[aria-label="收起"]') as HTMLButtonElement
  expect(collapseBtn).not.toBeNull()
  await act(async () => collapseBtn.click())
  // Body is collapsed
  expect(document.body.textContent).not.toContain('Scene')

  // Expand the panel
  const expandBtn = document.querySelector('button[aria-label="展开"]') as HTMLButtonElement
  expect(expandBtn).not.toBeNull()
  await act(async () => expandBtn.click())
  expect(document.body.textContent).toContain('Scene')
})
