/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { LinkedGameBadge } from '@/components/LinkedGameBadge'

const link = { roomId: null as string | null, connected: false }
jest.mock('@/components/GameLinkProvider', () => ({ useGameLinkContext: () => link }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root

function mockStatus(body: object) {
  globalThis.fetch = jest.fn(async () => ({ json: async () => body })) as unknown as typeof fetch
}

async function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <LinkedGameBadge />
      </LocaleProvider>
    )
  )
  return host.querySelector('a') as HTMLAnchorElement
}

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const selected = {
  ready: true,
  config: { gameRoot: '/games/walk' },
  library: [{ id: 'g1', gameRoot: '/games/walk/', name: 'walk-game', remark: '散步游戏' }],
}

it('shows "no game" in grey when nothing is selected', async () => {
  link.connected = false
  mockStatus({ ready: false })
  const badge = await render()
  expect(badge.dataset.state).toBe('none')
  expect(badge.textContent).toBe('未选择游戏')
  expect(badge.getAttribute('href')).toBe('/game')
})

it('shows the game name in warn colour when selected but not connected', async () => {
  link.connected = false
  mockStatus(selected)
  const badge = await render()
  expect(badge.dataset.state).toBe('offline')
  expect(badge.textContent).toBe('散步游戏')
  expect(badge.getAttribute('aria-label')).toContain('未连接')
})

it('hides in remote mode, where the page never opens a game link', async () => {
  link.connected = false
  mockStatus({ ...selected, remote: true })
  expect(await render()).toBeNull()
})

it('shows the game name in ok colour once connected', async () => {
  link.connected = true
  mockStatus(selected)
  const badge = await render()
  expect(badge.dataset.state).toBe('linked')
  expect(badge.textContent).toBe('散步游戏')
  expect(badge.getAttribute('aria-label')).toContain('已连接')
})
it('reads selected game from status.selected when status.config.gameRoot differs or is missing', async () => {
  link.connected = false
  mockStatus({
    ready: true,
    config: { gameRoot: '/games/default' },
    selected: '/games/target',
    library: [
      { id: 'g1', gameRoot: '/games/default', name: 'default-game', remark: '默认游戏' },
      { id: 'g2', gameRoot: '/games/target', name: 'target-game', remark: '目标游戏' },
    ],
  })
  const badge = await render()
  expect(badge.textContent).toBe('目标游戏')
  expect(badge.getAttribute('href')).toBe('/game?game=g2')
})
