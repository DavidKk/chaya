import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiNotFound, apiOk } from '@/initializer/response'
import { type GameSaveList, type GameSavesAppStoreOp, isGameSaveEntryId, SAVE_INDEX_CONFLICT, SaveIndexConflictError } from '@/lib/game/game-saves'
import { requireDisk } from '@/lib/service-mode'
import { GameSavesAppStore } from '@/services/game-saves/app-store'

export const runtime = 'nodejs'

const isList = (value: unknown): value is GameSaveList => value === 'auto' || value === 'quick'
const isEntryOf = (list: unknown, id: unknown): list is GameSaveList => isList(list) && isGameSaveEntryId(id) && id.startsWith('quick-') === (list === 'quick')

/** 插件把存档存到 Chaya 本机时的读写入口 */
export const POST = defineApiRoute('post:/api/game-saves/store', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as GameSavesAppStoreOp | null
  const gameId = typeof body?.gameId === 'string' ? body.gameId.trim() : ''
  if (!body || !gameId) return apiBadRequest('Missing gameId', 'INVALID_REQUEST')
  const store = new GameSavesAppStore(gameId)
  switch (body.op) {
    case 'readIndex':
      return apiOk({ index: store.readIndex() })
    case 'writeIndex':
      if (!Array.isArray((body.index as { entries?: unknown } | null)?.entries)) break
      if (body.expectedRevision !== undefined && (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision))) break
      try {
        store.writeIndex(body.index, body.expectedRevision)
      } catch (error) {
        if (error instanceof SaveIndexConflictError) return apiError(409, SAVE_INDEX_CONFLICT, error.message)
        throw error
      }
      return apiOk()
    case 'listEntries':
      if (!isList(body.list)) break
      return apiOk({ ids: store.listEntries(body.list) })
    case 'writeEntry':
      if (!isEntryOf(body.list, body.id) || typeof body.data !== 'string') break
      store.writeEntry(body.list, body.id, Buffer.from(body.data, 'base64'), typeof body.thumb === 'string' ? body.thumb : null)
      return apiOk()
    case 'readEntry': {
      if (!isEntryOf(body.list, body.id)) break
      try {
        return apiOk({ data: store.readEntry(body.list, body.id).toString('base64') })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return apiNotFound('Save entry content is missing', 'ENTRY_MISSING')
        throw error
      }
    }
    case 'readThumb':
      if (!isEntryOf(body.list, body.id)) break
      return apiOk({ thumb: store.readThumb(body.list, body.id) })
    case 'removeEntry':
      if (!isEntryOf(body.list, body.id)) break
      store.removeEntry(body.list, body.id)
      return apiOk()
  }
  return apiBadRequest('Invalid game saves store request', 'INVALID_REQUEST')
})
