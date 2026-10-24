import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { bindWriteBatchToGame } from '@/lib/game-agent/companion/memory-durable'
import { MemoryConflictError, MemorySchemaError, MemoryStaleError, validateWriteBatch } from '@/lib/game-agent/companion/memory-schema'
import { canUseDisk } from '@/lib/service-mode/mode'
import { barrierCompanionMemory, commitCompanionMemoryBatch, flushCompanionMemory, getCompanionMemorySnapshot } from '@/services/game-agent/companion-memory.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MEMORY_API_BODY_MAX_BYTES = 1024 * 1024

function requireGameId(value: string | null | undefined): string | null {
  const gameId = value?.trim()
  return gameId && gameId.length <= 500 ? gameId : null
}

function bodyBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > MEMORY_API_BODY_MAX_BYTES) {
    return { ok: false, response: apiBadRequest('Memory request body exceeds 1 MiB', 'MEMORY_BODY_TOO_LARGE') }
  }
  const raw = await request.text()
  if (bodyBytes(raw) > MEMORY_API_BODY_MAX_BYTES) {
    return { ok: false, response: apiBadRequest('Memory request body exceeds 1 MiB', 'MEMORY_BODY_TOO_LARGE') }
  }
  if (!raw.trim()) return { ok: true, body: null }
  try {
    return { ok: true, body: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, response: apiBadRequest('Invalid JSON body', 'MEMORY_BODY_INVALID') }
  }
}

export const GET = defineApiRoute('get:/api/game-agent/memory', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', 'Feature is only available in Chaya App or local service')
  const search = new URL(request.url).searchParams
  const gameId = requireGameId(search.get('gameId'))
  if (!gameId) return apiBadRequest('Missing game id', 'GAME_ID_REQUIRED')
  const runtimeInstanceId = search.get('runtimeInstanceId')?.trim() || undefined
  const snapshot = await getCompanionMemorySnapshot(gameId, runtimeInstanceId)
  return apiOk({
    snapshot,
    status: snapshot
      ? {
          memoryEpoch: snapshot.memoryEpoch,
          recordingRevision: snapshot.recordingRevision,
          recordingEnabled: snapshot.recordingEnabled,
          episodeCount: snapshot.episodes.length,
          persistence: 'ready' as const,
        }
      : {
          memoryEpoch: 1,
          recordingRevision: 1,
          recordingEnabled: true,
          episodeCount: 0,
          persistence: 'ready' as const,
        },
  })
})

export const POST = defineApiRoute('post:/api/game-agent/memory', async ({ request }) => {
  if (!canUseDisk()) return apiError(404, 'LOCAL_ONLY', 'Feature is only available in Chaya App or local service')
  const search = new URL(request.url).searchParams
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body as {
    action?: 'commit' | 'barrier' | 'flush'
    gameId?: string
    runtimeInstanceId?: string
    batch?: unknown
    memoryEpoch?: number
    recordingRevision?: number
    clear?: { libraryGameId?: string; preferences?: boolean; episodes?: boolean }
  } | null
  const gameId = requireGameId(body?.gameId || search.get('gameId'))
  if (!gameId) return apiBadRequest('Missing game id', 'GAME_ID_REQUIRED')
  const runtimeInstanceId = (body?.runtimeInstanceId || search.get('runtimeInstanceId') || undefined)?.trim() || undefined
  const action = body?.action || 'commit'
  try {
    if (action === 'flush') {
      await flushCompanionMemory(gameId, runtimeInstanceId)
      return apiOk({ flushed: true })
    }
    if (action === 'barrier') {
      if (!Number.isSafeInteger(body?.memoryEpoch) || !Number.isSafeInteger(body?.recordingRevision)) {
        return apiBadRequest('Invalid memory barrier', 'MEMORY_BARRIER_INVALID')
      }
      await barrierCompanionMemory(gameId, body!.memoryEpoch!, body!.recordingRevision!, runtimeInstanceId, body?.clear)
      return apiOk({ barrier: true, memoryEpoch: body!.memoryEpoch, recordingRevision: body!.recordingRevision })
    }
    const batch = bindWriteBatchToGame(validateWriteBatch(body?.batch), gameId)
    await commitCompanionMemoryBatch(gameId, batch, runtimeInstanceId)
    return apiOk({ stored: true, batchId: batch.batchId, memoryEpoch: batch.memoryEpoch })
  } catch (error) {
    if (error instanceof MemorySchemaError) return apiBadRequest(error.message, error.code)
    if (error instanceof MemoryConflictError || error instanceof MemoryStaleError) return apiError(409, error.code, error.message)
    throw error
  }
})
