/** @jest-environment jsdom */
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'

import { Button } from '@/components/sk/Button'

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((media: string) => ({ matches: true, media, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
})

test('icon buttons keep their forwarded ref and hide the tooltip while suppressed', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const ref = createRef<HTMLButtonElement>()
  const render = (suppressed: boolean) =>
    act(async () =>
      root.render(
        <Button ref={ref} size="mini" aria-label="透明度" tooltipSuppressed={suppressed}>
          x
        </Button>
      )
    )
  try {
    await render(false)
    const button = host.querySelector('button')!
    expect(ref.current).toBe(button)
    await act(async () => button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('透明度')

    await render(true)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(host.querySelector('button')).toBe(button)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
