/** @jest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { LanguagePairSelect, type LanguagePairSelectProps } from '@/components/sk/LanguagePairSelect'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('renders missing and malformed language metadata and keeps swapping functional', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onSourceChange = jest.fn(),
    onTargetChange = jest.fn()
  try {
    for (const languages of [undefined, null, {}, ['en', 'en', null, 'zh', 1]]) {
      await act(async () =>
        root.render(
          <LocaleProvider initialLocale="zh" initialPreference="zh">
            <LanguagePairSelect
              sourceLang="en"
              targetLang="zh"
              availableLanguages={languages as LanguagePairSelectProps['availableLanguages']}
              onSourceChange={onSourceChange}
              onTargetChange={onTargetChange}
            />
          </LocaleProvider>
        )
      )
      expect(host.textContent).toContain('English')
    }
    const swap = host.querySelector('button[aria-label="交换源语言与目标语言"]') || host.querySelectorAll('button')[1]
    await act(async () => (swap as HTMLButtonElement).click())
    expect(onSourceChange).toHaveBeenCalledWith('zh')
    expect(onTargetChange).toHaveBeenCalledWith('en')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
