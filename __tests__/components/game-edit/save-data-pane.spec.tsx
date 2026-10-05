/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { SaveDataPane } from '@/components/game-edit/save-data/SaveDataPane'
import { draftStore, valueStore, writtenStore } from '@/components/game-edit/save-data/store'
import type { SaveDataSlot, SaveDataTransport } from '@/components/game-edit/save-data/transport'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import type { DataDiff, DataPage, DataStatus } from '@/lib/game/save-data'

let container: HTMLDivElement
let root: Root

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
  globalThis.CSS ??= { escape: (v: string) => v } as unknown as typeof CSS
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  valueStore.clear()
  draftStore.clear()
  writtenStore.clear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const status: DataStatus = { gen: 1, ready: true, undo: null, undoDepth: 0, locks: [], pins: [] }

const page: DataPage = {
  path: ['party'],
  gen: 1,
  oid: 7,
  kind: 'object',
  total: 2,
  offset: 0,
  labels: [null],
  canInsert: true,
  insertMode: 'value',
  rows: [
    { key: '_gold', kind: 'number', value: 100 },
    { key: '_steps', kind: 'number', value: 3 },
  ],
}

function fakeTransport(over: Partial<DataStatus> = {}) {
  let diffCb: ((d: DataDiff) => void) | null = null
  let statusCb: ((s: DataStatus) => void) | null = null
  const run = jest.fn(async () => [{ path: ['party', '_gold'], ok: true, readback: { kind: 'number', value: 500 } }])
  const transport: SaveDataTransport = {
    list: jest.fn(async () => page),
    read: jest.fn(),
    rows: jest.fn(async () => []),
    watch: jest.fn(),
    onDiff: (cb) => {
      diffCb = cb
      return () => {}
    },
    onStatus: (cb) => {
      statusCb = cb
      return () => {}
    },
    requestStatus: () => statusCb?.({ ...status, ...over }),
    search: () => () => {},
    run,
  }
  return { transport, run, diff: (d: DataDiff) => diffCb?.(d) }
}

async function render(transport: SaveDataTransport | null, path: string[] = ['party'], onNavigate: SaveDataSlot['onNavigate'] = jest.fn(), rootView?: SaveDataSlot['rootView']) {
  const slot: SaveDataSlot = { transport, path, rootView, onNavigate, surface: 'page' }
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <NotificationProvider>
          <ConfirmProvider>
            <SaveDataPane slot={slot} />
          </ConfirmProvider>
        </NotificationProvider>
      </LocaleProvider>
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const draftInputs = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="修改为"]'))

test('asks to link the game without a transport', async () => {
  await render(null)
  expect(container.textContent).toContain('需要连接游戏')
})

test('asks to load a save before the game is ready', async () => {
  await render(fakeTransport({ ready: false }).transport)
  expect(container.textContent).toContain('请先读档进游戏')
})

test('live value updates do not touch the draft input', async () => {
  const { transport, diff } = fakeTransport()
  await render(transport)
  expect(container.textContent).toContain('100')
  const [gold] = draftInputs()
  type(gold, '999')
  await act(async () => {
    await new Promise((r) => setTimeout(r, 250))
  })
  await act(async () => diff({ sid: 1, gen: 1, changes: [{ path: ['party', '_gold'], cell: { kind: 'number', value: 120 } }] }))
  expect(container.textContent).toContain('120')
  expect(draftInputs()[0].value).toBe('999')
})

test('drafts are watched by owner and go stale when it is replaced', async () => {
  const { transport, diff } = fakeTransport()
  await render(transport)
  type(draftInputs()[0], '500')
  await act(async () => {
    await new Promise((r) => setTimeout(r, 250))
  })
  const watch = transport.watch as jest.Mock
  const [sid, entries] = watch.mock.calls.at(-1)!
  expect(entries).toContainEqual({ path: ['party', '_gold'], ownerOid: 7 })
  await act(async () => diff({ sid, gen: 1, changes: [], replaced: [['party', '_gold']] }))
  expect(draftStore.get(JSON.stringify(['party', '_gold']))?.state).toBe('stale')
})

test('apply all sends nothing while a draft is stale', async () => {
  const { transport, run } = fakeTransport()
  await render(transport)
  type(draftInputs()[0], '500')
  draftStore.set(JSON.stringify(['map', '_events', '1', '_x']), { path: ['map', '_events', '1', '_x'], ownerOid: 3, type: 'number', raw: '4', state: 'stale' })
  const applyAll = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '全部应用')!
  await act(async () => applyAll.click())
  expect(run).not.toHaveBeenCalled()
  expect(draftStore.size).toBe(2)
})

test('apply all blocks invalid numbers and writes valid drafts', async () => {
  const { transport, run } = fakeTransport()
  await render(transport)
  type(draftInputs()[1], 'abc')
  const applyAll = () => Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '全部应用')!
  await act(async () => applyAll().click())
  expect(run).not.toHaveBeenCalled()
  expect(draftInputs()[1].getAttribute('aria-invalid')).toBe('true')
  expect(draftStore.get(JSON.stringify(['party', '_steps']))?.error).toBe('请输入有效数字')

  type(draftInputs()[1], '')
  type(draftInputs()[0], '500')
  await act(async () => applyAll().click())
  expect(run).toHaveBeenCalledWith({ op: 'dataWrite', items: [{ path: ['party', '_gold'], ownerOid: 7, type: 'number', value: 500 }] })
  expect(draftStore.size).toBe(0)
})

test('root shows the quick access entry and opens field paths from the breadcrumb', async () => {
  const { transport } = fakeTransport()
  const onNavigate = jest.fn()
  await render(transport, [], onNavigate)
  const nav = container.querySelector('nav[aria-label="数据路径"]')!
  expect(nav.textContent).toContain('全部')
  expect(nav.textContent).toContain('常用')
  expect(container.textContent).toContain('还没有常用字段')
  const rootCrumb = Array.from(nav.querySelectorAll('button')).find((b) => b.textContent === '全部')!
  await act(async () => rootCrumb.click())
  expect(onNavigate).toHaveBeenCalledWith([], { root: 'all' })
  await render(transport, [], onNavigate, 'all')
  expect(container.querySelector('button[aria-label="进入 常用"]')).not.toBeNull()
})

test('root "all" view comes from the slot; the quick access entry switches back to pins', async () => {
  const { transport } = fakeTransport()
  const onNavigate = jest.fn()
  await render(transport, [], onNavigate, 'all')
  const nav = container.querySelector('nav[aria-label="数据路径"]')!
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('全部')
  expect(nav.textContent).not.toContain('常用')
  await act(async () => (container.querySelector('button[aria-label="进入 常用"]') as HTMLButtonElement).click())
  expect(onNavigate).toHaveBeenCalledWith([], { root: 'pins' })
})
