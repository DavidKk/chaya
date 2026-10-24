/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { postToGame } from '@/plugins/rgss/src/host-bridge'
import { SubtitleOverlay } from '@/plugins/rgss/src/SubtitleOverlay'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mockListeners = new Set<(msg: any) => void>()

jest.mock('@/plugins/rgss/src/host-bridge', () => {
  return {
    postToGame: jest.fn(),
    onGameMessage: (handler: (msg: any) => void) => {
      mockListeners.add(handler)
      return () => mockListeners.delete(handler)
    },
  }
})

function emitGameMessage(msg: any) {
  for (const listener of mockListeners) listener(msg)
}

describe('SubtitleOverlay', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    jest.clearAllMocks()
  })

  it('renders nothing initially when there is no active dialogue', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SubtitleOverlay />))
      expect(host.querySelector('[data-subtitle-overlay]')).toBeNull()
      expect(host.querySelector('[data-realtime-pending]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('renders pending and translates in subtitle mode, without interactive classes', async () => {
    let resolveFetch: (val: any) => void = () => {}
    globalThis.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    ) as any

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SubtitleOverlay />))

      // Emit subtitle dialogue
      await act(async () => {
        emitGameMessage({
          type: 'translation.dialogue',
          key: 'hello-key',
          texts: ['Hello', 'World'],
          choices: ['Option 1'],
          mode: 'subtitle',
          timeoutMs: 5000,
        })
      })

      const overlay = host.querySelector('[data-subtitle-overlay]')
      expect(overlay).not.toBeNull()
      expect(overlay?.className).toContain('pointer-events-none')
      expect(overlay?.hasAttribute('data-rgss-interactive')).toBe(false)
      expect(overlay?.textContent).toContain('翻译中...')

      // Resolve translation
      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => ({
            items: [
              { source: 'Hello', zh: '你好' },
              { source: 'World', zh: '世界' },
              { source: 'Option 1', zh: '选项一' },
            ],
          }),
        })
      })

      expect(overlay?.textContent).toContain('你好')
      expect(overlay?.textContent).toContain('世界')
      expect(overlay?.textContent).toContain('选项一')

      // Close message
      await act(async () => {
        emitGameMessage({ type: 'translation.dialogue.close' })
      })
      expect(host.querySelector('[data-subtitle-overlay]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('handles realtime mode and posts result back to game', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [{ source: 'Live dialog', zh: '实况对白' }],
      }),
    })) as any

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<SubtitleOverlay />))

      await act(async () => {
        emitGameMessage({
          type: 'translation.dialogue',
          key: 'realtime-key',
          texts: ['Live dialog'],
          choices: [],
          mode: 'realtime',
          timeoutMs: 5000,
        })
      })

      expect(postToGame).toHaveBeenCalledWith({
        type: 'translation.dialogue.result',
        key: 'realtime-key',
        texts: ['实况对白'],
        choices: [],
      })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
