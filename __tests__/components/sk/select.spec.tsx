/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { Select, type SelectOption } from '@/components/sk/Select'

let host: HTMLDivElement
let root: Root

function options(count: number): SelectOption[] {
  return Array.from({ length: count }, (_, index) => ({ value: `model-${index + 1}`, label: `Model ${index + 1}` }))
}

async function render(selectOptions: SelectOption[], onChange = jest.fn()) {
  await act(async () => {
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <Select value="" options={selectOptions} onChange={onChange} aria-label="模型" />
      </LocaleProvider>
    )
  })
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="模型"]')!
  trigger.getBoundingClientRect = () => ({ left: 10, right: 210, top: 10, bottom: 42, width: 200, height: 32 }) as DOMRect
  await act(async () => trigger.click())
  return { trigger, onChange }
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  })
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

test('ten options open directly without a search field', async () => {
  await render(options(10))
  expect(document.querySelector('[role="listbox"]')).not.toBeNull()
  expect(document.querySelector('input[type="search"]')).toBeNull()
})

test('more than ten options show search and filter selectable results', async () => {
  const onChange = jest.fn()
  await render(options(11), onChange)
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
  expect(search).not.toBeNull()
  expect(document.activeElement).toBe(search)

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Model 11')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const visible = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
  expect(visible.map((option) => option.textContent)).toEqual(['Model 11'])
  await act(async () => visible[0].click())
  expect(onChange).toHaveBeenCalledWith('model-11')
})

test('selects an option from a ShadowRoot without being dismissed as an outside click', async () => {
  const shadowHost = document.createElement('div')
  const shadow = shadowHost.attachShadow({ mode: 'open' })
  document.body.appendChild(shadowHost)
  const shadowRoot = createRoot(shadow)
  const onChange = jest.fn()

  await act(async () => {
    shadowRoot.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <Select
          value=""
          options={[
            { value: 'gemma4:e4b', label: 'gemma4:e4b' },
            { value: 'qwen3:4b', label: 'qwen3:4b' },
          ]}
          onChange={onChange}
          aria-label="模型"
        />
      </LocaleProvider>
    )
  })

  const trigger = shadow.querySelector<HTMLButtonElement>('button[aria-label="模型"]')!
  trigger.getBoundingClientRect = () => ({ left: 10, right: 210, top: 10, bottom: 42, width: 200, height: 32 }) as DOMRect
  await act(async () => trigger.click())
  const option = [...shadow.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes('gemma4:e4b'))!
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
  })

  expect(onChange).toHaveBeenCalledWith('gemma4:e4b')
  await act(async () => shadowRoot.unmount())
})
