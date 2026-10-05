/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { MapPane } from '@/components/game-edit/events/MapPane'
import type { EventsSlot } from '@/components/game-edit/events/types'
import { emptySession } from '@/components/game-edit/types'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { buildCommonEventsData, type MapDetailData } from '@/lib/game/events'
import { type MapEventPage, normalizeConditions } from '@/lib/game/events/map-index'

// 世界 › 村 › 家, plus a root 城
const data = buildCommonEventsData(
  {
    commonEvents: [null],
    system: { switches: [], variables: [] },
    items: null,
    weapons: null,
    armors: null,
    actors: null,
    troops: null,
    mapInfos: [
      null,
      { id: 1, name: '世界', parentId: 0, order: 1 },
      { id: 2, name: '村', parentId: 1, order: 2 },
      { id: 3, name: '城', parentId: 0, order: 3 },
      { id: 4, name: '家', parentId: 2, order: 4 },
    ],
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
    live: false,
    canAct: false,
    onMap: false,
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

async function render(s: EventsSlot) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <ConfirmProvider>
            <MapPane slot={s} filter="" session={emptySession()} />
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

const aside = () => document.querySelector('aside') as HTMLElement
/** Map name buttons in the list (not breadcrumb / drill buttons) */
const listed = () => [...aside().querySelectorAll('button')].filter((b) => !b.closest('nav') && !b.getAttribute('aria-label')).map((b) => b.textContent?.trim())
const drill = (name: string) => aside().querySelector(`button[aria-label="查看「${name}」的子地图"]`) as HTMLButtonElement | null
const crumb = (text: string) => [...aside().querySelectorAll('nav button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement

async function search(text: string) {
  const input = aside().querySelector('input[type="search"]') as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('shows one level at a time and drills in / out via › and the breadcrumb', async () => {
  await render(slot())
  expect(listed()).toEqual(['世界', '城'])
  expect(drill('城')).toBeNull()

  await act(async () => drill('世界')!.click())
  expect(listed()).toEqual(['村'])
  await act(async () => drill('村')!.click())
  expect(listed()).toEqual(['家'])
  expect(crumb('村')).toBeDefined()

  await act(async () => crumb('全部地图').click())
  expect(listed()).toEqual(['世界', '城'])
})

test('opens on the level of the selected map', async () => {
  await render(slot({ mapId: 4 }))
  expect(listed()).toEqual(['家'])
})

test('search lists matches flat with their path; › leaves search for that level', async () => {
  await render(slot())
  await search('村')
  expect(listed()).toEqual(['村· 世界'])
  await act(async () => drill('村')!.click())
  expect((aside().querySelector('input[type="search"]') as HTMLInputElement).value).toBe('')
  expect(listed()).toEqual(['家'])
})

test('selecting a map reports it', async () => {
  const s = slot()
  await render(s)
  const btn = [...aside().querySelectorAll('button')].find((b) => b.textContent?.trim() === '城') as HTMLButtonElement
  await act(async () => btn.click())
  expect(s.onSelectMap).toHaveBeenCalledWith(3, null)
})

const page = (characterName: string): MapEventPage => ({ conditions: normalizeConditions(null), trigger: 0, list: [], commandCount: 0, characterName, tileId: 0 })
const villageDetail: MapDetailData = {
  ok: true,
  source: 'disk',
  mapId: 2,
  name: '村',
  displayName: '',
  width: 10,
  height: 10,
  events: [{ id: 5, name: '门卫', rawName: '门卫', x: 1, y: 2, type: 'npc', pages: [page('a'), page('b')] }],
  texts: {},
}
const pageTab = (index: number) => document.querySelector(`nav[aria-label="事件页"] [data-nav-id="${index}"]`) as HTMLElement

test('event detail shows the page tab from the slot and reports picks', async () => {
  const s = slot({ mapId: 2, eventId: 5, mapDetail: villageDetail, eventPage: 1 })
  await render(s)
  expect(pageTab(1).getAttribute('aria-selected')).toBe('true')
  await act(async () => pageTab(0).click())
  expect(s.onSelectEventPage).toHaveBeenCalledWith(0)
})

test('an out-of-range page tab falls back to the first page', async () => {
  await render(slot({ mapId: 2, eventId: 5, mapDetail: villageDetail, eventPage: 7 }))
  expect(pageTab(0).getAttribute('aria-selected')).toBe('true')
})
