/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { LibraryRail } from '@/components/LibraryRail'

jest.mock('@/components/confirm/ConfirmProvider', () => ({ useConfirm: () => jest.fn() }))

const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
beforeAll(() => {
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
})
afterAll(() => {
  if (resizeObserverDescriptor) Object.defineProperty(globalThis, 'ResizeObserver', resizeObserverDescriptor)
  else Reflect.deleteProperty(globalThis, 'ResizeObserver')
})

it('allows an unavailable local game to be selected for relocation', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  const select = jest.fn()
  const entry = {
    id: 'missing',
    gameRoot: '/missing/Game',
    name: 'Game',
    addedAt: 1,
    lastOpenedAt: 1,
    missing: true,
    kindLabel: 'Missing',
    pathLabel: '/missing/Game',
    hasShell: false,
  }
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <LibraryRail entries={[entry]} activeRoot="" onSelect={select} onAdd={jest.fn()} onRemove={jest.fn()} />
        </LocaleProvider>
      )
    )
    const button = host.querySelector<HTMLButtonElement>('button[title="/missing/Game"]')!
    expect(button.disabled).toBe(false)
    expect(button.textContent).toContain('位置失效，点击重新选择')
    await act(async () => button.click())
    expect(select).toHaveBeenCalledWith('/missing/Game')
  } finally {
    await act(async () => root.unmount())
  }
})

function entry(id: string, name: string) {
  return {
    id,
    gameRoot: `/${name}`,
    name,
    addedAt: 1,
    lastOpenedAt: 1,
    missing: false,
    kindLabel: 'www',
    pathLabel: `/${name}`,
    hasShell: false,
  }
}

async function drag(source: Element, target: Element, edge: 'before' | 'after') {
  const data = new Map<string, string>()
  const dataTransfer = {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: jest.fn(),
  }
  const dispatch = (element: Element, type: string) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: edge === 'before' ? 10 : 50 })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    element.dispatchEvent(event)
  }
  jest.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 60, left: 0, width: 200 } as DOMRect)
  await act(async () => dispatch(source.querySelector('button')!, 'dragstart'))
  await act(async () => dispatch(target, 'dragover'))
  await act(async () => dispatch(target, 'drop'))
  await act(async () => dispatch(source.querySelector('button')!, 'dragend'))
}

it('reorders games by drag or arrow keys and keeps that custom order', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.localStorage.clear()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const reorder = jest.fn(async () => undefined)
  const names = () => [...host.querySelectorAll('ul button[title]')].map((button) => button.getAttribute('title'))
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <LibraryRail entries={[entry('a', 'A'), entry('b', 'B')]} activeRoot="" onSelect={jest.fn()} onAdd={jest.fn()} onRemove={jest.fn()} onReorder={reorder} />
        </LocaleProvider>
      )
    )
    const rows = () => [...host.querySelectorAll('ul > li')]
    expect(names()).toEqual(['/A', '/B'])
    await drag(rows()[1]!, rows()[0]!, 'before')
    expect(reorder).toHaveBeenCalledWith(['b', 'a'])
    expect(names()).toEqual(['/B', '/A'])
    expect(window.localStorage.getItem('chaya.librarySort')).toBe('manual')

    const handle = () => host.querySelector<HTMLButtonElement>('button[aria-label="拖拽调整 B 的顺序，也可按上下方向键"]')!
    handle().focus()
    await act(async () => handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
    expect(reorder).toHaveBeenLastCalledWith(['a', 'b'])
    expect(document.activeElement).toBe(handle())
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it('keeps reorder handles visible but disabled while the library is busy', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.localStorage.clear()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const reorder = jest.fn()
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <LibraryRail entries={[entry('a', 'A'), entry('b', 'B')]} activeRoot="" busy onSelect={jest.fn()} onAdd={jest.fn()} onRemove={jest.fn()} onReorder={reorder} />
        </LocaleProvider>
      )
    )
    const handles = [...host.querySelectorAll<HTMLButtonElement>('button[data-reorder-id]')]
    expect(handles).toHaveLength(2)
    expect(handles.every((handle) => handle.disabled)).toBe(true)
    expect(reorder).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
