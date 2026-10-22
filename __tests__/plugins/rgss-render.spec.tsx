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
jest.mock('@/plugins/rgss/src/Workbench', () => ({ RgssWorkbench: () => null }))
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
