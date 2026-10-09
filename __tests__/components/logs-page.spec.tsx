/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { LogsPage } from '@/components/LogsPage'

const replace = jest.fn()
let query = new URLSearchParams()

jest.mock('next/navigation', () => ({
  usePathname: () => '/logs',
  useRouter: () => ({ replace }),
  useSearchParams: () => query,
}))

jest.mock('@/components/LogPanel', () => ({ LogPanel: () => <div data-testid="runtime-log">runtime</div> }))
jest.mock('@/components/game-agent/AgentActivityLogPanel', () => ({ AgentActivityLogPanel: () => <div data-testid="agent-log">agent</div> }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  replace.mockClear()
  query = new URLSearchParams()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('uses the shared desktop section sidebar to navigate log views', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LogsPage />
      </LocaleProvider>
    )
  )

  const aside = host.querySelector<HTMLElement>('[data-section-side-nav]')!
  const buttons = Array.from(aside.querySelectorAll<HTMLButtonElement>('button'))
  expect(aside.getAttribute('data-mobile-visible')).toBeNull()
  expect(aside.className).toContain('hidden')
  expect(aside.className).toContain('md:block')
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['运行日志', 'Agent 活动'])
  expect(buttons[0].getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('[data-testid="runtime-log"]')).not.toBeNull()

  await act(async () => buttons[1].click())
  expect(replace).toHaveBeenCalledWith('/logs?view=agent', { scroll: false })
})

test('selects the Agent activity view from the URL', async () => {
  query = new URLSearchParams('view=agent')
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LogsPage />
      </LocaleProvider>
    )
  )

  const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-section-side-nav] button'))
  expect(buttons[1].getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('[data-testid="agent-log"]')).not.toBeNull()
})
