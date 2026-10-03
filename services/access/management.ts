import { timingSafeEqual } from 'node:crypto'

import { canUseDisk } from '@/lib/service-mode/mode'

export function validManagementToken(value: string | null | undefined): boolean {
  const expected = process.env.CHAYA_AUTH_TOKEN || ''
  if (!expected || !value) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(value)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 浏览器会话的同源校验：拒绝跨站请求携带 Cookie */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  const expectedUrl = new URL(request.url)
  // Host 是浏览器实际访问的主机；Next 会规范化内部 URL 的 hostname。
  const host = request.headers.get('host')
  if (host) expectedUrl.host = host
  return (!origin || origin === expectedUrl.origin) && request.headers.get('sec-fetch-site') !== 'cross-site'
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return true
  const pub = process.env.CHAYA_PUBLIC_ORIGIN
  try {
    return !!pub && new URL(pub).hostname.toLowerCase() === host
  } catch {
    return false
  }
}

/**
 * 本机免登录：同源（或非浏览器）请求放行。拒绝跨站网页借浏览器调用本机 API，
 * 并要求 Host 为 localhost / IP / `CHAYA_PUBLIC_ORIGIN`，防 DNS rebinding。
 */
export function isLocalConsoleRequest(request: Request): boolean {
  const host = request.headers.get('host') || new URL(request.url).host
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  return isLocalHostname(hostname) && isSameOriginRequest(request)
}

/** 管理权限：服务内部 Bearer 管理令牌，或本机形态下的同源请求（本机不登录） */
export function hasManagementAccess(request: Request): boolean {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (validManagementToken(bearer)) return true
  return canUseDisk() && isLocalConsoleRequest(request)
}
