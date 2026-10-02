import { canUseDisk } from '@/lib/service-mode/mode'
import { peekLaunchToken } from '@/services/runtime/launch-token'

import { hasManagementAccess } from './management'

export async function mayAccessApi(request: Request): Promise<boolean> {
  const url = new URL(request.url)
  const path = url.pathname
  if (!canUseDisk()) return true
  if (path === '/api/access') return true // 授权入口自行校验令牌。
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
