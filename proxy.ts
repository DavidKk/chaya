import { type NextRequest, NextResponse } from 'next/server'

import { REMOTE_SCRIPT_PREFIX } from '@/lib/remote-scripts/command'
import { operationId, startOperation } from '@/services/log/operation'

/** `/sh/<name>`: same URL serves raw Bash to curl and a highlighted viewer to browsers. Public in every mode. */
function remoteScript(request: NextRequest, headers: Headers) {
  const { pathname, searchParams } = request.nextUrl
  if (!pathname.startsWith(REMOTE_SCRIPT_PREFIX)) return null
  const wantsHtml = (request.headers.get('accept') || '').includes('text/html')
  const isScript = !pathname.slice(REMOTE_SCRIPT_PREFIX.length).includes('/')
  if (isScript && wantsHtml && !searchParams.has('raw')) {
    return NextResponse.rewrite(new URL(`${pathname}/view`, request.url), { request: { headers } })
  }
  return NextResponse.next({ request: { headers } })
}

/** Allow page navigation; defineApiRoute enforces API access policies. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  const id = operationId(headers.get('x-chaya-request-id'))
  headers.set('x-chaya-request-id', id)
  const arrival = Number(headers.get('x-chaya-request-started-at'))
  const timing = startOperation(
    'http',
    'http.proxy',
    { method: request.method, path: request.nextUrl.pathname, sinceArrivalMs: arrival > 0 ? Math.max(0, Date.now() - arrival) : undefined },
    { operationId: id }
  )
  const response = remoteScript(request, headers) ?? NextResponse.next({ request: { headers } })
  response.headers.set('X-Chaya-Request-Id', id)
  timing.end()
  return response
}

// API access is checked independently by defineApiRoute; plugins have restricted permissions.
export const config = { matcher: ['/((?!api(?:/|$)|_next/|favicon.ico).*)'] }
