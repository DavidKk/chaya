import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { findLibraryEntry, getGameFingerprint, getResolvedFromConfig, loadConfig, requireDisk, resolveGame } from '@/services/disk-ops'

export const runtime = 'nodejs'

/** 游戏指纹：引擎 / 版本 / 插件 / 壳。默认当前游戏；`?gameRoot=` 只接受游戏库里的条目。 */
export const GET = defineApiRoute('get:/api/game/fingerprint', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied

  const gameRoot = new URL(request.url).searchParams.get('gameRoot')?.trim()
  let resolved
  if (gameRoot) {
    const entry = findLibraryEntry(loadConfig().library, gameRoot)
    if (!entry) return apiBadRequest('Game not found in library', 'NOT_IN_LIBRARY')
    if (entry.remote) return apiBadRequest('Remote game cannot read local files', 'REMOTE_READ_ONLY')
    resolved = resolveGame(entry.gameRoot)
  } else {
    resolved = getResolvedFromConfig()
  }
  if (!resolved.ok) return apiBadRequest(resolved.error)
  if (resolved.remote) return apiBadRequest('Remote game cannot read local files', 'REMOTE_READ_ONLY')

  const fingerprint = getGameFingerprint(resolved)
  if (!fingerprint) return apiError(500, 'FINGERPRINT_FAILED', 'Failed to read game metadata')
  return apiOk({ gameRoot: resolved.selected, fingerprint })
})
