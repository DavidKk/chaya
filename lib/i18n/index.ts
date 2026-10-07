export { tNow } from '@/lib/i18n/current'
export {
  clearLegacyLocale,
  DEFAULT_LOCALE,
  detectBrowserLocale,
  isLocale,
  isLocalePreference,
  type Locale,
  LOCALE_COOKIE_KEY,
  LOCALE_HTML_LANG,
  LOCALE_NATIVE_LABEL,
  LOCALE_STORAGE_KEY,
  localeForPreference,
  localeFromAcceptLanguage,
  localeFromLanguageTags,
  type LocalePreference,
  LOCALES,
  readStoredLocale,
  writeStoredLocale,
} from '@/lib/i18n/locales'
export { MESSAGES, type MessageTree } from '@/lib/i18n/messages'
export { formatMessage, type MessageKey, type MessageParams, translate } from '@/lib/i18n/t'
