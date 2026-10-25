/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { LogPanel } from '@/components/LogPanel'

const replace = jest.fn()
let query = new URLSearchParams()
let source: FakeEventSource

class FakeEventSource {
  private readonly listeners = new Map<string, (event: MessageEvent) => void>()

  constructor() {
    sourceEventStreams.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener)
  }

  emit(type: string) {
    this.listeners.get(type)?.(new MessageEvent(type))
  }

  close() {}
}

const sourceEventStreams: FakeEventSource[] = []

jest.mock('next/navigation', () => ({
  usePathname: () => '/logs/runtime',
  useRouter: () => ({ replace }),
  useSearchParams: () => query,
}))

jest.mock('@/components/GameLinkProvider', () => ({
  useGameLinkContext: () => ({ browserMode: false, connected: true }),
}))

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  EventSource: FakeEventSource,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  replace.mockClear()
  query = new URLSearchParams()
  sourceEventStreams.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('the live button replaces the pause control and toggles log reception', async () => {
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LogPanel />
      </LocaleProvider>
    )
  )
  source = sourceEventStreams[0]
  await act(async () => source.emit('hello'))

  const live = host.querySelector<HTMLButtonElement>('button[aria-label="实时"]')!
  expect(live.getAttribute('aria-pressed')).toBe('true')
  expect(live.textContent).toBe('实时')
  expect(live.querySelector('span')).toBeNull()
  expect(live.className).toContain('after:w-3')
  expect(live.className).toContain('after:bg-ok')
  expect(live.className).not.toMatch(/(^|\s)bg-ok(\s|$)/)
  expect(live.className).toContain('text-ok')
  expect(live.className).toContain('hover:enabled:text-ok')
  expect(live.className).toContain('bg-transparent')
  expect(host.querySelector('button[aria-label="暂停"]')).toBeNull()
  expect(host.textContent).toContain('实时')

  await act(async () => live.click())
  expect(live.getAttribute('aria-pressed')).toBe('false')
  expect(live.className).toContain('after:hidden')
  expect(host.textContent).toContain('已暂停')
})
