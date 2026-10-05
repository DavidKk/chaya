/** @jest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { DashboardGameActions } from '@/components/dashboard/DashboardGameActions'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() }) }))

type Props = ComponentProps<typeof DashboardGameActions>
let container: HTMLDivElement
let root: Root

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(state: Props['plugins']['state']) {
  const plugins = { state, onInstall: jest.fn(async () => {}), onClear: jest.fn(async () => {}) }
  const props: Props = {
    busy: false,
    launch: { online: false, pending: false, enabled: true, label: 'Start', onStart: async () => {}, onQuit: async () => {} },
    plugins,
    shell: {
      canInstall: false,
      canUninstall: false,
      canFetch: false,
      hasShell: true,
      hasSource: true,
      onInstall: async () => {},
      onFetchLatest: async () => {},
      onUninstall: async () => {},
    },
  }
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="en" initialPreference="en">
        <DashboardGameActions {...props} />
      </LocaleProvider>
    )
  )
  return plugins
}

const button = (label: string) => [...container.querySelectorAll('button')].find((el) => el.textContent?.includes(label))

it.each([
  ['missing', 'Install plugins', 'onInstall'],
  ['outdated', 'Update plugins', 'onInstall'],
  ['ready', 'Clear plugins', 'onClear'],
] as const)('%s plugins show "%s" and call %s', async (state, label, handler) => {
  const plugins = await render(state)
  await act(async () => button(label)!.click())
  expect(plugins[handler]).toHaveBeenCalledTimes(1)
  expect(plugins[handler === 'onInstall' ? 'onClear' : 'onInstall']).not.toHaveBeenCalled()
})

it('hides the plugin button when plugins cannot be installed', async () => {
  await render('unavailable')
  expect(button('plugins')).toBeUndefined()
})
