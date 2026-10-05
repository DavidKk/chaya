/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { HubNav, HubNavItem, HubNavSection } from '@/components/integration/Hub'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('keeps the compact navigation rail and its icon buttons at fixed square sizes', async () => {
  await act(async () =>
    root.render(
      <HubNav label="Tools">
        <HubNavSection>
          <HubNavItem active icon={<span>i</span>} label="Overview" onSelect={() => {}} />
        </HubNavSection>
      </HubNav>
    )
  )

  const nav = host.querySelector('nav')!
  const button = host.querySelector('button')!

  expect(nav.className).toContain('w-14')
  expect(nav.className).toContain('shrink-0')
  expect(nav.className).toContain('md:w-44')
  expect(button.className).toContain('size-10')
  expect(button.className).toContain('shrink-0')
  expect(button.className).toContain('md:w-full')
  expect(button.className).toContain('md:h-auto')
})
