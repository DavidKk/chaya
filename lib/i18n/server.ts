import { cookies, headers } from 'next/headers'

import { isLocale, type Locale, LOCALE_COOKIE_KEY, localeFromAcceptLanguage } from '@/lib/i18n/locales'

/** 服务端解析本次请求语言：cookie 优先，否则 Accept-Language */
export async function resolveRequestLocale(): Promise<Locale> {
  const jar = await cookies()
  const fromCookie = jar.get(LOCALE_COOKIE_KEY)?.value
  if (isLocale(fromCookie)) return fromCookie

  const header = (await headers()).get('accept-language')
  return localeFromAcceptLanguage(header)
}
