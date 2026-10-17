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
