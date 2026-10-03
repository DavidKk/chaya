import type { NextRequest } from 'next/server'

import { getRemoteScriptSource } from '@/lib/remote-scripts/registry'

/** Browsers (Accept: text/html) are rewritten to `./view` by proxy; everything else gets raw Bash with this origin filled in. */
export const dynamic = 'force-dynamic'

/** The address the client actually used (`nextUrl` normalizes the dev host to localhost, which breaks LAN use). */
function servingOrigin(request: NextRequest): string {
  const first = (name: string) => request.headers.get(name)?.split(',')[0]?.trim()
  const proto = first('x-forwarded-proto') || request.nextUrl.protocol.replace(/:$/, '')
  const host = first('x-forwarded-host') || first('host') || request.nextUrl.host
  return `${proto}://${host}`
}

export async function GET(request: NextRequest, ctx: RouteContext<'/sh/[name]'>) {
  const { name } = await ctx.params
  const source = getRemoteScriptSource(name, servingOrigin(request))
  if (!source) return new Response('not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  return new Response(source, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      Vary: 'Accept, Host, X-Forwarded-Host, X-Forwarded-Proto',
    },
  })
}
