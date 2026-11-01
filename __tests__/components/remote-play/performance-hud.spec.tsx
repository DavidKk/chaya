/**
 * @jest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { PerformanceHud } from '@/components/remote-play/PerformanceHud'

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

describe('PerformanceHud', () => {
  it('renders in compact chip mode by default and expands on click', () => {
    act(() => {
      root.render(<PerformanceHud visible={true} fps={12} latencyMs={8} videoResolution={{ width: 1280, height: 720 }} status="connected" muted={false} isStandalone={true} />)
    })

    const compactChip = host.querySelector('button[title*="点击展开"]')
    expect(compactChip).not.toBeNull()
    expect(compactChip?.textContent).toContain('FPS')
    expect(compactChip?.textContent).toContain('12')
    expect(compactChip?.textContent).toContain('8ms')

    // Click to expand
    act(() => {
      compactChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(host.textContent).toContain('1280×720')
    expect(host.textContent).toContain('声画同步')
    expect(host.textContent).toContain('PWA')
  })

  it('does not invent a 60 fps reading before video stats arrive', () => {
    act(() => root.render(<PerformanceHud visible status="connected" muted={false} />))
    expect(host.textContent).toContain('--')
    expect(host.textContent).not.toContain('60')
  })
})
