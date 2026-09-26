import { type NextRequest, NextResponse } from 'next/server'

import { isLocale, LOCALE_COOKIE_KEY, localeCookieOptions, localeFromAcceptLanguage } from '@/lib/i18n/locales'
import { canUseDisk } from '@/lib/service-mode/mode'
import { hasManagementAccess } from '@/services/access/management'

function withLocaleCookie(request: NextRequest, response: NextResponse) {
  if (isLocale(request.cookies.get(LOCALE_COOKIE_KEY)?.value)) return response
  response.cookies.set(LOCALE_COOKIE_KEY, localeFromAcceptLanguage(request.headers.get('accept-language')), localeCookieOptions)
  return response
}

export function proxy(request: NextRequest) {
  if (!canUseDisk() || hasManagementAccess(request)) return withLocaleCookie(request, NextResponse.next())
  return withLocaleCookie(
    request,
    new NextResponse('请使用 Chaya 启动终端中的授权链接打开控制台。', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  )
}

// API 在 defineApiRoute 内独立校验，插件只取得受限权限。
export const config = { matcher: ['/((?!api(?:/|$)|_next/|favicon.ico).*)'] }
