import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { getResolvedFromConfig } from '@/services/game/binding'
import { detectRgssPlugins, installRgssPlugins, listRgssPluginOutdatedFiles, RGSS_HOT_RELOAD_FILES, syncRgssHotReloadFiles } from '@/services/game/rgss-plugins'
import { rgssRuntimeStatus } from '@/services/game/rgss-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const hotFiles = new Set<string>(RGSS_HOT_RELOAD_FILES)
let applying = false

/**
 * Dev-only source-to-game sync. Polled by `rgss-sync`.
 *
 * Full installs are deferred while the selected game is running. When the
 * bridge is connected, only files reloadable by bridge.rb are copied; other
 * changes remain pending and are retried after the process exits.
 */
export const POST = defineApiRoute('post:/api/dev/rgss-sync', async () => {
  if (process.env.NODE_ENV !== 'development') return apiBadRequest('RGSS dev sync is only available in development')
  if (applying) return apiOk({ action: 'busy', reason: 'sync already in progress' })

  const resolved = getResolvedFromConfig()
  if (!resolved.ok) return apiOk({ action: 'idle', reason: resolved.error || 'no game selected' })
  if (resolved.remote) return apiOk({ action: 'idle', reason: 'selected game is remote' })
  if (resolved.engine !== 'VX Ace' && resolved.engine !== 'VX') return apiOk({ action: 'idle', reason: 'selected game is not RGSS' })
  if (!detectRgssPlugins(resolved.contentRoot)[0]?.registered) return apiOk({ action: 'idle', reason: 'ChayaRGSS is not installed' })

  const outdated = listRgssPluginOutdatedFiles(resolved.contentRoot)
  if (!outdated.length) return apiOk({ action: 'idle', reason: 'RGSS plugins are up to date' })

  const runtime = rgssRuntimeStatus(resolved.contentRoot)
  if (!runtime.running) {
    applying = true
    try {
      const result = installRgssPlugins(resolved.contentRoot)
      return apiOk({ action: 'installed', copied: result.copied })
    } catch (error) {
      return apiError(500, 'RGSS_SYNC_FAILED', error instanceof Error ? error.message : String(error))
    } finally {
      applying = false
    }
  }

  const hot = outdated.filter((name) => hotFiles.has(name))
  const deferred = outdated.filter((name) => !hotFiles.has(name))
  if (!runtime.bridgeConnected) {
    return apiOk({
      action: 'deferred',
      reason: 'game is running without a bridge connection',
      deferred: outdated,
    })
  }

  applying = true
  try {
    const result = hot.length ? syncRgssHotReloadFiles(resolved.contentRoot) : { copied: [] }
    return apiOk({
      action: result.copied.length ? 'hot' : deferred.length ? 'deferred' : 'idle',
      reason: result.copied.length ? undefined : deferred.length ? 'only non-reloadable files changed' : 'RGSS plugins are up to date',
      copied: result.copied,
      deferred,
    })
  } catch (error) {
    return apiError(500, 'RGSS_SYNC_FAILED', error instanceof Error ? error.message : String(error))
  } finally {
    applying = false
  }
})
