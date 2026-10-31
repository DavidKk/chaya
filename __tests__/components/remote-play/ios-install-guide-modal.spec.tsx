/**
 * @jest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { IosInstallGuideModal } from '@/components/remote-play/IosInstallGuideModal'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

describe('IosInstallGuideModal', () => {
  it('does not render when open is false', () => {
    act(() => {
      root.render(<IosInstallGuideModal open={false} onClose={jest.fn()} />)
    })
    expect(host.children.length).toBe(0)
  })

  it('renders iOS installation steps when in browser mode', () => {
    const onClose = jest.fn()
    act(() => {
      root.render(<IosInstallGuideModal open={true} onClose={onClose} isStandalone={false} />)
    })

    expect(host.textContent).toContain('iOS Safari 全屏指引')
    expect(host.textContent).toContain('点击 Safari「分享」按钮')
    expect(host.textContent).toContain('选择「添加到主屏幕」')
    expect(host.textContent).toContain('从手机桌面打开游戏')

    const confirmBtn = host.querySelector('button')
    expect(confirmBtn).not.toBeNull()
  })

  it('renders standalone confirmation when launched from home screen', () => {
    act(() => {
      root.render(<IosInstallGuideModal open={true} onClose={jest.fn()} isStandalone={true} />)
    })

    expect(host.textContent).toContain('已处于独立全屏模式')
    expect(host.textContent).toContain('已检测到 Web App 独立运行状态')
  })

  it('calls onClose when clicking close button', () => {
    const onClose = jest.fn()
    act(() => {
      root.render(<IosInstallGuideModal open={true} onClose={onClose} />)
    })

    const closeBtn = host.querySelector('button[aria-label="关闭"]') as HTMLButtonElement
    expect(closeBtn).not.toBeNull()
    act(() => {
      closeBtn.click()
    })
    expect(onClose).toHaveBeenCalled()
  })
})
