import { GAME_LINK_TOKEN_HEADER } from '@/lib/runtime/game-link-protocol'
import { mayAccessApi } from '@/services/access/api'

import { apiError, packApiRouteResult, packApiRouteThrown } from './response'
import type { ApiRouteHandler, ApiRouteHandlerResult, DefaultRouteContext, ExistingRouteHandler } from './types'

export type { ApiRouteHandler, ApiRouteHandlerResult, DefaultRouteContext, ExistingRouteHandler } from './types'

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
    try {
      if (!(await mayAccessApi(request))) {
        return apiError(401, 'ACCESS_DENIED', '请使用启动终端中的授权链接打开控制台', {
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': `Content-Type, X-Chaya-Launch-Token, ${GAME_LINK_TOKEN_HEADER}` },
        })
      }
      const result: ApiRouteHandlerResult = await handler({ request, context })
      const response = packApiRouteResult(result)
      if (request.headers.has('x-chaya-launch-token')) response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    } catch (error) {
      return packApiRouteThrown(error)
    }
  }
}
