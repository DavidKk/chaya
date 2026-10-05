/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { MapPane } from '@/components/game-edit/events/MapPane'
import type { EventsSlot } from '@/components/game-edit/events/types'
import { emptySession } from '@/components/game-edit/types'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { buildCommonEventsData } from '@/lib/game/events'

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
const listed = () =>
  [...aside().querySelectorAll('[aria-current], button[title]')].filter((b) => !b.closest('nav') && !b.getAttribute('aria-label')).map((b) => b.textContent?.trim())
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
