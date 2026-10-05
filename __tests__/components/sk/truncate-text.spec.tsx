/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { TruncateText } from '@/components/sk/TruncateText'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
})

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

function sized(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
}

async function hover(el: HTMLElement) {
  await act(async () => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
}

test('shows the full text in a tooltip only when it is cut off', async () => {
  await act(async () => root.render(<TruncateText text="一个非常非常长的地图名称" />))
  const span = host.querySelector('span')!
  expect(span.className).toContain('truncate')
  expect(span.getAttribute('title')).toBeNull()

  sized(span, 100, 100)
  await hover(span)
  expect(document.querySelector('[role="tooltip"]')).toBeNull()

  await act(async () => span.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
  sized(span, 240, 100)
  await hover(span)
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('一个非常非常长的地图名称')
})

test('uses a custom tip when given', async () => {
  await act(async () => root.render(<TruncateText text="地下城" tip="世界 › 地下城" />))
  const span = host.querySelector('span')!
  sized(span, 240, 100)
  await hover(span)
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('世界 › 地下城')
})
