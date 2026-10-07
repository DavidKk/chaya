/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { InputRecorderField } from '@/components/input-assistance/InputRecorderField'
import { isInputRecording } from '@/lib/game/input-assistance'

const reactAct = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('InputRecorderField inside the plugin ShadowRoot', () => {
  let host: HTMLDivElement
  let shadow: ShadowRoot
  let root: Root

  beforeEach(() => {
    reactAct.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    shadow = host.attachShadow({ mode: 'open' })
    const mount = document.createElement('div')
    shadow.append(mount)
    root = createRoot(mount)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    delete reactAct.IS_REACT_ACT_ENVIRONMENT
  })

  const button = (label: string) => [...shadow.querySelectorAll('button')].find((item) => item.getAttribute('aria-label')?.startsWith(label))!
  const fire = (target: EventTarget, event: Event) => act(() => void target.dispatchEvent(event))

  it('records plugin hotkeys as plain keys and ignores the finish click', () => {
    const onChange = jest.fn()
    act(() => root.render(<InputRecorderField label="触发键" kind="binding" value={[]} onChange={onChange} />))
    act(() => button('触发键').click())
    expect(isInputRecording()).toBe(true)

    const openPanel = new KeyboardEvent('keydown', { key: '`', code: 'Backquote', bubbles: true, cancelable: true, composed: true })
    fire(document.body, openPanel)
    expect(openPanel.defaultPrevented).toBe(true)
    fire(document.body, new KeyboardEvent('keyup', { key: '`', code: 'Backquote', bubbles: true, composed: true }))

    const finish = button('完成触发键录制')
    fire(finish, new MouseEvent('mousedown', { button: 0, bubbles: true, composed: true }))
    fire(finish, new MouseEvent('mouseup', { button: 0, bubbles: true, composed: true }))
    act(() => finish.click())

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ kind: 'key', code: 'Backquote' })])
    expect(onChange.mock.calls[0][0]).toHaveLength(1)
    expect(isInputRecording()).toBe(false)
  })
})
