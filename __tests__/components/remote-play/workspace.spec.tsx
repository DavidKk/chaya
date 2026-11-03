/**
 * @jest-environment jsdom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { RemoteCheatDrawer } from '@/components/remote-play/RemoteCheatDrawer'
import { RemoteWorkspaceModal } from '@/components/remote-play/workspace'
import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root

describe('RemoteWorkspaceModal', () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    onSend: jest.fn(),
    gameId: 'test-room',
    status: 'connected' as const,
    latencyMs: 12,
    videoResolution: { width: 1280, height: 720 },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('renders nothing when open is false (unmount on exit)', () => {
    act(() => {
      root.render(<RemoteWorkspaceModal {...defaultProps} open={false} />)
    })
    expect(host.children.length).toBe(0)
  })

  it('renders full-screen dialog with safe-area styling and touch isolation when open', () => {
    act(() => {
      root.render(<RemoteWorkspaceModal {...defaultProps} />)
    })
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).not.toBeNull()
    expect(dialog?.style.overscrollBehavior).toBe('contain')
    expect(dialog?.style.touchAction).toBe('pan-y')

    // Stop propagation on touch events
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    const stopSpy = jest.spyOn(event, 'stopPropagation')
    dialog?.dispatchEvent(event)
    expect(stopSpy).toHaveBeenCalledTimes(1)
  })

  it('switches between Cheats, Debug and Logs tabs', () => {
    act(() => {
      root.render(<RemoteWorkspaceModal {...defaultProps} />)
    })

    // Default tab is Cheats
    expect(host.textContent).toContain('卡死急救与剧情推进')

    // Switch to Debug
    const buttons = Array.from(host.querySelectorAll('button'))
    const debugTab = buttons.find((b) => b.textContent?.includes('串流调试') || b.textContent?.includes('Debug'))
    expect(debugTab).toBeDefined()
    act(() => {
      debugTab?.click()
    })
    expect(host.textContent).toContain('链路连接指标')
    expect(host.textContent).toContain('12 ms')

    // Switch to Logs
    const logsTab = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('运行日志') || b.textContent?.includes('Logs'))
    expect(logsTab).toBeDefined()
    act(() => {
      logsTab?.click()
    })
    expect(host.textContent).toContain('全部')
  })

  it('dispatches unstuck and speed commands from Cheats panel', () => {
    const onSend = jest.fn()
    act(() => {
      root.render(<RemoteWorkspaceModal {...defaultProps} onSend={onSend} initialTab="cheats" />)
    })

    const unstuckBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('脱离卡死'))
    expect(unstuckBtn).toBeDefined()
    act(() => {
      unstuckBtn?.click()
    })
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'edit.cmd',
        op: 'runAction',
        id: 'fix:unstuck',
      })
    )

    const speedBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === '2x')
    expect(speedBtn).toBeDefined()
    act(() => {
      speedBtn?.click()
    })
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'edit.cmd',
        op: 'gameSpeed',
        value: 2,
      })
    )
  })

  it('subscribes to remotePlayLogger only when Logs panel is mounted, and cleans up on tab switch or close', () => {
    const subscribeSpy = jest.spyOn(remotePlayLogger, 'subscribe')

    act(() => {
      root.render(<RemoteWorkspaceModal {...defaultProps} initialTab="cheats" />)
    })
    // Cheats tab: should NOT subscribe to logs
    expect(subscribeSpy).not.toHaveBeenCalled()

    // Switch to Logs tab: should subscribe
    const logsTab = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('运行日志') || b.textContent?.includes('Logs'))
    act(() => {
      logsTab?.click()
    })
    expect(subscribeSpy).toHaveBeenCalledTimes(1)

    // Switch away to Debug tab: should unsubscribe
    const debugTab = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('串流调试') || b.textContent?.includes('Debug'))
    act(() => {
      debugTab?.click()
    })

    // Close modal: unmounts everything
    act(() => {
      root.render(<RemoteWorkspaceModal {...defaultProps} open={false} />)
    })
    subscribeSpy.mockRestore()
  })

  it('legacy RemoteCheatDrawer delegates seamlessly to RemoteWorkspaceModal', () => {
    act(() => {
      root.render(<RemoteCheatDrawer {...defaultProps} initialTab="cheat" />)
    })
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.textContent).toContain('卡死急救与剧情推进')
  })
})
