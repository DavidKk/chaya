import { type NextRequest, NextResponse } from 'next/server'

import { SKILL_RAW_PREFIX } from '@/lib/integration/skills'
import { REMOTE_SCRIPT_PREFIX } from '@/lib/remote-scripts/command'
import { canUseDisk } from '@/lib/service-mode/mode'
import { hasManagementAccess } from '@/services/access/management'

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

export function proxy(request: NextRequest) {
  const script = remoteScript(request)
  if (script) return script
  /** `/skills/<id>.md`: public agent skill docs */
  if (request.nextUrl.pathname.startsWith(SKILL_RAW_PREFIX)) return NextResponse.next()
  if (!canUseDisk() || hasManagementAccess(request)) return NextResponse.next()
  return new NextResponse('请使用 Chaya 启动终端中的授权链接打开控制台。', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

// API 在 defineApiRoute 内独立校验，插件只取得受限权限。
export const config = { matcher: ['/((?!api(?:/|$)|_next/|favicon.ico).*)'] }
