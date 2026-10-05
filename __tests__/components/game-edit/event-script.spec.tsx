/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { EventScript } from '@/components/game-edit/events/EventScript'
import type { ScriptLive } from '@/components/game-edit/events/ScriptValue'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { buildCommonEventsData, type EventCommand } from '@/lib/game/events'

const c = (code: number, indent: number, parameters: unknown[] = []) => ({ code, indent, parameters })

const data = buildCommonEventsData(
  {
    commonEvents: [null],
    system: { switches: ['', 'Met chief'], variables: ['', '', '', '', '', 'Visits'] },
    items: null,
    weapons: null,
    armors: null,
    actors: null,
    troops: null,
    mapInfos: null,
    maps: null,
  },
  (t) => t,
  'live'
)

// Rows (101+401 merge, block ends hidden): if switch #1 ON / text Again / else / text Welcome / var #5 = 3 / if var #5 == 2 / text Two
const list: EventCommand[] = [
  c(111, 0, [0, 1, 0]),
  c(101, 1, ['', 0, 0, 2, 'Chief']),
  c(401, 1, ['Again']),
  c(411, 0),
  c(101, 1, ['', 0, 0, 2, 'Chief']),
  c(401, 1, ['Welcome']),
  c(412, 0),
  c(122, 0, [5, 5, 0, 0, 3]),
  c(111, 0, [1, 5, 0, 2, 0]),
  c(101, 1, ['', 0, 0, 2, '']),
  c(401, 1, ['Two']),
  c(412, 0),
]

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
})

let root: Root | null = null
let host: HTMLDivElement | null = null

function live(over: Partial<ScriptLive> = {}): ScriptLive {
  return { state: { switches: { 1: true }, vars: {}, self: '' }, canEdit: true, onSwitch: jest.fn(), onVar: jest.fn(), ...over }
}

async function render(props: Partial<Parameters<typeof EventScript>[0]> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <EventScript list={list} names={data.names} texts={data.texts} {...props} />
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

const rows = () => [...document.querySelectorAll('[role="row"]')].slice(1) as HTMLElement[]
const runButtons = () => [...document.querySelectorAll('button[aria-label^="从第"]')] as HTMLButtonElement[]

async function search(text: string) {
  const input = document.querySelector('input[type="search"]') as HTMLInputElement
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('numbers flat rows and marks which branch runs', async () => {
  await render({ live: live() })
  expect(rows().map((r) => r.querySelector('[role="cell"]')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  expect(rows()[0].textContent).toContain('会走这里')
  expect(rows()[2].textContent).toContain('不会执行')
  // Variable #5 is set to 3 just before, so "== 2" is decided false
  expect(rows()[5].textContent).toContain('不会执行')
})

test('offline: every branch is undecided', async () => {
  await render()
  expect(rows()[0].textContent).toContain('待定')
  expect(rows()[2].textContent).toContain('待定')
  expect(runButtons()).toHaveLength(0)
})

test('search filters rows by label and text', async () => {
  await render()
  await search('welcome')
  expect(rows()).toHaveLength(1)
  expect(rows()[0].textContent).toContain('Welcome')
  expect(document.body.textContent).toContain('1 / 7')
  await search('zzz')
  expect(document.body.textContent).toContain('无匹配')
})

test('runs from a row by its command index; blocked reason disables', async () => {
  const onRunFrom = jest.fn()
  await render({ onRunFrom })
  await act(async () => runButtons()[2].click())
  expect(onRunFrom).toHaveBeenCalledWith(3)
  await act(async () => root!.unmount())

  await render({ onRunFrom, runBlocked: '需要连接游戏' })
  expect(runButtons().every((b) => b.disabled)).toBe(true)
})

test('edits switches and variables in place', async () => {
  const l = live()
  await render({ live: l })
  const sw = rows()[0].querySelector('[role="switch"]') as HTMLButtonElement
  expect(sw.getAttribute('aria-checked')).toBe('true')
  await act(async () => sw.click())
  expect(l.onSwitch).toHaveBeenCalledWith(1, false)
  // Variable rows offer the constants the list compares / assigns
  expect(rows()[5].querySelector('button[aria-haspopup="listbox"]')).not.toBeNull()
  await act(async () => root!.unmount())

  await render({ live: live({ canEdit: false }) })
  expect((rows()[0].querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true)
})
