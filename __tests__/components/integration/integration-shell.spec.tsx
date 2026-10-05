/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { IntegrationShell } from '@/components/integration/IntegrationShell'

jest.mock('next/navigation', () => ({
  usePathname: () => '/integration/mcp',
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
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('renders icon-only links with accessible labels and the active page', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <IntegrationShell>
          <div>content</div>
        </IntegrationShell>
      </LocaleProvider>
    )
  )

  const nav = host.querySelector<HTMLElement>('[data-section-side-nav] nav')!
  const aside = nav.closest('aside')!
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a'))

  expect(aside.className).toContain('hidden')
  expect(aside.className).toContain('md:block')
  expect(aside.getAttribute('data-mobile-visible')).toBeNull()
  expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['Skills', 'MCP', 'WebMCP'])
  expect(links.map((link) => link.textContent)).toEqual(['', '', ''])
  expect(links.find((link) => link.getAttribute('aria-current') === 'page')?.getAttribute('href')).toBe('/integration/mcp')
})
