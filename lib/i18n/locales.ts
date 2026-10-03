/** 界面语言：英 / 简中 / 日 / 韩（下拉顺序） */
export const LOCALES = ['en', 'zh', 'ja', 'ko'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** `auto`：跟随系统 / 浏览器语言；只有用户明确选过才是具体语言 */
export type LocalePreference = Locale | 'auto'

/**
 * 只存用户明确的选择；localStorage 与 cookie 共用（SSR 读 cookie）。
 * 旧键 `chaya.locale` 会在首次访问时自动写入，无法区分是否为用户选择，故弃用。
 */
export const LOCALE_STORAGE_KEY = 'chaya.localePref'
export const LOCALE_COOKIE_KEY = LOCALE_STORAGE_KEY
const LEGACY_LOCALE_KEY = 'chaya.locale'

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

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'auto' || isLocale(value)
}

/** 偏好 → 实际语言；`auto` 时由调用方给出系统语言 */
export function localeForPreference(preference: LocalePreference, systemLocale: Locale): Locale {
  return preference === 'auto' ? systemLocale : preference
}

/** 用户明确选过的语言；没选过（跟随系统）返回 null */
export function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(raw) ? raw : null
  } catch {
    return null
  }
}

function setCookie(key: string, value: string, maxAge: number) {
  if (typeof document === 'undefined') return
  document.cookie = `${key}=${value};path=/;max-age=${maxAge};samesite=lax`
}

/** `auto` 清除存储，回到跟随系统 */
export function writeStoredLocale(preference: LocalePreference) {
  if (typeof window === 'undefined') return
  try {
    if (preference === 'auto') window.localStorage.removeItem(LOCALE_STORAGE_KEY)
    else window.localStorage.setItem(LOCALE_STORAGE_KEY, preference)
  } catch {
    /* ignore quota / private mode */
  }
  setCookie(LOCALE_COOKIE_KEY, preference === 'auto' ? '' : preference, preference === 'auto' ? 0 : LOCALE_COOKIE_MAX_AGE)
}

export function clearLegacyLocale() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LEGACY_LOCALE_KEY)
  } catch {
    /* */
  }
  if (typeof document !== 'undefined' && document.cookie.includes(`${LEGACY_LOCALE_KEY}=`)) setCookie(LEGACY_LOCALE_KEY, '', 0)
}
