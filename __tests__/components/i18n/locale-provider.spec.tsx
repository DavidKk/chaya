/** @jest-environment jsdom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { LocaleProvider, useLocale } from '@/components/i18n/LocaleProvider'
import { type Locale, LOCALE_STORAGE_KEY, type LocalePreference } from '@/lib/i18n'

let container: HTMLDivElement
let root: Root
const probe: { current: ReturnType<typeof useLocale> | null } = { current: null }

function Probe() {
  const locale = useLocale()
  useEffect(() => {
    probe.current = locale
  })
  return <span>{locale.t('nav.library')}</span>
}

const current = new Proxy({} as ReturnType<typeof useLocale>, {
  get: (_, key) => probe.current![key as keyof ReturnType<typeof useLocale>],
})

function setNavigatorLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', { configurable: true, value: languages })
  Object.defineProperty(window.navigator, 'language', { configurable: true, value: languages[0] })
}

async function render(props: { initialLocale?: Locale; initialPreference?: LocalePreference; syncDocumentLang?: boolean } = {}) {
  await act(async () => {
    root.render(
      <LocaleProvider {...props}>
        <Probe />
      </LocaleProvider>
    )
  })
}

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }))

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  document.documentElement.lang = 'ja'
  setNavigatorLanguages(['zh-CN', 'en'])
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.localStorage.clear()
  document.cookie.split(';').forEach((part) => {
    document.cookie = `${part.split('=')[0]!.trim()}=;path=/;max-age=0`
  })
})

test('follows the browser / system language by default and stores nothing', async () => {
  await render()
  expect(current.preference).toBe('auto')
  expect(container.textContent).toBe('游戏库')
  expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
  expect(document.cookie).not.toContain(LOCALE_STORAGE_KEY)
})

test('SSR auto locale is corrected to the client system language after mount', async () => {
  await render({ initialLocale: 'en', initialPreference: 'auto' })
  expect(current.locale).toBe('zh')
})

test('an explicit choice persists and "auto" goes back to following the system', async () => {
  await render()
  act(() => current.setLocale('ja'))
  expect(current.locale).toBe('ja')
  expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja')
  expect(document.cookie).toContain(`${LOCALE_STORAGE_KEY}=ja`)

  act(() => current.setLocale('auto'))
  expect(current.locale).toBe('zh')
  expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
  expect(document.cookie).not.toContain(LOCALE_STORAGE_KEY)
})

test('a stored choice wins over the system language', async () => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ko')
  await render()
  expect(current.locale).toBe('ko')
  expect(current.preference).toBe('ko')
})

test('legacy auto-written keys are cleared and ignored', async () => {
  window.localStorage.setItem('chaya.locale', 'en')
  document.cookie = 'chaya.locale=en;path=/'
  await render()
  expect(current.locale).toBe('zh')
  expect(window.localStorage.getItem('chaya.locale')).toBeNull()
  expect(document.cookie).not.toContain('chaya.locale=')
})

test('system language changes are picked up while following the system', async () => {
  await render()
  setNavigatorLanguages(['ko-KR'])
  act(() => {
    window.dispatchEvent(new Event('languagechange'))
  })
  expect(current.locale).toBe('ko')
})

test('the in-game plugin leaves the game document language alone', async () => {
  await render({ syncDocumentLang: false })
  expect(document.documentElement.lang).toBe('ja')
  act(() => root.unmount())
  root = createRoot(container)
  await render()
  expect(document.documentElement.lang).toBe('zh-CN')
})
