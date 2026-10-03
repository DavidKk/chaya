import { type NextRequest, NextResponse } from 'next/server'

import { REMOTE_SCRIPT_PREFIX } from '@/lib/remote-scripts/command'

/** `/sh/<name>`: same URL serves raw Bash to curl and a highlighted viewer to browsers. Public in every mode. */
function remoteScript(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
  if (!pathname.startsWith(REMOTE_SCRIPT_PREFIX)) return null
  const wantsHtml = (request.headers.get('accept') || '').includes('text/html')
  const isScript = !pathname.slice(REMOTE_SCRIPT_PREFIX.length).includes('/')
  if (isScript && wantsHtml && !searchParams.has('raw')) {
    return NextResponse.rewrite(new URL(`${pathname}/view`, request.url))
  }
  return NextResponse.next()
}

/** 页面一律放行：本机不登录、Edge 登录可选；数据访问由 API 门禁（`defineApiRoute`）把关 */
export function proxy(request: NextRequest) {
  return remoteScript(request) ?? NextResponse.next()
}

// API 在 defineApiRoute 内独立校验，插件只取得受限权限。
export const config = { matcher: ['/((?!api(?:/|$)|_next/|favicon.ico).*)'] }
