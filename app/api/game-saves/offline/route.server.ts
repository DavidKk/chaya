import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiNotFound, apiOk } from '@/initializer/response'
import { requireDisk } from '@/lib/service-mode'
import { readOfflineGameSaves } from '@/services/game-saves/offline-list'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/game-saves/offline', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  if (request.headers.has('x-chaya-launch-token')) return apiBadRequest('管理会话接口不接受启动令牌', 'ACCESS_DENIED')
  const libraryId = new URL(request.url).searchParams.get('libraryId')?.trim() || ''
  if (!libraryId) return apiBadRequest('Missing libraryId', 'INVALID_REQUEST')
  const result = await readOfflineGameSaves(libraryId)
  return result ? apiOk({ result }) : apiNotFound('Library game not found', 'GAME_NOT_FOUND')
})
