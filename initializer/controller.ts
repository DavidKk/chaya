import { apiError, packApiRouteResult, packApiRouteThrown } from '@/initializer/response'
import type { ApiRouteHandler, ApiRouteHandlerResult, DefaultRouteContext, ExistingRouteHandler } from '@/initializer/types'
import { GAME_LINK_TOKEN_HEADER } from '@/lib/runtime/game-link-protocol'
import { mayAccessApi } from '@/services/access/api'
import { startOperation } from '@/services/log/operation'

export type { ApiRouteHandler, ApiRouteHandlerResult, DefaultRouteContext, ExistingRouteHandler } from '@/initializer/types'

/**
 * 本机工具 API 注册工厂（对齐工单 `defineApiRoute` 形态，统一校验管理会话与插件权限）。
 *
 * @example
 * export const POST = defineApiRoute('post:/api/shell', async ({ request }) => {
 *   if (bad) return apiBadRequest('…')
 *   return apiOk({ installed: true })
 * })
 */
export function defineApiRoute<TContext = DefaultRouteContext>(_policyId: string, handler: ApiRouteHandler<TContext>): ExistingRouteHandler<TContext> {
  return async (request, context) => {
    const path = new URL(request.url).pathname
    // Logging the log transport would feed its own SSE stream indefinitely.
    const timing =
      path === '/api/logs' || path.startsWith('/api/logs/')
        ? undefined
        : startOperation('api', 'http.request', { method: request.method, path, policy: _policyId }, { operationId: request.headers.get('x-chaya-request-id') ?? undefined })
    const execute = async () => {
      let response: Response
      let thrown: unknown
      try {
        if (!(await mayAccessApi(request))) {
          response = apiError(401, 'ACCESS_DENIED', 'Access denied: local API rejected cross-site request', {
            headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': `Content-Type, X-Chaya-Launch-Token, ${GAME_LINK_TOKEN_HEADER}` },
          })
        } else {
          const result: ApiRouteHandlerResult = await handler({ request, context })
          response = packApiRouteResult(result)
        }
        if (request.headers.has('x-chaya-launch-token')) response.headers.set('Access-Control-Allow-Origin', '*')
      } catch (error) {
        thrown = error
        response = packApiRouteThrown(error)
      }
      if (timing) {
        const streaming = response.headers.get('content-type')?.includes('text/event-stream') ?? false
        const meta = { status: response.status, phase: streaming ? 'stream-open' : 'response-ready' }
        if (thrown) timing.fail(thrown, meta)
        else timing.end(response.status >= 500 ? 'failed' : 'completed', meta)
        response.headers.set('X-Chaya-Request-Id', timing.id)
        response.headers.append('Server-Timing', `handler;dur=${timing.elapsedMs()}`)
        response.headers.append('Access-Control-Expose-Headers', 'X-Chaya-Request-Id, Server-Timing')
      }
      return response
    }
    return timing ? timing.run(execute) : execute()
  }
}
