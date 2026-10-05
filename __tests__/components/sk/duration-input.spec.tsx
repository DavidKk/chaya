/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { DurationInput, type DurationInputProps } from '@/components/sk/DurationInput'
import { durationParts } from '@/lib/duration'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

async function render(props: Partial<DurationInputProps> & { value: number }) {
  const onValueChange = jest.fn()
  await act(async () => root.render(<DurationInput onValueChange={onValueChange} {...props} />))
  return { input: host.querySelector('input')!, onValueChange }
}

function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('splits milliseconds into units', () => {
  expect(durationParts(90_500)).toEqual([
    { unit: 'min', n: 1 },
    { unit: 'sec', n: 30 },
    { unit: 'ms', n: 500 },
  ])
  expect(durationParts(0)).toEqual([])
})

it('shows the converted duration and follows typing', async () => {
  const { input } = await render({ value: 8000 })
  expect(host.textContent).toContain('8 sec')
  await act(async () => {
    input.focus()
    type(input, '3600000')
  })
  expect(host.textContent).toContain('1 hr')
})

it('uses zeroLabel and label overrides', async () => {
  await render({ value: 0, zeroLabel: '立即释放' })
  expect(host.textContent).toContain('立即释放')
  await render({ value: 1000, label: '常驻' })
  expect(host.textContent).toContain('常驻')
  expect(host.textContent).not.toContain('1 sec')
})

it('steps by the given step and clamps to bounds', async () => {
  const { input, onValueChange } = await render({ value: 29_000, min: 2000, max: 30_000, step: 1000 })
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true }))
  })
  expect(onValueChange).toHaveBeenLastCalledWith(30_000)
})
