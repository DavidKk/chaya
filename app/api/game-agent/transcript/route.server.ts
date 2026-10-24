import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { requireDisk } from '@/lib/service-mode'
import { loadConfig } from '@/services/game/config'
import { storageCall } from '@/services/storage/client'

export const runtime = 'nodejs'

function gameRoot(request: Request) {
  const id = new URL(request.url).searchParams.get('gameId')
  return loadConfig().library.find((entry) => entry.id === id && !entry.remote)?.gameRoot
}

export const GET = defineApiRoute('get:/api/game-agent/transcript', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const root = gameRoot(request)
  if (!root) return apiBadRequest('Local game is required')
  return apiOk({ transcript: storageCall('game.read', [root, 'companionTranscript']) })
})

export const PUT = defineApiRoute('put:/api/game-agent/transcript', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const root = gameRoot(request)
  if (!root) return apiBadRequest('Local game is required')
  const raw = await request.text()
  if (Buffer.byteLength(raw) > 1024 * 1024) return apiBadRequest('Transcript exceeds 1 MiB')
  const body = JSON.parse(raw) as { transcript?: { messages?: unknown[]; activity?: unknown[] } }
  if (!Array.isArray(body.transcript?.messages) || !Array.isArray(body.transcript.activity)) return apiBadRequest('Invalid transcript')
  storageCall('game.write', [root, 'companionTranscript', { messages: body.transcript.messages.slice(-200), activity: body.transcript.activity.slice(-200) }])
  return apiOk({ ok: true })
})
