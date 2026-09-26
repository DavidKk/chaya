/** 界面语言：英 / 简中 / 日 / 韩（下拉顺序） */
export const LOCALES = ['en', 'zh', 'ja', 'ko'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** localStorage 与 cookie 共用，便于 SSR 读 cookie、客户端读写 storage */
export const LOCALE_STORAGE_KEY = 'chaya.locale'
export const LOCALE_COOKIE_KEY = LOCALE_STORAGE_KEY

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** 选项展示用母语名（不随界面语言翻译） */
export const LOCALE_NATIVE_LABEL: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
}

export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: 'en',
  zh: 'zh-CN',
  ja: 'ja',
  ko: 'ko',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** 从 Accept-Language / navigator 语言标签解析；无法识别时回落英文 */
export function localeFromLanguageTags(tags: readonly string[]): Locale {
  for (const raw of tags) {
    const lang = String(raw || '')
      .toLowerCase()
      .replace('_', '-')
    if (lang.startsWith('zh')) return 'zh'
    if (lang.startsWith('ja')) return 'ja'
    if (lang.startsWith('ko')) return 'ko'
    if (lang.startsWith('en')) return 'en'
  }
  return DEFAULT_LOCALE
}

/** 解析 Accept-Language 头（如 `zh-CN,zh;q=0.9,en;q=0.8`） */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE
  const tags = header
    .split(',')
    .map((part) => part.trim().split(';')[0]?.trim() ?? '')
    .filter(Boolean)
  return localeFromLanguageTags(tags)
}

/** 从浏览器语言猜默认；无法识别时回落英文 */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE
  return localeFromLanguageTags([navigator.language, ...(navigator.languages ?? [])])
}

export function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(raw) ? raw : null
  } catch {
    return null
  }
}

function writeLocaleCookie(locale: Locale) {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE_KEY}=${locale};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax`
}

export function writeStoredLocale(locale: Locale) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore quota / private mode */
  }
  writeLocaleCookie(locale)
}

export const localeCookieOptions = {
  path: '/',
  maxAge: LOCALE_COOKIE_MAX_AGE,
  sameSite: 'lax' as const,
}
