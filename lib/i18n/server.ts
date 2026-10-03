import { cookies, headers } from 'next/headers'

import { isLocale, type Locale, LOCALE_COOKIE_KEY, localeFromAcceptLanguage, type LocalePreference } from '@/lib/i18n/locales'

/** 服务端解析本次请求语言：用户明确选过（cookie）优先，否则跟随 Accept-Language */
export async function resolveRequestLocale(): Promise<{ locale: Locale; preference: LocalePreference }> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE_KEY)?.value
  if (isLocale(fromCookie)) return { locale: fromCookie, preference: fromCookie }
  return { locale: localeFromAcceptLanguage((await headers()).get('accept-language')), preference: 'auto' }
}
