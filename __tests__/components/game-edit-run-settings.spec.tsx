/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { emptySession } from '@/components/game-edit/types'
import { GameEditRunSettings } from '@/components/GameEditRunSettings'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { MESSAGES, translate } from '@/lib/i18n'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let canHover = true
const onFlagChange = jest.fn()

beforeAll(() => {
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({
      get matches() {
        return canHover
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  })
})

async function render(readOnly = false) {
  onFlagChange.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const noop = () => {}
  await act(async () =>
    root.render(
      <LocaleProvider initialLocale="zh" initialPreference="zh">
        <GameEditRunSettings
          value={{ ...emptySession(), goldLocked: false }}
          onGoldChange={noop}
          onGoldLockChange={noop}
          onMoveRateChange={noop}
          onGameSpeedChange={noop}
          onExpRateChange={noop}
          onFlagChange={onFlagChange}
          readOnly={readOnly}
          onAction={noop}
        />
      </LocaleProvider>
    )
  )
}

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const hint = () => translate(MESSAGES.zh, 'edit.flagAutoWinHint')
const helpButton = () => document.querySelector('button[aria-label="自动胜利说明"]') as HTMLButtonElement

it('explains the auto win risk on hover without toggling the switch', async () => {
  canHover = true
  await render()
  expect(document.querySelectorAll('button[aria-label$="说明"]')).toHaveLength(1)
  await act(async () => helpButton().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(hint())
  await act(async () => helpButton().click())
  expect(onFlagChange).not.toHaveBeenCalled()
})

it('opens the explanation on tap without toggling the switch on touch screens', async () => {
  canHover = false
  await render()
  await act(async () => helpButton().click())
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(hint())
  expect(onFlagChange).not.toHaveBeenCalled()
})

it('disables every control in read-only mode', async () => {
  canHover = true
  await render(true)
  const autoWin = document.querySelector('button[role="switch"][aria-label="自动胜利"]') as HTMLButtonElement
  expect(autoWin.disabled).toBe(true)
  expect((document.querySelector('input[aria-label="金钱"]') as HTMLInputElement).disabled).toBe(true)
  await act(async () => (autoWin.closest('div')?.parentElement?.querySelector('span') as HTMLElement).click())
  expect(onFlagChange).not.toHaveBeenCalled()
  expect(helpButton().disabled).toBe(false)
})
