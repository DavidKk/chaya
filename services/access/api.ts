import { canUseDisk } from '@/lib/service-mode/mode'
import { hasManagementAccess } from '@/services/access/management'
import { peekLaunchToken } from '@/services/runtime/launch-token'

export async function mayAccessApi(request: Request): Promise<boolean> {
  const url = new URL(request.url)
  const path = url.pathname
  // Edge：无登录，数据都在浏览器本地；`/api/mcp` 不进 Edge 构建
  if (!canUseDisk()) return true
  if ((request.method === 'GET' || request.method === 'HEAD') && (path.startsWith('/api/remote/') || /^\/api\/plugins\/[^/]+$/.test(path))) return true
  if (hasManagementAccess(request)) return true

  const session = peekLaunchToken(request.headers.get('x-chaya-launch-token'))
  if (!session) return false
  if (path === '/api/runtime/heartbeat' && ['GET', 'POST'].includes(request.method)) return true
  if (path === '/api/logs' && request.method === 'POST') return true
  if (path === '/api/runtime/webrtc') {
    const body =
      request.method === 'POST'
        ? await request
            .clone()
            .json()
            .catch(() => null)
        : null
    const room = body?.roomId ?? url.searchParams.get('roomId')
    if (room !== (session.libraryId || session.token)) return false
    return request.method === 'GET' || (request.method === 'POST' && body?.action === 'answer')
  }
  if (path === '/api/runtime/agent' && request.method === 'POST') {
    const body = await request
      .clone()
      .json()
      .catch(() => null)
    return body?.roomId === (session.libraryId || session.token)
  }
  if (path === '/api/translate' && request.method === 'POST') {
    const body = await request
      .clone()
      .json()
      .catch(() => null)
    return !!body && (body.mode == null || body.mode === 'live' || body.mode === 'realtime' || body.mode === 'lookup')
  }
  return false
}
