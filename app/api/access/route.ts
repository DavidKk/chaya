import { NextResponse } from 'next/server'

import { defineApiRoute } from '@/initializer/controller'
import { apiError } from '@/initializer/response'
import { ACCESS_COOKIE, validManagementToken } from '@/services/access/management'

/** 仅接受启动终端提供的令牌；立即跳转到不含令牌的页面。 */
export const GET = defineApiRoute('get:/api/access', async ({ request }) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!validManagementToken(token)) return apiError(401, 'ACCESS_DENIED', '授权链接无效，请使用启动终端中的链接')
  // 相对跳转保持浏览器所在主机；Next 的内部 request.url 可能是 localhost。
  const response = new NextResponse(null, { status: 303, headers: { Location: '/game' } })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.cookies.set(ACCESS_COOKIE, token!, { httpOnly: true, sameSite: 'strict', secure: url.protocol === 'https:', path: '/' })
  return response
})
