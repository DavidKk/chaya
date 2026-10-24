/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { TranslateOptimizeMenu } from '@/components/translate/TranslateOptimizeMenu'

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
})

it('offers name optimization and sentence sync as separate menu actions', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onOptimizeNames = jest.fn()
  const onSyncNames = jest.fn()
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateOptimizeMenu disabled={false} optimizingNames={false} syncingNames={false} onOptimizeNames={onOptimizeNames} onSyncNames={onSyncNames} />
        </LocaleProvider>
      )
    )
    expect(host.querySelector('button')?.dataset.variant).toBeUndefined()
    await act(async () => host.querySelector('button')!.click())
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual(['优化名称', '同步到句子'])
    await act(async () => items[0].click())
    expect(onOptimizeNames).toHaveBeenCalledTimes(1)
    expect(onSyncNames).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
