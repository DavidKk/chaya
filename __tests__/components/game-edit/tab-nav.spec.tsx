/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameEditTabNav } from '@/components/game-edit/GameEditTabNav'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('renders edit categories as icon-only accessible buttons', async () => {
  const setTab = jest.fn()
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameEditTabNav tab="run" setTab={setTab} surface="page" />
      </LocaleProvider>
    )
  )

  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-edit-categories] button'))
  expect(host.querySelector('aside')!.className).toContain('hidden')
  expect(buttons).toHaveLength(11)
  expect(buttons.every((button) => button.textContent === '' && !!button.getAttribute('aria-label'))).toBe(true)
  expect(buttons[0].getAttribute('aria-current')).toBe('page')

  await act(async () => buttons[1].click())
  expect(setTab).toHaveBeenCalledWith('bag')
})

test('keeps the shared category rail available on small screens in the game overlay', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameEditTabNav tab="run" setTab={jest.fn()} surface="overlay" />
      </LocaleProvider>
    )
  )

  const aside = host.querySelector('aside')!
  expect(aside.getAttribute('data-mobile-visible')).toBe('true')
  expect(aside.className).not.toContain('hidden')
})
