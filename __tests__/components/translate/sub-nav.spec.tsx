/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { PanelHeadEndProvider } from '@/components/PanelHeadEnd'
import { TranslateEnginesDrawerProvider } from '@/components/translate/TranslateEnginesDrawerContext'
import { TranslateContentToolbar, TranslateSubNav } from '@/components/translate/TranslateSubNav'

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

test('renders translate pages as icon-only accessible links', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <TranslateSubNav tab="cache" />
      </LocaleProvider>
    )
  )

  const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-translate-section-nav] a'))
  expect(host.querySelector('aside')!.className).toContain('hidden')
  expect(links.map((link) => link.getAttribute('href'))).toEqual(['/translate/run', '/translate/cache'])
  expect(links.every((link) => link.textContent === '' && !!link.getAttribute('aria-label'))).toBe(true)
  expect(links[1].getAttribute('aria-current')).toBe('page')
})

test('uses the same icon rail inside the game overlay', async () => {
  const onSelect = jest.fn()
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <TranslateSubNav tab="cache" onSelect={onSelect} />
      </LocaleProvider>
    )
  )

  const button = host.querySelector<HTMLButtonElement>('[data-translate-section-nav] button')!
  expect(host.querySelector('aside')!.getAttribute('data-mobile-visible')).toBe('true')
  await act(async () => button.click())
  expect(onSelect).toHaveBeenCalledWith('run')
})

test('shows the active translation section title and description in the shared content header', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <PanelHeadEndProvider>
          <TranslateEnginesDrawerProvider>
            <TranslateContentToolbar tab="cache" />
          </TranslateEnginesDrawerProvider>
        </PanelHeadEndProvider>
      </LocaleProvider>
    )
  )

  expect(host.querySelector('h2')?.textContent).toBe('共享翻译库')
  expect(host.textContent).toContain('查看、搜索并维护当前游戏的翻译内容。')
})
