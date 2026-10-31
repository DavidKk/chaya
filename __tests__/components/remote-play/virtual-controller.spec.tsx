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
  it('renders analog joystick, action buttons (Confirm, Cancel, Menu) and AssistiveTouch floating ball', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} mode="fixed" />)
    })

    const joystick = host.querySelector('[role="slider"][aria-label="虚拟摇杆"]')
    expect(joystick).not.toBeNull()

    // Action buttons
    const confirmBtn = host.querySelector('button[aria-label="确认"]')
    expect(confirmBtn).not.toBeNull()

    const cancelBtn = host.querySelector('button[aria-label="取消"]')
    expect(cancelBtn).not.toBeNull()

    const menuBtn = host.querySelector('button[aria-label="菜单"]')
    expect(menuBtn).not.toBeNull()

    // Removed buttons: Zap / Dash
    const dashBtn = host.querySelector('button[aria-label="加速"]')
    expect(dashBtn).toBeNull()

    // Draggable AssistiveTouch Floating Ball Trigger Button
    const configBtn = host.querySelector('button[aria-label="快捷配置"]')
    expect(configBtn).not.toBeNull()
  })

  it('expands shortcut dock on tapping config button and dispatches scene/drawer actions', () => {
    const onInput = jest.fn()
    const onAction = jest.fn()
    const onOpenDrawer = jest.fn()
    act(() => {
      root.render(
        <VirtualController
          onInput={onInput}
          onAction={onAction}
          onOpenDrawer={onOpenDrawer}
          visible={true}
          mode="fixed"
        />
      )
    })

    // Initially collapsed
    expect(host.querySelector('button[aria-label="背包"]')).toBeNull()

    const configBtn = host.querySelector('button[aria-label="快捷配置"]') as HTMLButtonElement
    act(() => {
      configBtn.click()
    })

    // Expanded shortcuts
    const itemBtn = host.querySelector('button[aria-label="背包"]') as HTMLButtonElement
    const equipBtn = host.querySelector('button[aria-label="装备"]')
    const saveBtn = host.querySelector('button[aria-label="存档"]')
    const loadBtn = host.querySelector('button[aria-label="读档"]')
    const autoTalkBtn = host.querySelector('button[aria-label="自动对话"]') as HTMLButtonElement
    const consoleBtn = host.querySelector('button[aria-label="控制台"]') as HTMLButtonElement

    expect(itemBtn).not.toBeNull()
    expect(equipBtn).not.toBeNull()
    expect(saveBtn).not.toBeNull()
    expect(loadBtn).not.toBeNull()
    expect(autoTalkBtn).not.toBeNull()
    expect(consoleBtn).not.toBeNull()

    // Tap backpack shortcut
    act(() => {
      itemBtn.click()
    })
    expect(onAction).toHaveBeenCalledWith('scene:item')
    // Automatically collapsed
    expect(host.querySelector('button[aria-label="背包"]')).toBeNull()

    // Re-open and tap autotalk
    act(() => {
      configBtn.click()
    })
    const autoTalkBtn2 = host.querySelector('button[aria-label="自动对话"]') as HTMLButtonElement
    act(() => {
      autoTalkBtn2.click()
    })
    expect(onAction).toHaveBeenCalledWith('flag:autotalk')
    expect(host.querySelector('button[aria-label="自动对话"]')).toBeNull()

    // Re-open and tap console
    act(() => {
      configBtn.click()
    })
    const consoleBtn2 = host.querySelector('button[aria-label="控制台"]') as HTMLButtonElement
    act(() => {
      consoleBtn2.click()
    })
    expect(onOpenDrawer).toHaveBeenCalled()
    expect(host.querySelector('button[aria-label="控制台"]')).toBeNull()
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

  it('renders single-right mode with comfortable margins away from screen edge', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} isPortrait={true} mode="single-right" />)
    })

    const confirmBtn = host.querySelector('button[aria-label="确认"]')
    expect(confirmBtn).not.toBeNull()

    const rightCluster = host.querySelector('.pr-6')
    expect(rightCluster).not.toBeNull()
    expect(rightCluster?.className).toContain('pb-4')
    expect(rightCluster?.className).toContain('gap-5')
  })

  it('renders single-left mode with comfortable margins away from screen edge', () => {
    const onInput = jest.fn()
    act(() => {
      root.render(<VirtualController onInput={onInput} visible={true} isPortrait={true} mode="single-left" />)
    })

    const confirmBtn = host.querySelector('button[aria-label="确认"]')
    expect(confirmBtn).not.toBeNull()

    const leftCluster = host.querySelector('.pl-6')
    expect(leftCluster).not.toBeNull()
    expect(leftCluster?.className).toContain('pb-4')
    expect(leftCluster?.className).toContain('gap-5')
  })
})
