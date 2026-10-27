import fs from 'node:fs'
import path from 'node:path'

import { PLUGINS_DIR } from '@/constants/paths'
import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiError, apiOk } from '@/initializer/response'
import { getResolvedFromConfig } from '@/services/game/binding'
import { detectRgssPlugins, installRgssPlugins, listRgssPluginOutdatedFiles, RGSS_HOT_RELOAD_FILES, syncRgssHotReloadFiles } from '@/services/game/rgss-plugins'
import { onRgssRuntimeChange, rgssRuntimeStatus } from '@/services/game/rgss-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const hotFiles = new Set<string>(RGSS_HOT_RELOAD_FILES)
let applying = false

export type RgssSyncStatus =
  | { ok: true; action: 'busy'; reason: string }
  | { ok: true; action: 'idle'; reason: string }
  | { ok: true; action: 'installed'; copied: string[] }
  | { ok: true; action: 'hot'; copied: string[]; deferred?: string[] }
  | { ok: true; action: 'deferred'; reason?: string; deferred: string[] }
  | { ok: false; error: { code: string; message: string } }

/**
 * Execute a single sync evaluation and application.
 *
 * Full installs are deferred while the selected game is running. When the
 * bridge is connected, only files reloadable by bridge.rb are copied; other
 * changes remain pending and are retried after the process exits.
 */
export function executeRgssDevSync(): RgssSyncStatus {
  if (applying) return { ok: true, action: 'busy', reason: 'sync already in progress' }

  applying = true
  try {
    const resolved = getResolvedFromConfig()
    if (!resolved.ok) return { ok: true, action: 'idle', reason: resolved.error || 'no game selected' }
    if (resolved.remote) return { ok: true, action: 'idle', reason: 'selected game is remote' }
    if (resolved.engine !== 'VX Ace' && resolved.engine !== 'VX') return { ok: true, action: 'idle', reason: 'selected game is not RGSS' }
    if (!detectRgssPlugins(resolved.contentRoot)[0]?.registered) return { ok: true, action: 'idle', reason: 'ChayaRGSS is not installed' }

    const outdated = listRgssPluginOutdatedFiles(resolved.contentRoot)
    if (!outdated.length) return { ok: true, action: 'idle', reason: 'RGSS plugins are up to date' }

    const runtime = rgssRuntimeStatus(resolved.contentRoot)
    if (!runtime.running) {
      const result = installRgssPlugins(resolved.contentRoot)
      return { ok: true, action: 'installed', copied: result.copied }
    }

    const hot = outdated.filter((name) => hotFiles.has(name))
    const deferred = outdated.filter((name) => !hotFiles.has(name))
    if (!runtime.bridgeConnected) {
      return {
        ok: true,
        action: 'deferred',
        reason: 'game is running without a bridge connection',
        deferred: outdated,
      }
    }

    const result = hot.length ? syncRgssHotReloadFiles(resolved.contentRoot) : { copied: [] }
    if (result.copied.length) {
      return {
        ok: true,
        action: 'hot',
        copied: result.copied,
        deferred: deferred.length ? deferred : undefined,
      }
    }
    if (deferred.length) {
      return {
        ok: true,
        action: 'deferred',
        reason: 'only non-reloadable files changed',
        deferred,
      }
    }
    return {
      ok: true,
      action: 'idle',
      reason: 'RGSS plugins are up to date',
    }
  } catch (error) {
    return { ok: false, error: { code: 'RGSS_SYNC_FAILED', message: error instanceof Error ? error.message : String(error) } }
  } finally {
    applying = false
  }
}

/**
 * Dev-only source-to-game sync. One-shot invocation.
 */
export const POST = defineApiRoute('post:/api/dev/rgss-sync', async () => {
  if (process.env.NODE_ENV !== 'development') return apiBadRequest('RGSS dev sync is only available in development')
  const result = executeRgssDevSync()
  if (!result.ok) return apiError(500, result.error.code, result.error.message)
  const { ok: _ok, ...payload } = result
  return apiOk(payload)
})

const SSE_HEADERS = {
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'Content-Type': 'text/event-stream; charset=utf-8',
}

/**
 * Dev-only SSE stream for RGSS sync. Pushes sync status on connection, on
 * plugins/rgss file changes, and on RGSS runtime lifecycle transitions.
 */
export const GET = defineApiRoute('get:/api/dev/rgss-sync', async ({ request }) => {
  if (process.env.NODE_ENV !== 'development') return apiBadRequest('RGSS dev sync is only available in development')

  let closeStream = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      let watcher: fs.FSWatcher | undefined
      let debounceTimer: ReturnType<typeof setTimeout> | undefined
      let deferredCheckTimer: ReturnType<typeof setInterval> | undefined
      let unhookRuntime = () => {}

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          close()
        }
      }

      const checkAndSync = () => {
        if (closed) return
        const res = executeRgssDevSync()
        send('sync', res)

        const deferredCount = (res.ok && 'deferred' in res && res.deferred?.length) || 0
        if (deferredCount > 0 && !deferredCheckTimer) {
          deferredCheckTimer = setInterval(() => {
            if (closed) return
            const retryRes = executeRgssDevSync()
            send('sync', retryRes)
            const count = (retryRes.ok && 'deferred' in retryRes && retryRes.deferred?.length) || 0
            if (count === 0 && deferredCheckTimer) {
              clearInterval(deferredCheckTimer)
              deferredCheckTimer = undefined
            }
          }, 2000)
        } else if (deferredCount === 0 && deferredCheckTimer) {
          clearInterval(deferredCheckTimer)
          deferredCheckTimer = undefined
        }
      }

      // Initial check
      checkAndSync()

      // Watch plugins/rgss source directory
      const rgssDir = path.join(PLUGINS_DIR, 'rgss')
      if (fs.existsSync(rgssDir)) {
        try {
          watcher = fs.watch(rgssDir, { recursive: true }, () => {
            if (closed) return
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => {
              checkAndSync()
            }, 150)
          })
        } catch {
          /* Fallback: platforms where recursive fs.watch is unsupported */
        }
      }

      // Listen to game start / stop / error
      unhookRuntime =
        typeof onRgssRuntimeChange === 'function'
          ? onRgssRuntimeChange(() => {
              checkAndSync()
            })
          : () => {}

      // Heartbeat ping (every 15s)
      const ping = setInterval(() => {
        send('ping', { ts: Date.now() })
      }, 15000)

      function close() {
        if (closed) return
        closed = true
        clearInterval(ping)
        if (deferredCheckTimer) clearInterval(deferredCheckTimer)
        if (debounceTimer) clearTimeout(debounceTimer)
        unhookRuntime()
        try {
          watcher?.close()
        } catch {
          /* ignore */
        }
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      }
      closeStream = close

      if (request.signal.aborted) close()
      else request.signal.addEventListener('abort', close)
    },
    cancel() {
      closeStream()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
})
