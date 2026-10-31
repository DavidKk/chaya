import { cookies, headers } from 'next/headers'

import { isLocale, type Locale, LOCALE_COOKIE_KEY, localeFromAcceptLanguage, type LocalePreference } from '@/lib/i18n/locales'
import { measureOperation } from '@/services/log/operation'

/** Resolve the request locale from an explicit cookie, then Accept-Language. */
export async function resolveRequestLocale(): Promise<{ locale: Locale; preference: LocalePreference }> {
  const requestHeaders = await headers()
  return measureOperation(
    'http',
    'http.locale',
    {},
    async () => {
      const fromCookie = (await cookies()).get(LOCALE_COOKIE_KEY)?.value
      if (isLocale(fromCookie)) return { locale: fromCookie, preference: fromCookie }
      return { locale: localeFromAcceptLanguage(requestHeaders.get('accept-language')), preference: 'auto' }
    },
    { operationId: requestHeaders.get('x-chaya-request-id') ?? undefined }
  )
}
