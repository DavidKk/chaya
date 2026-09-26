/**
 * 控制台与局内插件共用的 API URL。
 * - Web：相对路径 `/api/...`（同源）
 * - 局内：`window.CHAYA_API_BASE` + path（由 ChayaEnv 注入）
 */
export function toolkitApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  if (typeof window !== 'undefined') {
    const base = (window as Window & { CHAYA_API_BASE?: string }).CHAYA_API_BASE
    if (base) return `${String(base).replace(/\/$/, '')}${normalized}`
  }
  return normalized
}
