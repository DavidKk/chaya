/** @jest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { CopyIconButton } from '@/components/translate/CopyIconButton'

jest.mock('@/components/i18n/LocaleProvider', () => ({
  useT: () => (key: string) => (key === 'common.copied' ? '已复制' : key === 'common.copy' ? '复制' : key),
}))

jest.mock('@/components/sk/Button', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': label,
    disabled,
    className,
  }: {
    children: ReactNode
    onClick?: (e: any) => void
    'aria-label'?: string
    disabled?: boolean
    className?: string
  }) => (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={className}>
      {children}
    </button>
  ),
}))

describe('CopyIconButton', () => {
  let host: HTMLDivElement
  let root: Root
  const originalClipboard = navigator.clipboard

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    jest.useFakeTimers()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    jest.useRealTimers()
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
  })

  it('copies text and displays checkmark feedback', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await act(async () => root.render(<CopyIconButton text="测试原文" />))
    const button = host.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('复制')

    await act(async () => button.click())
    expect(writeText).toHaveBeenCalledWith('测试原文')
    expect(button.getAttribute('aria-label')).toBe('已复制')

    await act(async () => {
      jest.advanceTimersByTime(1600)
    })
    expect(button.getAttribute('aria-label')).toBe('复制')
  })

  it('stops event propagation on click', async () => {
    const parentClick = jest.fn()
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await act(async () =>
      root.render(
        <div onClick={parentClick}>
          <CopyIconButton text="测试内容" />
        </div>
      )
    )
    const button = host.querySelector('button')!
    await act(async () => button.click())
    expect(parentClick).not.toHaveBeenCalled()
  })
})
