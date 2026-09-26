export {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  isLocale,
  type Locale,
  LOCALE_COOKIE_KEY,
  LOCALE_HTML_LANG,
  LOCALE_NATIVE_LABEL,
  LOCALE_STORAGE_KEY,
  localeCookieOptions,
  localeFromAcceptLanguage,
  localeFromLanguageTags,
  LOCALES,
  readStoredLocale,
  writeStoredLocale,
} from '@/lib/i18n/locales'
export { MESSAGES, type MessageTree } from '@/lib/i18n/messages'
export { formatMessage, type MessageKey, type MessageParams, translate } from '@/lib/i18n/t'
