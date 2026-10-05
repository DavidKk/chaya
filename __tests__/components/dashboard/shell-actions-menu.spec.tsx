/** @jest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ShellActionsMenu } from '@/components/dashboard/ShellActionsMenu'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

let container: HTMLDivElement
let root: Root
const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, available: true }) }))

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  jest.useFakeTimers()
  fetchMock.mockClear()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  jest.useRealTimers()
})

function props(overrides: Partial<ComponentProps<typeof ShellActionsMenu>> = {}): ComponentProps<typeof ShellActionsMenu> {
  return {
    busy: false,
    gameOnline: false,
    canInstall: false,
    canUninstall: true,
    canFetch: true,
    hasShell: true,
    hasSource: true,
    buttonClassName: '',
    onInstall: async () => {},
    onFetchLatest: async () => {},
    onUninstall: async () => {},
    ...overrides,
  }
}

async function render(p: ComponentProps<typeof ShellActionsMenu>) {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="en" initialPreference="en">
        <ShellActionsMenu {...p} />
      </LocaleProvider>
    )
  })
}

const trigger = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('More')) as HTMLButtonElement

async function toggle() {
  await act(async () => trigger().click())
}

async function tick(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

it('re-checks every 3 seconds only while open', async () => {
  const onRefresh = jest.fn(async () => null)
  await render(props({ onRefresh }))
  await tick(6000)
  expect(onRefresh).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()

  await toggle()
  expect(onRefresh).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await tick(0)
  expect(document.body.textContent).toContain('Update shell')
  await tick(6000)
  expect(onRefresh).toHaveBeenCalledTimes(3)
  expect(fetchMock).toHaveBeenCalledTimes(3)

  await toggle()
  await tick(6000)
  expect(onRefresh).toHaveBeenCalledTimes(3)
})

it('keeps refreshing status but skips the upgrade check without a shell', async () => {
  const onRefresh = jest.fn(async () => null)
  await render(props({ onRefresh, hasShell: false }))
  await toggle()
  await tick(3000)
  expect(onRefresh).toHaveBeenCalledTimes(2)
  expect(fetchMock).not.toHaveBeenCalled()
})

const menuText = () => document.querySelector('[role="menu"]')?.textContent ?? ''

it('always offers the shared download, as update only when a newer version exists', async () => {
  fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ ok: true, available: false }) }))
  await render(props())
  await toggle()
  await tick(0)
  expect(menuText()).toContain('Download latest')
  expect(menuText()).not.toContain('Update shell')
  expect(menuText()).toContain('Uninstall')
  expect(menuText()).not.toContain('Install shell')
})

it('shows install instead of uninstall while the game has no shell', async () => {
  await render(props({ hasShell: false, canInstall: true, canUninstall: true }))
  await toggle()
  await tick(0)
  expect(menuText()).toContain('Install')
  expect(menuText()).toContain('Download latest')
  expect(menuText()).not.toContain('Uninstall')
})

it('disables the download once the shell is confirmed up to date', async () => {
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, available: false, currentChromium: '140.0.0.0', latestChromium: '140.0.0.0' }) }))
  await render(props())
  await toggle()
  await tick(0)
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes('Shell is up to date'))
  expect(item?.getAttribute('aria-disabled')).toBe('true')
  expect(menuText()).not.toContain('Download latest')
})

it('shows a disabled checking state until the first result, without flashing on re-checks', async () => {
  type FetchResult = Awaited<ReturnType<typeof fetchMock>>
  let resolve!: (value: FetchResult) => void
  fetchMock.mockImplementationOnce(() => new Promise<FetchResult>((r) => (resolve = r)))
  await render(props())
  await toggle()
  const item = () => [...document.querySelectorAll('[role="menuitem"]')].find((el) => /Checking|Download latest/.test(el.textContent ?? ''))
  expect(item()?.textContent).toContain('Checking')
  expect(item()?.getAttribute('aria-disabled')).toBe('true')
  expect(item()?.querySelector('[role="status"]')).not.toBeNull()

  await act(async () => resolve({ ok: true, json: async () => ({ ok: true, available: false }) }))
  expect(item()?.textContent).toContain('Download latest')
  fetchMock.mockImplementationOnce(() => new Promise(() => {}))
  await tick(3000)
  expect(item()?.textContent).toContain('Download latest')
})
