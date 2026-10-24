/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Switch } from '@/components/sk/Switch'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('Switch', () => {
  let host: HTMLDivElement
  let root: Root
  let checked = false
  const onCheckedChange = jest.fn((next: boolean) => {
    checked = next
  })

  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn((media: string) => ({ matches: false, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
    })
  })

  beforeEach(async () => {
    checked = false
    onCheckedChange.mockClear()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await renderSwitch()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('toggles when clicking the label or description', async () => {
    await act(async () => host.querySelector('[id$="-label"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)

    await renderSwitch()
    await act(async () => host.querySelector('[id$="-desc"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
  })

  it('toggles once when clicking the switch itself', async () => {
    await act(async () => host.querySelector('[role="switch"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  function renderSwitch() {
    return act(async () => root.render(<Switch label="游戏内：译文" description="切换游戏内显示内容" checked={checked} onCheckedChange={onCheckedChange} />))
  }
})
