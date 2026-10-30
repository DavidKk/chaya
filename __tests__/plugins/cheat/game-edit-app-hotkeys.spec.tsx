/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { GameEditApp } from '@/plugins/mv/src/cheat/ui/App'

jest.mock('@/plugins/mv/src/helpers/node/node-require', () => ({ tryNodeFsPath: () => null, tryNodeRequire: () => null }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

beforeAll(() => {
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  })
})

describe('GameEditApp hotkeys', () => {
  let host: HTMLDivElement
  let root: Root
  const onRequestClose = jest.fn()
  const onRequestOpen = jest.fn()

  beforeEach(() => {
    onRequestClose.mockClear()
    onRequestOpen.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  it('blurs focused input on first Escape, then closes panel on second Escape', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider syncDocumentLang={false}>
          <GameEditApp open={true} onRequestOpen={onRequestOpen} onRequestClose={onRequestClose} />
        </LocaleProvider>
      )
    })

    const inputs = host.querySelectorAll<HTMLInputElement>('input')
    expect(inputs.length).toBeGreaterThan(0)
    const input = inputs[0]

    // 1. Focus input
    await act(async () => {
      input.focus()
    })
    expect(document.activeElement).toBe(input)

    // 2. Press Escape while input is focused -> should blur input, but NOT close panel
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).not.toBe(input)
    expect(onRequestClose).not.toHaveBeenCalled()

    // 3. Press Escape again while no input is focused -> should close panel
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(onRequestClose).toHaveBeenCalledTimes(1)
  })

  it('closes panel when Backquote hotkey is pressed even while input is focused', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider syncDocumentLang={false}>
          <GameEditApp open={true} onRequestOpen={onRequestOpen} onRequestClose={onRequestClose} />
        </LocaleProvider>
      )
    })

    const input = host.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      input.focus()
    })
    expect(document.activeElement).toBe(input)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', bubbles: true, cancelable: true }))
    })
    expect(onRequestClose).toHaveBeenCalledTimes(1)
  })

  it('does not close panel on Escape if an open dialog is present and no input is focused', async () => {
    await act(async () => {
      root.render(
        <LocaleProvider syncDocumentLang={false}>
          <GameEditApp open={true} onRequestOpen={onRequestOpen} onRequestClose={onRequestClose} />
        </LocaleProvider>
      )
    })

    // Simulate an open modal dialog inside the document
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(onRequestClose).not.toHaveBeenCalled()

    dialog.remove()
  })
})
