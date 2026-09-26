'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { DEFAULT_LOCALE, type Locale, LOCALE_HTML_LANG, type MessageKey, type MessageParams, MESSAGES, readStoredLocale, translate, writeStoredLocale } from '@/lib/i18n'

type LocaleContextValue = {
  locale: Locale
  /** SSR 已带初始语言；始终可用 */
  ready: boolean
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, params?: MessageParams) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  useEffect(() => {
    // 兼容仅写过 localStorage 的旧会话：显式偏好覆盖 SSR（Accept-Language / cookie）
    const stored = readStoredLocale()
    if (stored && stored !== initialLocale) {
      setLocaleState(stored)
      writeStoredLocale(stored)
      return
    }
    writeStoredLocale(initialLocale)
  }, [initialLocale])

  useEffect(() => {
    document.documentElement.lang = LOCALE_HTML_LANG[locale]
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    writeStoredLocale(next)
  }, [])

  const t = useCallback((key: MessageKey, params?: MessageParams) => translate(MESSAGES[locale], key, params), [locale])

  const value = useMemo(() => ({ locale, ready: true, setLocale, t }), [locale, setLocale, t])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/** 仅读 locale；无 Provider 时回落默认（单测 / 孤立渲染） */
export function useLocaleCode(): Locale {
  return useContext(LocaleContext)?.locale ?? DEFAULT_LOCALE
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}

/** 文案读取；无 Provider 时回落默认语言（便于单测 / 孤立渲染） */
export function useT() {
  const ctx = useContext(LocaleContext)
  const locale = ctx?.locale ?? DEFAULT_LOCALE
  return useCallback((key: MessageKey, params?: MessageParams) => translate(MESSAGES[locale], key, params), [locale])
}
