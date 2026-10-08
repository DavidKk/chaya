/** @jest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { TranslateGate } from '@/components/translate/TranslateGate'

let mockRoom: string | null = null
let mockConnected = false
const mockNotify = { info: jest.fn(), error: jest.fn(), success: jest.fn() }
const mockRouter = { push: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, usePathname: () => '/translate/run' }))
jest.mock('@/components/GameLinkProvider', () => ({ useGameLinkContext: () => ({ roomId: mockRoom, connected: mockConnected }) }))
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))
jest.mock('@/components/i18n/LocaleProvider', () => ({ useT: () => (key: string) => key }))
jest.mock('@/components/translate/TranslateRunSkeleton', () => ({ TranslateRunSkeleton: () => 'loading' }))
jest.mock('@/components/translate/TranslateCacheTableSkeleton', () => ({ TranslateCacheTableSkeleton: () => 'loading' }))
jest.mock('@/components/sk', () => {
  const { createElement: h } = jest.requireActual('react')
  return {
    EmptyState: ({ title, message, children }: { title: string; message: string; children: unknown }) => h('div', null, `${title}|${message}|`, children),
    Button: ({ children, onClick }: { children: unknown; onClick: () => void }) => h('button', { onClick }, children),
  }
})

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mockRoom = null
  mockConnected = false
  mockRouter.push.mockClear()
})

async function renderGate(status: object) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = jest.fn().mockResolvedValue({ json: async () => status })
  const host = document.createElement('div')
  const root = createRoot(host)
  const render = () => act(async () => root.render(createElement(TranslateGate, null, 'features')))
  await render()
  return {
    host,
    render,
    async cleanup() {
      await act(async () => root.unmount())
      globalThis.fetch = originalFetch
    },
  }
}

test.each([
  ['Edge', { canUseDisk: false, ready: false }, 'translate.needGameTitle|translate.needGameCloudMsg|common.chooseGame'],
  ['local', { canUseDisk: true, ready: false, library: [{ id: 'game' }] }, 'translate.needGameTitle|translate.needGameMsg|common.chooseGame'],
])('%s without a selected game shows an empty hint instead of features', async (_mode, status, expected) => {
  mockConnected = true
  const gate = await renderGate(status)
  try {
    expect(gate.host.textContent).toBe(expected)
    await act(async () => gate.host.querySelector('button')?.click())
    expect(mockRouter.push).toHaveBeenCalledWith('/game')
  } finally {
    await gate.cleanup()
  }
})

test('local selected game opens features without a running game', async () => {
  const gate = await renderGate({ canUseDisk: true, ready: true, library: [{ id: 'game' }] })
  try {
    expect(gate.host.textContent).toBe('features')
  } finally {
    await gate.cleanup()
  }
})

test.each([
  ['Edge', { canUseDisk: false, ready: false }],
  ['remote', { canUseDisk: true, ready: true, remote: true, library: [{ id: 'game' }] }],
])('%s selected game needs a connection', async (_mode, status) => {
  mockRoom = 'selected-game'
  const gate = await renderGate(status)
  try {
    expect(gate.host.textContent).toBe('translate.needLinkTitle|translate.needLinkMsg|translate.openLibrary')
    mockConnected = true
    await gate.render()
    expect(gate.host.textContent).toBe('features')
    mockConnected = false
    await gate.render()
    expect(gate.host.textContent).toContain('translate.needLinkTitle')
  } finally {
    await gate.cleanup()
  }
})
