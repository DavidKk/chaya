import { REMOTE_SCRIPT_NAMES } from '@/lib/remote-scripts/command'
import { getRemoteScriptSource } from '@/lib/remote-scripts/registry'

/** Browsers (Accept: text/html) are rewritten to `./view` by proxy; everything else gets raw Bash. */
export const dynamicParams = false

export function generateStaticParams() {
  return REMOTE_SCRIPT_NAMES.map((name) => ({ name }))
}

export async function GET(_request: Request, ctx: RouteContext<'/sh/[name]'>) {
  const { name } = await ctx.params
  const source = getRemoteScriptSource(name)
  if (!source) return new Response('not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  return new Response(source, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      Vary: 'Accept',
    },
  })
}
