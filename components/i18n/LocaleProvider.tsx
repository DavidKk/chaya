'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import {
  clearLegacyLocale,
  DEFAULT_LOCALE,
  detectBrowserLocale,
  type Locale,
  LOCALE_HTML_LANG,
  localeForPreference,
  type LocalePreference,
  type MessageKey,
  type MessageParams,
  MESSAGES,
  readStoredLocale,
  translate,
  writeStoredLocale,
} from '@/lib/i18n'

type LocaleContextValue = {
  locale: Locale
  /** `auto` 表示跟随系统语言 */
  preference: LocalePreference
  /** SSR 已带初始语言；始终可用 */
  ready: boolean
  setLocale: (preference: LocalePreference) => void
  t: (key: MessageKey, params?: MessageParams) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

type Props = {
  children: ReactNode
  /** SSR 解析出的语言；缺省（游戏内插件）时直接取浏览器 / 系统语言 */
  initialLocale?: Locale
  initialPreference?: LocalePreference
  /** 游戏内插件传 false：`<html lang>` 影响游戏画面的 CJK 字形选择 */
  syncDocumentLang?: boolean
}

export function LocaleProvider({ children, initialLocale, initialPreference = 'auto', syncDocumentLang = true }: Props) {
  const [preference, setPreference] = useState<LocalePreference>(initialPreference)
  const [systemLocale, setSystemLocale] = useState<Locale>(() => initialLocale ?? detectBrowserLocale())
  const locale = localeForPreference(preference, systemLocale)

  useEffect(() => {
    clearLegacyLocale()
    const stored = readStoredLocale()
    if (stored) setPreference(stored)
    setSystemLocale(detectBrowserLocale())
    const onLanguageChange = () => setSystemLocale(detectBrowserLocale())
    window.addEventListener('languagechange', onLanguageChange)
    return () => window.removeEventListener('languagechange', onLanguageChange)
  }, [])

  useEffect(() => {
    if (syncDocumentLang) document.documentElement.lang = LOCALE_HTML_LANG[locale]
  }, [locale, syncDocumentLang])

  const setLocale = useCallback((next: LocalePreference) => {
    setPreference(next)
    writeStoredLocale(next)
  }, [])

  const t = useCallback((key: MessageKey, params?: MessageParams) => translate(MESSAGES[locale], key, params), [locale])

  const value = useMemo(() => ({ locale, preference, ready: true, setLocale, t }), [locale, preference, setLocale, t])

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
