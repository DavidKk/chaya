/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { TranslateExportMenu } from '@/components/translate/TranslateExportMenu'

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
})

it.each([
  ['全部导出', 'all'],
  ['导出未翻译的', 'untranslated'],
])('offers %s as a distinct export action', async (label, mode) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onExport = jest.fn()
  try {
    await act(async () =>
      root.render(
        <LocaleProvider initialLocale="zh" initialPreference="zh">
          <TranslateExportMenu disabled={false} loading={false} onExport={onExport} />
        </LocaleProvider>
      )
    )
    await act(async () => host.querySelector('button')!.click())
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual(['全部导出', '导出未翻译的'])
    await act(async () => items.find((item) => item.textContent === label)!.click())
    expect(onExport).toHaveBeenCalledWith(mode)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
