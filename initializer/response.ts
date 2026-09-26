import { NextResponse } from 'next/server'

export { readApiErrorMessage } from '@/lib/api-error'

/**
 * Chaya HTTP 返回信封（对齐工单服务 `{ ok, error? }` 思路；鉴权由 controller 处理）。
 *
 * handler 返回 `apiOk` / `apiError` / 纯数据，或 `throw apiErrorBody(...)`；
 * `initializer/controller` 用 `packApiRouteResult` / `packApiRouteThrown` 打包。
 */

export type ApiErrorDetail = { code: string; message: string }

export type ApiErrorResponse = {
  ok: false
  error: ApiErrorDetail
  /** 兼容旧前端：部分路由曾用顶层 error 字符串 */
  cancelled?: boolean
}

export type ApiSuccessResponse = {
  ok: true
  [key: string]: unknown
}

export type ApiResponse = ApiErrorResponse | ApiSuccessResponse

export type ApiJsonInit = {
  status?: number
  headers?: HeadersInit
}

export const API_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
} as const

export function apiOkBody(fields?: Record<string, unknown>): ApiSuccessResponse {
  return { ...(fields ?? {}), ok: true }
}

export function apiErrorBody(code: string, message: string): ApiErrorResponse {
  return { ok: false, error: { code, message } }
}

export function isApiErrorDetail(error: unknown): error is ApiErrorDetail {
  return Boolean(error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' && typeof (error as { message?: unknown }).message === 'string')
}

export function isApiErrorResponse(data: unknown): data is ApiErrorResponse {
  return Boolean(data && typeof data === 'object' && (data as { ok?: unknown }).ok === false && isApiErrorDetail((data as { error?: unknown }).error))
}

export function isApiSuccessResponse(data: unknown): data is ApiSuccessResponse {
  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && (data as { ok?: unknown }).ok === true)
}

export function isApiResponse(data: unknown): data is ApiResponse {
  return isApiErrorResponse(data) || isApiSuccessResponse(data)
}

function mergeHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(API_NO_STORE_HEADERS)
  if (extra) {
    const more = new Headers(extra)
    more.forEach((value, key) => headers.set(key, value))
  }
  return headers
}

export function json(body: unknown, init: ApiJsonInit = {}): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: mergeHeaders(init.headers),
  })
}

export function apiOk(fields?: Record<string, unknown>, init: ApiJsonInit = {}): NextResponse {
  return json(apiOkBody(fields), { status: init.status ?? 200, headers: init.headers })
}

export function apiError(status: number, code: string, message: string, init: ApiJsonInit = {}): NextResponse {
  return json(apiErrorBody(code, message), { status, headers: init.headers })
}

export function apiBadRequest(message: string, code = 'BAD_REQUEST'): NextResponse {
  return apiError(400, code, message)
}

export function apiNotFound(message: string, code = 'NOT_FOUND'): NextResponse {
  return apiError(404, code, message)
}

/** 原生选择器取消等非错误取消态（仍为 200） */
export function apiCancelled(): NextResponse {
  return json({ ok: false, cancelled: true })
}

export function packApiRouteResult(result: unknown): Response {
  if (result instanceof Response) return result
  if (result == null) return apiOk()
  if (typeof result === 'object' && !Array.isArray(result)) {
    const body = result as Record<string, unknown>
    if (body.ok === false && body.cancelled === true) {
      return json(body)
    }
    if (body.ok === false && typeof body.error === 'string') {
      const status = typeof body.status === 'number' && Number.isFinite(body.status) ? body.status : 400
      return apiError(status, 'BAD_REQUEST', body.error)
    }
  }
  if (isApiResponse(result)) {
    return json(result, { status: isApiErrorResponse(result) ? 400 : 200 })
  }
  if (typeof result === 'object') return apiOk(result as Record<string, unknown>)
  return apiOk({ value: result })
}

export function packApiRouteThrown(error: unknown): Response {
  if (isApiErrorResponse(error)) {
    return json(error, { status: 400 })
  }
  if (error instanceof Error) {
    return apiError(500, 'INTERNAL_ERROR', error.message)
  }
  return apiError(500, 'INTERNAL_ERROR', String(error))
}
