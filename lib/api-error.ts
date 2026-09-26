/**
 * 客户端安全：解析 API 错误文案（勿放 next/server 同文件，否则会进局内 IIFE）。
 */
export function readApiErrorMessage(data: unknown, fallback = '请求失败'): string {
  if (data == null || typeof data !== 'object') return fallback
  const err = (data as { error?: unknown }).error
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    const msg = (err as { message: string }).message.trim()
    if (msg) return msg
  }
  return fallback
}
