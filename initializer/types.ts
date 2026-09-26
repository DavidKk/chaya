/**
 * api/route 与 controller 共用的 handler 返回值类型。
 * 本机工具无鉴权 Principal。
 */

export type DefaultRouteContext = { params: Promise<Record<string, string | string[]>> }

/** handler 可返回 Response、纯数据，或已成形的 `{ ok:false|true, … }`。 */
export type ApiRouteHandlerResult = Response | Record<string, unknown> | null | undefined

export type ApiRouteHandler<TContext = DefaultRouteContext> = (input: { request: Request; context: TContext }) => ApiRouteHandlerResult | Promise<ApiRouteHandlerResult>

export type ExistingRouteHandler<TContext = DefaultRouteContext> = (request: Request, context: TContext) => Promise<Response>
