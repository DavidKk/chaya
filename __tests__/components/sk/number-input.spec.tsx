/** @jest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { NumberInput, type NumberInputProps } from '@/components/sk/NumberInput'

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

function Harness({ initial, onChange, ...props }: Omit<NumberInputProps, 'value' | 'onValueChange'> & { initial: number; onChange: (v: number) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <NumberInput
      {...props}
      value={value}
      onValueChange={(v) => {
        setValue(v)
        onChange(v)
      }}
    />
  )
}

async function render(props: Omit<NumberInputProps, 'value' | 'onValueChange'> & { initial: number }) {
  const onChange = jest.fn()
  await act(async () => root.render(<Harness {...props} onChange={onChange} />))
  const input = host.querySelector('input')!
  return { input, onChange }
}

async function press(input: HTMLInputElement, key: string, shiftKey = false) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
  })
}

it('steps with ArrowUp / ArrowDown and Shift ×10 within bounds', async () => {
  const { input, onChange } = await render({ initial: 5, min: 0, max: 20 })
  await press(input, 'ArrowUp')
  expect(onChange).toHaveBeenLastCalledWith(6)
  await press(input, 'ArrowDown', true)
  expect(onChange).toHaveBeenLastCalledWith(0)
  onChange.mockClear()
  await press(input, 'ArrowDown')
  expect(onChange).not.toHaveBeenCalled()
  await press(input, 'ArrowUp', true)
  await press(input, 'ArrowUp', true)
  await press(input, 'ArrowUp', true)
  expect(onChange).toHaveBeenLastCalledWith(20)
})

it('uses decimal steps without float drift', async () => {
  const { input, onChange } = await render({ initial: 1, min: 0.25, max: 5, step: 0.1, allowDecimal: true })
  await press(input, 'ArrowUp')
  await press(input, 'ArrowUp')
  await press(input, 'ArrowUp')
  expect(onChange).toHaveBeenLastCalledWith(1.3)
  expect(input.value).toBe('1.3')
})
