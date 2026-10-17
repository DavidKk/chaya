/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { API_KEY_SEALED_MASK, ApiKeyInput, resolveApiKeySaveAction } from '@/components/sk/ApiKeyInput'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('ApiKeyInput', () => {
  it('resolves keep / set / clear for save', () => {
    expect(resolveApiKeySaveAction({ unlocked: false, value: '' })).toEqual({ kind: 'keep' })
    expect(resolveApiKeySaveAction({ unlocked: false, value: '  sk-first  ' })).toEqual({ kind: 'set', token: 'sk-first' })
    expect(resolveApiKeySaveAction({ unlocked: true, value: '  sk-abc  ' })).toEqual({ kind: 'set', token: 'sk-abc' })
    expect(resolveApiKeySaveAction({ unlocked: true, value: '   ' })).toEqual({ kind: 'clear' })
  })

  it('shows a fixed mask when sealed and unlocks to plaintext on focus', async () => {
    let host: HTMLDivElement | null = document.createElement('div')
    document.body.appendChild(host)
    let root: Root | null = createRoot(host)
    let value = ''
    let unlocked = false
    const render = () => {
      if (!root) return
      root.render(
        <ApiKeyInput
          configured
          value={value}
          unlocked={unlocked}
          onUnlockedChange={(next) => {
            unlocked = next
          }}
          onChange={(next) => {
            value = next
          }}
          placeholder="sk-…"
        />
      )
    }

    await act(async () => {
      render()
    })
    const input = host.querySelector('input')
    expect(input?.value).toBe(API_KEY_SEALED_MASK)
    expect(input?.readOnly).toBe(true)

    await act(async () => {
      input?.focus()
      render()
    })
    expect(unlocked).toBe(true)
    expect(value).toBe('')
    const editing = host.querySelector('input')
    expect(editing?.value).toBe('')
    expect(editing?.readOnly).toBe(false)

    await act(async () => {
      value = 'sk-plain'
      render()
    })
    expect(host.querySelector('input')?.value).toBe('sk-plain')

    await act(async () => {
      root?.unmount()
    })
    host.remove()
    root = null
    host = null
  })
})
