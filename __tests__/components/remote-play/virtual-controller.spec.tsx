/**
 * @jest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { VirtualController } from '@/components/remote-play/VirtualController'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

if (typeof globalThis.PointerEvent === 'undefined') {
  class MockPointerEvent extends MouseEvent {
    pointerId = 0
    constructor(type: string, init?: any) {
      super(type, init)
      this.pointerId = init?.pointerId ?? 0
    }
  }
  globalThis.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent
}

let host: HTMLDivElement
let root: Root

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

describe('VirtualController (analog joystick & action buttons)', () => {
  it('renders analog joystick and action buttons with accessible labels', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} mode="fixed" />)
    })

    const joystick = host.querySelector('[role="slider"][aria-label="虚拟摇杆"]')
    expect(joystick).not.toBeNull()

    const confirmBtn = host.querySelector('button[aria-label="确认"]')
    expect(confirmBtn).not.toBeNull()

    const cancelBtn = host.querySelector('button[aria-label="取消"]')
    expect(cancelBtn).not.toBeNull()

    const dashBtn = host.querySelector('button[aria-label="加速"]')
    expect(dashBtn).not.toBeNull()

    const menuBtn = host.querySelector('button[aria-label="菜单"]')
    expect(menuBtn).not.toBeNull()
  })

  it('handles action button press and release', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} mode="fixed" />)
    })

    const confirmBtn = host.querySelector('button[aria-label="确认"]') as HTMLButtonElement
    confirmBtn.setPointerCapture = jest.fn()
    confirmBtn.releasePointerCapture = jest.fn()

    act(() => {
      confirmBtn.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }))
    })
    expect(onInput).toHaveBeenCalledWith('ok', 'down')

    act(() => {
      confirmBtn.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    })
    expect(onInput).toHaveBeenCalledWith('ok', 'up')
  })

  it('triggers joystick directional inputs when pointer moves past threshold in fixed mode', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} mode="fixed" />)
    })

    const joystick = host.querySelector('[role="slider"]') as HTMLDivElement
    joystick.setPointerCapture = jest.fn()
    joystick.releasePointerCapture = jest.fn()

    joystick.getBoundingClientRect = jest.fn(() => ({
      left: 100,
      top: 100,
      width: 152,
      height: 152,
      right: 252,
      bottom: 252,
      x: 100,
      y: 100,
      toJSON: () => {},
    }))

    // Center is (176, 176). Drag down: clientY = 210 -> dy = +34 > threshold
    act(() => {
      joystick.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 176, clientY: 210, bubbles: true }))
    })
    expect(onInput).toHaveBeenCalledWith('down', 'down')

    act(() => {
      joystick.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    })
    expect(onInput).toHaveBeenCalledWith('down', 'up')
  })

  it('renders nothing when mode is touch', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} mode="touch" />)
    })

    const joystick = host.querySelector('[role="slider"]')
    expect(joystick).toBeNull()
    const confirmBtn = host.querySelector('button[aria-label="确认"]')
    expect(confirmBtn).toBeNull()
  })

  it('renders dynamic touch interception area and action buttons in dynamic mode', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} mode="dynamic" />)
    })

    const dynamicArea = host.querySelector('[role="slider"][aria-label="虚拟摇杆"]') as HTMLDivElement
    expect(dynamicArea).not.toBeNull()
    expect(dynamicArea.className).toContain('w-[55%]')

    dynamicArea.setPointerCapture = jest.fn()
    dynamicArea.releasePointerCapture = jest.fn()

    // Touch down at (200, 300) and drag to (200, 340) -> down
    act(() => {
      dynamicArea.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 200, clientY: 300, bubbles: true }))
    })
    act(() => {
      dynamicArea.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 200, clientY: 340, bubbles: true }))
    })
    expect(onInput).toHaveBeenCalledWith('down', 'down')

    act(() => {
      dynamicArea.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }))
    })
    expect(onInput).toHaveBeenCalledWith('down', 'up')

    const confirmBtn = host.querySelector('button[aria-label="确认"]')
    expect(confirmBtn).not.toBeNull()
  })

  it('renders scaled sizes in portrait mode', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} isPortrait={true} mode="fixed" />)
    })

    const joystick = host.querySelector('[role="slider"][aria-label="虚拟摇杆"]')
    expect(joystick).not.toBeNull()
    expect(joystick?.className).toContain('h-32 w-32')

    const confirmBtn = host.querySelector('button[aria-label="确认"]')
    expect(confirmBtn?.className).toContain('h-15 w-15')
  })
})
