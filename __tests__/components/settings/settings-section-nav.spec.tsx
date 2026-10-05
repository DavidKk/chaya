/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { SettingsSectionNav } from '@/components/settings/SettingsSectionNav'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

test('uses link navigation on settings pages', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <SettingsSectionNav href="/settings/agents" />
      </LocaleProvider>
    )
  )

  const nav = host.querySelector<HTMLElement>('[data-settings-section-nav] nav')!
  const link = nav.querySelector<HTMLAnchorElement>('a')!
  expect(link.getAttribute('href')).toBe('/settings/agents')
  expect(link.getAttribute('aria-current')).toBe('page')
  expect(link.textContent).toContain('Agent')
})

test('uses button navigation inside the game plugin', async () => {
  const onSelect = jest.fn()
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <SettingsSectionNav onSelect={onSelect} />
      </LocaleProvider>
    )
  )

  const button = host.querySelector<HTMLButtonElement>('button')!
  await act(async () => button.click())
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(button.getAttribute('aria-current')).toBe('page')
})
