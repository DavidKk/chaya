/** Plugin runtime env (defaults when config service is offline) */

import { DEFAULT_API_BASE, DEFAULT_LOG_URL } from '@/constants/listen'

export const DEFAULT_CHAYA_LOG_URL = DEFAULT_LOG_URL
export const DEFAULT_CHAYA_API_BASE = DEFAULT_API_BASE

export function resolveLogUrl(): string {
  if (typeof window !== 'undefined') {
    const w = window as Window & { CHAYA_LOG_URL?: string }
    if (w.CHAYA_LOG_URL) return String(w.CHAYA_LOG_URL)
  }
  try {
    if (typeof process !== 'undefined' && process.env?.CHAYA_LOG_URL) {
      return String(process.env.CHAYA_LOG_URL)
    }
  } catch {
    /* */
  }
  return DEFAULT_CHAYA_LOG_URL
}

export function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    const w = window as Window & { CHAYA_API_BASE?: string }
    if (w.CHAYA_API_BASE) return String(w.CHAYA_API_BASE).replace(/\/$/, '')
  }
  return DEFAULT_CHAYA_API_BASE
}

/**
 * 成功从某 API 拉到插件后，把运行时基址钉到该 URL 的 origin
 *（域名就域名、局域网 IP 就局域网 IP，避免继续走写死的 loopback）。
 */
export function pinApiBaseFromUrl(resourceUrl: string): void {
  if (typeof window === 'undefined') return
  try {
    const u = new URL(resourceUrl, window.location.href)
    if (!/^https?:$/i.test(u.protocol)) return
    const base = `${u.protocol}//${u.host}`.replace(/\/$/, '')
    if (!base) return
    const w = window as Window & { CHAYA_API_BASE?: string; CHAYA_LOG_URL?: string }
    w.CHAYA_API_BASE = base
    w.CHAYA_LOG_URL = `${base}/api/logs`
  } catch {
    /* */
  }
}

/** Heartbeat reachability fallback: injected URL first, then loopback (needed when dev binds 127.0.0.1 only) */
export function resolveApiBaseFallbacks(): string[] {
  const primary = resolveApiBase()
  const loopback = DEFAULT_CHAYA_API_BASE.replace(/\/$/, '')
  const out: string[] = []
  for (const b of [primary, loopback]) {
    const n = b.replace(/\/$/, '')
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}
