/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { GameEditSearch } from '@/components/game-edit/GameEditSearch'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

let resize: (() => void) | undefined
let toolbarWidth = 600

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        resize ??= callback
      }
      observe() {}
      disconnect() {}
    },
  })
})

afterEach(() => {
  window.localStorage.removeItem('chaya.localePref')
})

test('search keeps the icon at narrow widths and preserves the query across modes', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  host.getBoundingClientRect = () => ({ width: toolbarWidth }) as DOMRect
  const root = createRoot(host)
  const onChange = jest.fn()
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <GameEditSearch value="村民" onChange={onChange} />
        </LocaleProvider>
      )
    )
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('村民')
    expect(host.querySelector('button[aria-label="搜索"]')).toBeNull()

    toolbarWidth = 240
    await act(async () => resize?.())
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="搜索"]')!
    const focus = jest.spyOn(trigger, 'focus')
    expect(trigger).not.toBeNull()
    expect(host.querySelector('input')).toBeNull()

    await act(async () => trigger.click())
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="search"]')!
    expect(input.value).toBe('村民')
    expect(document.activeElement).toBe(input)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '主角')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('主角')

    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(focus).toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)

    toolbarWidth = 600
    await act(async () => resize?.())
    expect(host.querySelector('input[type="search"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    toolbarWidth = 600
    resize = undefined
  }
})
