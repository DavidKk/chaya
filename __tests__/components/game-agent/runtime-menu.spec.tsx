/** @jest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameAgentRuntimeMenu } from '@/components/game-agent/GameAgentRuntimeMenu'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'

const profiles = [
  {
    id: 'local',
    label: 'Local Ollama',
    online: true,
    defaultModel: 'model-1',
    models: Array.from({ length: 11 }, (_, index) => ({ name: `model-${index + 1}` })),
  },
  {
    id: 'office',
    label: 'Office Ollama',
    online: true,
    defaultModel: 'office-model',
    models: [{ name: 'office-model' }],
  },
]

let host: HTMLDivElement
let root: Root

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

test('combines provider and model into one searchable runtime menu', async () => {
  function Harness() {
    const [selection, setSelection] = useState({ profileId: 'local', model: 'model-1' })
    return (
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameAgentRuntimeMenu profiles={profiles} {...selection} onChange={(profileId, model) => setSelection({ profileId, model })} />
      </LocaleProvider>
    )
  }

  await act(async () => root.render(<Harness />))
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="选择平台与模型"]')!
  expect(trigger.parentElement?.className).toContain('max-w-40')
  expect(trigger.className).toContain('overflow-hidden')
  expect(trigger.querySelector('span')?.className).toContain('truncate')
  expect(trigger.textContent).toContain('Local Ollama · model-1')

  await act(async () => trigger.click())
  const modelRow = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('模型model-1'))!
  await act(async () => modelRow.click())
  expect(document.querySelector('input[type="search"]')).not.toBeNull()

  const modelEleven = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('model-11'))!
  await act(async () => modelEleven.click())
  expect(trigger.textContent).toContain('Local Ollama · model-11')
})
