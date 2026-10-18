import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import type { GameSaveList } from '@/lib/game/game-saves'
import { requireDisk } from '@/lib/service-mode'
import { readOfflineSaveThumbnail } from '@/services/game-saves/offline-list'

export const runtime = 'nodejs'

export const GET = defineApiRoute('get:/api/game-saves/offline/thumb', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  if (request.headers.has('x-chaya-launch-token')) return apiBadRequest('Management session endpoint does not accept launch token', 'ACCESS_DENIED')
  const query = new URL(request.url).searchParams
  const libraryId = query.get('libraryId')?.trim() || ''
  const place = query.get('place')
  const list = query.get('list')
  const entryId = query.get('entryId')?.trim() || ''
  if (!libraryId || (place !== 'game' && place !== 'app') || (list !== 'auto' && list !== 'quick') || !entryId) {
    return apiBadRequest('Invalid thumbnail request', 'INVALID_REQUEST')
  }
  const thumb = await readOfflineSaveThumbnail(libraryId, place, list as GameSaveList, entryId)
  return apiOk({ thumb })
})
