/** @jest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { RequireBoundGame } from '@/components/RequireBoundGame'

let mockRoom: string | null = null
let mockConnected = false
const mockNotify = { info: jest.fn(), error: jest.fn(), success: jest.fn() }
const mockRouter = { push: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('@/components/GameLinkProvider', () => ({ useGameLinkContext: () => ({ roomId: mockRoom, connected: mockConnected }) }))
jest.mock('@/components/notification/useNotification', () => ({ useNotification: () => mockNotify }))
jest.mock('@/components/ChooseGameGate', () => ({ ChooseGameGate: () => 'choose-game' }))
jest.mock('@/components/sk/Skeleton', () => ({ Skeleton: () => null, SkeletonRegion: () => null }))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mockRoom = null
  mockConnected = false
})

test.each([
  ['Edge', { canUseDisk: false, ready: false }],
  ['local', { canUseDisk: true, ready: true, library: [{ id: 'game' }] }],
])('%s requires a connection and returns to selection on disconnect', async (_mode, status) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = jest.fn().mockResolvedValue({ json: async () => status })
  const host = document.createElement('div')
  const root = createRoot(host)
  mockRoom = 'selected-game'
  try {
    await act(async () => root.render(createElement(RequireBoundGame, null, 'features')))
    expect(host.textContent).toBe('choose-game')
    mockConnected = true
    await act(async () => root.render(createElement(RequireBoundGame, null, 'features')))
    expect(host.textContent).toBe('features')
    mockConnected = false
    await act(async () => root.render(createElement(RequireBoundGame, null, 'features')))
    expect(host.textContent).toBe('choose-game')
    mockConnected = true
    await act(async () => root.render(createElement(RequireBoundGame, null, 'features')))
    expect(host.textContent).toBe('features')
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = originalFetch
  }
})

test.each([
  ['Edge', { canUseDisk: false, ready: false }],
  ['local', { canUseDisk: true, ready: false, library: [] }],
])('%s does not show features without a selected game', async (_mode, status) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = jest.fn().mockResolvedValue({ json: async () => status })
  const host = document.createElement('div')
  const root = createRoot(host)
  mockConnected = true
  try {
    await act(async () => root.render(createElement(RequireBoundGame, null, 'features')))
    expect(host.textContent).toBe('choose-game')
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = originalFetch
  }
})
