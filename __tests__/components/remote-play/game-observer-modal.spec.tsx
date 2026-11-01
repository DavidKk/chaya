/**
 * @jest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameObserverModal } from '@/components/remote-play/GameObserverModal'
import type { CloudGameInstance } from '@/services/runtime/game-instance-manager'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root

const mockInstance: CloudGameInstance = {
  instanceId: 'inst_1234',
  pid: 1234,
  isMain: true,
  command: 'nwjs /game',
  gameTitle: 'Test Heroine Adventure',
  roomId: 'test-room-123',
  startedAt: Date.now() - 60000,
  webConnected: true,
  clientIp: '192.168.31.50',
  lastActiveAt: Date.now(),
  idleSeconds: 0,
  idleTimeoutSeconds: 300,
  remainingIdleSeconds: 300,
  runMode: 'cloud',
  screenshotUrl: '/api/remote/screenshot?roomId=test-room-123',
  streamUrl: '/play?room=test-room-123',
}

beforeEach(() => {
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

describe('GameObserverModal', () => {
  it('does not render when open is false', () => {
    act(() => {
      root.render(<GameObserverModal instance={mockInstance} open={false} onClose={jest.fn()} onTerminate={jest.fn()} />)
    })
    expect(host.children.length).toBe(0)
  })

  it('renders top-left icon buttons and video feed when open', () => {
    act(() => {
      root.render(<GameObserverModal instance={mockInstance} open={true} onClose={jest.fn()} onTerminate={jest.fn()} />)
    })

    expect(host.textContent).toContain('Test Heroine Adventure')
    expect(host.textContent).toContain('PID: 1234')
    expect(host.textContent).toContain('玩家在线')

    // Direct WebRTC video element (not an img element)
    const video = host.querySelector('video')
    expect(video).not.toBeNull()

    // No snapshot polling img
    const img = host.querySelector('img')
    expect(img).toBeNull()

    // Top-left icon buttons
    const buttons = host.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThanOrEqual(4)
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn()
    act(() => {
      root.render(<GameObserverModal instance={mockInstance} open={true} onClose={onClose} onTerminate={jest.fn()} />)
    })

    const closeBtn = host.querySelector('button[aria-label="关闭监看"]') as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    act(() => {
      closeBtn.click()
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onTerminate when terminate button is confirmed', async () => {
    const onTerminate = jest.fn().mockResolvedValue(undefined)
    jest.spyOn(window, 'confirm').mockReturnValue(true)

    act(() => {
      root.render(<GameObserverModal instance={mockInstance} open={true} onClose={jest.fn()} onTerminate={onTerminate} />)
    })

    const termBtn = host.querySelector('button[aria-label="终止游戏实例"]') as HTMLButtonElement
    expect(termBtn).not.toBeNull()
    await act(async () => {
      termBtn.click()
    })
    expect(onTerminate).toHaveBeenCalledWith(1234)
  })
})
