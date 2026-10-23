/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { useGameToolTransport } from '@/components/game-tools/transport'
import { DEFAULT_TOOL_SETTINGS } from '@/lib/game-agent/tool-settings'
import { RgssOverlayRoot } from '@/plugins/rgss/src/Overlay'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
jest.mock('@/components/game-tools/useToolSettings', () => ({
  useToolSettings: () => ({ settings: { ...DEFAULT_TOOL_SETTINGS, panelDockEnabled: false, quickSavePanelEnabled: true }, update: jest.fn(), loaded: true }),
}))
jest.mock('@/plugins/shared/FloatingGameSaves', () => ({
  FloatingGameSaves: () => {
    const transport = useGameToolTransport()
    return <span data-room={transport.roomId}>save transport ready</span>
  },
}))
jest.mock('@/plugins/rgss/src/Workbench', () => ({
  RgssWorkbench: ({ open: _open, onClose }: { open?: boolean; onClose?: () => void }) => (
    <div data-testid="rgss-workbench-mock" data-rgss-interactive className="pointer-events-auto flex min-h-0 flex-1 flex-col">
      <button data-testid="mock-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))
jest.mock('@/plugins/rgss/src/MiniMap', () => ({ RgssMiniMap: () => null }))
jest.mock('@/plugins/rgss/src/webrtc-gateway', () => ({
  RgssWebRtcGateway: class {
    start() {}
    stop() {}
  },
}))

it('provides the native transport when the quick-save panel is enabled', async () => {
  Object.assign(window, { __CHAYA_RGSS_CONFIG__: { roomId: 'native-room' } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<RgssOverlayRoot />))
    expect(host.querySelector('[data-room="native-room"]')?.textContent).toBe('save transport ready')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it('sets data-open on the overlay host container and renders centered in-flow workbench on toggle', async () => {
  const container = document.createElement('div')
  container.id = 'chaya-rgss-overlay-container'
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<RgssOverlayRoot />))
    expect(container.hasAttribute('data-open')).toBe(false)
    expect(container.querySelector('[data-testid="rgss-workbench-mock"]')).toBeNull()

    // Toggle open
    await act(async () => document.dispatchEvent(new Event('chaya:toggle')))
    expect(container.hasAttribute('data-open')).toBe(true)
    const workbench = container.querySelector('[data-testid="rgss-workbench-mock"]')
    expect(workbench).not.toBeNull()
    expect(workbench?.className).toContain('flex min-h-0 flex-1 flex-col')
    expect(workbench?.className).not.toContain('inset-y-0 right-0')

    // Close via onClose
    const closeBtn = container.querySelector<HTMLButtonElement>('[data-testid="mock-close"]')
    await act(async () => closeBtn?.click())
    expect(container.hasAttribute('data-open')).toBe(false)
    expect(container.querySelector('[data-testid="rgss-workbench-mock"]')?.parentElement?.style.display).toBe('none')

    // Toggle open and close via chaya:esc
    await act(async () => document.dispatchEvent(new Event('chaya:toggle')))
    expect(container.hasAttribute('data-open')).toBe(true)
    await act(async () => document.dispatchEvent(new Event('chaya:esc')))
    expect(container.hasAttribute('data-open')).toBe(false)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
