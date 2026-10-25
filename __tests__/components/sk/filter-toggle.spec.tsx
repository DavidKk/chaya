/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { FilterToggle } from '@/components/sk/FilterToggle'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test.each([
  ['switch', true, 'aria-checked'],
  ['button', true, 'aria-pressed'],
] as const)('%s role exposes its pressed state', async (role, pressed, attribute) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <FilterToggle role={role} pressed={pressed} onPressedChange={() => {}}>
          待确认
        </FilterToggle>
      )
    )
    const button = host.querySelector('button')!
    expect(button.getAttribute(attribute)).toBe('true')
    expect(button.className).toContain('after:w-3')
    expect(button.className).toContain('after:bg-accent')
    expect(button.className).not.toMatch(/(^|\s)bg-accent(\s|$)/)
    expect(button.className).toContain('text-accent')
    expect(button.className).toContain('hover:enabled:text-accent')
    expect(button.className).not.toContain('hover:enabled:text-ink')
    expect(button.className).toContain('bg-transparent')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('toggles through the shared pressed callback', async () => {
  const onPressedChange = jest.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <FilterToggle pressed={false} onPressedChange={onPressedChange}>
          待确认
        </FilterToggle>
      )
    )
    await act(async () => host.querySelector('button')!.click())
    expect(onPressedChange).toHaveBeenCalledWith(true)
    expect(host.querySelector('button')!.className).toContain('after:hidden')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
