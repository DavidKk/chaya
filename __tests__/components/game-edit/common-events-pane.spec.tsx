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
    mapDetail: null,
    mapLoading: false,
    mapError: '',
    player: null,
    recentMaps: [],
    ...overrides,
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
