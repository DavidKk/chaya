/** @jest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { GameLinkProvider } from '@/components/GameLinkProvider'
import { useGameLink } from '@/hooks/useGameLink'
import { selectCloudGameId } from '@/lib/browser/cloud-library'

jest.mock('@/hooks/useGameLink', () => ({ useGameLink: jest.fn(() => ({ connected: false, negotiating: false, restart: jest.fn(), quit: jest.fn(), send: jest.fn() })) }))

test('Edge restores the browser room, starts signaling, and follows selection without server binding', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const originalFetch = globalThis.fetch
  globalThis.fetch = jest.fn().mockResolvedValue({ json: async () => ({ canUseDisk: false, ready: false, library: [] }) })
  const root = createRoot(document.createElement('div'))
  try {
    selectCloudGameId('game-one')
    await act(async () => root.render(createElement(GameLinkProvider, null)))
    expect(useGameLink).toHaveBeenLastCalledWith(expect.objectContaining({ roomId: 'game-one', enabled: true, autoStart: true }))
    await act(async () => selectCloudGameId('game-two'))
    expect(useGameLink).toHaveBeenLastCalledWith(expect.objectContaining({ roomId: 'game-two', enabled: true, autoStart: true }))
    await act(async () => selectCloudGameId(null))
    expect(useGameLink).toHaveBeenLastCalledWith(expect.objectContaining({ roomId: null, enabled: false }))
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = originalFetch
    localStorage.clear()
  }
})
