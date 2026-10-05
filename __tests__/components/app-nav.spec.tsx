/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { AppNav } from '@/components/AppNav'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

let mockPathname = '/integration/mcp'

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

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
  mockPathname = '/integration/mcp'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('opens the mobile drawer with the active section and its secondary links', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <AppNav current="/integration" />
      </LocaleProvider>
    )
  )

  const trigger = host.querySelector<HTMLButtonElement>('button[aria-controls="app-mobile-nav"]')!
  expect(trigger.className).toContain('md:hidden')

  await act(async () => trigger.click())

  const drawer = document.querySelector<HTMLElement>('[data-app-mobile-nav]')!
  const integrationToggle = Array.from(drawer.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find((button) => button.textContent?.trim() === '集成')!
  expect(integrationToggle.getAttribute('aria-expanded')).toBe('true')

  const secondaryLinks = Array.from(drawer.querySelectorAll<HTMLAnchorElement>('#app-mobile-nav-integration a'))
  expect(secondaryLinks.map((link) => link.textContent)).toEqual(['Skills', 'MCP', 'WebMCP'])
  expect(secondaryLinks.find((link) => link.getAttribute('aria-current') === 'page')?.getAttribute('href')).toBe('/integration/mcp')
})

test('closes the mobile drawer after navigating', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <AppNav current="/integration" />
      </LocaleProvider>
    )
  )

  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-controls="app-mobile-nav"]')!.click())
  const skillsLink = document.querySelector<HTMLAnchorElement>('#app-mobile-nav-integration a[href="/integration/skills"]')!
  await act(async () => skillsLink.click())
  expect(document.querySelector('[data-app-mobile-nav]')).toBeNull()
})
