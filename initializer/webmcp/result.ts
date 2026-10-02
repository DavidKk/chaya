/** 页面工具 `execute` 的应用信封；预期内的失败返回 `webMcpError`，不要抛异常。 */
export type WebMcpOkResult<T extends Record<string, unknown> = Record<string, never>> = { ok: true } & T

export type WebMcpErrResult<E extends string = string> = {
  ok: false
  error: E
  message?: string
}

export function webMcpOk<T extends Record<string, unknown>>(payload?: T): WebMcpOkResult<T> {
  return { ...(payload ?? ({} as T)), ok: true }
}

export function webMcpError<E extends string>(error: E, message?: string): WebMcpErrResult<E> {
  return message === undefined ? { ok: false, error } : { ok: false, error, message }
}
