import { timingSafeEqual } from 'node:crypto'

export const ACCESS_COOKIE = 'chaya_access'

export function validManagementToken(value: string | null | undefined): boolean {
  const expected = process.env.CHAYA_AUTH_TOKEN || ''
  if (!expected || !value) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(value)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function hasManagementAccess(request: Request): boolean {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (validManagementToken(bearer)) return true
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1)
  if (!validManagementToken(cookie)) return false
  const origin = request.headers.get('origin')
  const expectedUrl = new URL(request.url)
  // Host 是浏览器实际访问的主机；Next 会规范化内部 URL 的 hostname。
  const host = request.headers.get('host')
  if (host) expectedUrl.host = host
  return (!origin || origin === expectedUrl.origin) && request.headers.get('sec-fetch-site') !== 'cross-site'
}
