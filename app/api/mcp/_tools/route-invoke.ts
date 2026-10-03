import type { DefaultRouteContext, ExistingRouteHandler } from '@/initializer/controller'
import { readApiErrorMessage } from '@/lib/api-error'
import { type ApiInvoke, type InvokeInput, pathWithQuery, redactSecrets } from '@/lib/integration/tools/types'

export { redactSecrets }
export type { InvokeInput }

/**
 * Call an API route handler in-process with the server's management token, so MCP tools reuse the
 * route's validation and error codes. Returns the `apiOk` payload (without `ok`, secrets removed);
 * throws with the route's error message otherwise.
 */
export async function invokeRoute(handler: ExistingRouteHandler<DefaultRouteContext>, input: InvokeInput): Promise<Record<string, unknown>> {
  const url = new URL(pathWithQuery(input.path, input.query), 'http://127.0.0.1')
  const headers = new Headers({ Authorization: `Bearer ${process.env.CHAYA_AUTH_TOKEN || ''}` })
  if (input.body !== undefined) headers.set('Content-Type', 'application/json')
  const request = new Request(url, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: input.signal,
  })
  const res = await handler(request, { params: Promise.resolve({}) })
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok || !data || data.ok === false) {
    throw new Error(readApiErrorMessage(data, `${input.method} ${input.path} 失败（HTTP ${res.status}）`))
  }
  const { ok: _ok, ...rest } = data
  return redactSecrets(rest)
}

type RouteModule = Partial<Record<InvokeInput['method'], ExistingRouteHandler<DefaultRouteContext>>>

const ROUTES: Record<string, () => Promise<RouteModule>> = {
  '/api/translate': () => import('@/app/api/translate/route.server'),
  '/api/extract': () => import('@/app/api/extract/route.server'),
  '/api/translate-cache': () => import('@/app/api/translate-cache/route.server'),
  '/api/game-edit/catalog': () => import('@/app/api/game-edit/catalog/route.server'),
}

/** `ApiInvoke` over the in-process routes used by the shared tool factories. */
export const invokeLocalApi: ApiInvoke = async (input) => {
  const handler = (await ROUTES[input.path]?.())?.[input.method]
  if (!handler) throw new Error(`不支持的接口：${input.method} ${input.path}`)
  return invokeRoute(handler, input)
}
