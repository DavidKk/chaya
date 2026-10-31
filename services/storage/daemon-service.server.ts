import { randomBytes } from 'node:crypto'
import http from 'node:http'
import path from 'node:path'

import { openCompanionMemoryDb } from '@/services/game-agent/companion-memory-db'
import { operationId, startOperation } from '@/services/log/operation'
import { openSharedCacheDb } from '@/services/translate/shared-cache/db'
import { waitSharedCacheHeavyMigrate } from '@/services/translate/shared-cache/migrate-bg'

import { acquireStorageDaemonLock, readStorageDaemonMeta } from './daemon-lock'
import { recoverDatabaseCutoverState } from './migration/atomic-cutover'
import { createStorageRpc } from './rpc.server'
import { getBoundedSnapshot, lookupTranslation, type TranslationCommitInput } from './translation-store'

export type DaemonServerOptions = {
  dataDir: string
  port?: number
  authToken?: string
  idleTimeoutMs?: number
}

export type StorageDaemonServer = {
  port: number
  authToken: string
  close(): Promise<void>
  ref(): void
  unref(): void
}

const MAX_BODY_BYTES = 1024 * 1024

/** Starts an isolated loopback server; callers still own client integration. */
export async function startStorageDaemon(options: DaemonServerOptions): Promise<StorageDaemonServer> {
  const authToken = options.authToken || randomBytes(32).toString('hex')
  const initialPort = options.port ?? 3927
  if (!authToken || !Number.isInteger(initialPort) || initialPort < 0 || initialPort > 65535) throw new Error('Invalid daemon options')
  const lockHandle = acquireStorageDaemonLock({ dataDir: options.dataDir, port: 0, authToken })
  if (!lockHandle) {
    const existing = readStorageDaemonMeta(options.dataDir)
    throw new Error(existing ? `Storage daemon already running on port ${existing.port} (pid: ${existing.pid})` : 'Failed to acquire storage daemon lock')
  }

  let sharedDb: ReturnType<typeof openSharedCacheDb>['db'] | undefined
  let companionDb: ReturnType<typeof openCompanionMemoryDb>['db'] | undefined
  let rpc: ReturnType<typeof createStorageRpc> | undefined
  const clientLeases = new Map<string, number>()
  const idleTimeout = options.idleTimeoutMs ?? 10 * 60 * 1000
  let idleTimer: NodeJS.Timeout | undefined
  let leasePruner: NodeJS.Timeout | undefined
  let closing: Promise<void> | undefined
  let activeRequests = 0
  let lastActivity = Date.now()
  let unreferenced = false

  const json = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  const server = http.createServer((req, res) => {
    const timing = startOperation(
      'storage',
      'storage.http',
      { method: req.method, path: (req.url || '/').split('?')[0] },
      {
        start: false,
        operationId: typeof req.headers['x-chaya-request-id'] === 'string' ? req.headers['x-chaya-request-id'] : undefined,
      }
    )
    activeRequests++
    lastActivity = Date.now()
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = undefined
    res.once('close', () => {
      timing.end(res.writableFinished ? (res.statusCode >= 500 ? 'failed' : 'completed') : 'cancelled', { status: res.statusCode })
      activeRequests--
      lastActivity = Date.now()
      scheduleIdle()
    })
    void handle(req, res).catch((error: unknown) => {
      if (!res.headersSent && !res.destroyed) {
        const code = (error as { code?: unknown } | null)?.code
        json(res, error instanceof SyntaxError || error instanceof TypeError ? 400 : 500, {
          error: (error as Error).message,
          ...(typeof code === 'string' ? { code } : {}),
        })
      } else res.destroy()
    })
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000

  function scheduleIdle() {
    if (closing || idleTimer || activeRequests || clientLeases.size) return
    idleTimer = setTimeout(
      () => {
        void close().catch(() => undefined)
      },
      Math.max(1, idleTimeout - (Date.now() - lastActivity))
    )
    if (unreferenced) idleTimer.unref()
  }

  function close(): Promise<void> {
    if (closing) return closing
    closing = (async () => {
      if (idleTimer) clearTimeout(idleTimer)
      if (leasePruner) clearInterval(leasePruner)
      try {
        if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      } finally {
        try {
          await rpc?.close()
        } finally {
          // Keep ownership until all database connections have been closed.
          try {
            sharedDb?.$client.close()
          } finally {
            try {
              companionDb?.$client.close()
            } finally {
              lockHandle!.release()
            }
          }
        }
      }
    })()
    return closing
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (closing) return json(res, 503, { error: 'Storage daemon is shutting down' })
    if (req.headers['x-chaya-auth-token'] !== authToken) return json(res, 401, { error: 'Unauthorized' })
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/api/storage/ping') {
      return json(res, 200, { ok: true, instanceId: lockHandle!.meta.instanceId, pid: process.pid, protocolVersion: 1 })
    }
    if (req.method === 'POST' && url.pathname === '/api/storage/heartbeat') {
      const clientId = url.searchParams.get('clientId')
      if (!clientId || clientId.length > 200) return json(res, 400, { error: 'clientId is required' })
      if (!clientLeases.has(clientId) && clientLeases.size >= 1024) return json(res, 429, { error: 'Too many client leases' })
      clientLeases.set(clientId, Date.now())
      return json(res, 200, { ok: true, activeLeases: clientLeases.size })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/storage/translations/')) {
      const gameId = url.searchParams.get('gameId') || ''
      if (!gameId || gameId.length > 200) return json(res, 400, { error: 'gameId is required' })
      const srcLang = url.searchParams.get('srcLang') || 'ja'
      const tgtLang = url.searchParams.get('tgtLang') || 'zh'
      if (url.pathname === '/api/storage/translations/snapshot')
        return json(
          res,
          200,
          getBoundedSnapshot(sharedDb!, gameId, srcLang, tgtLang, {
            gameAfter: url.searchParams.get('gameAfter') || undefined,
            sharedAfter: url.searchParams.get('sharedAfter') || undefined,
            pageSize: Number(url.searchParams.get('pageSize')) || undefined,
          })
        )
      if (url.pathname === '/api/storage/translations/lookup') return json(res, 200, lookupTranslation(sharedDb!, gameId, url.searchParams.get('src') || '', srcLang, tgtLang))
    }
    if (req.method === 'POST' && url.pathname === '/api/storage/translations/commit') {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_BODY_BYTES) {
          json(res, 413, { error: 'Commit body exceeds 1 MiB' })
          return
        }
        chunks.push(buffer)
      }
      return json(res, 200, await rpc!.call('translations.commit', [JSON.parse(Buffer.concat(chunks).toString('utf8')) as TranslationCommitInput]))
    }
    if (req.method === 'POST' && url.pathname === '/api/storage/rpc') {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 16 * MAX_BODY_BYTES) return json(res, 413, { error: 'Storage request exceeds 16 MiB' })
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { method?: unknown; args?: unknown; requestId?: unknown; sentAt?: unknown }
      if (typeof body.method !== 'string' || !Array.isArray(body.args)) throw new TypeError('Invalid storage request')
      const requestId = operationId(typeof body.requestId === 'string' ? body.requestId : undefined)
      res.setHeader('X-Chaya-Request-Id', requestId)
      const receivedAt = Date.now()
      let execution = { queueMs: 0, executeMs: 0 }
      try {
        const value = await rpc!.call(body.method, body.args, requestId, (timing) => {
          execution = timing
        })
        return json(res, 200, { value, timing: { ...execution, receivedAt, respondedAt: Date.now() } })
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code
        return json(res, 500, {
          error: error instanceof Error ? error.message : String(error),
          ...(typeof code === 'string' ? { code } : {}),
          timing: { ...execution, receivedAt, respondedAt: Date.now() },
        })
      }
    }
    json(res, 404, { error: 'Not Found' })
  }

  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        server.off('listening', ready)
        reject(error)
      }
      const ready = () => {
        server.off('error', fail)
        resolve()
      }
      server.once('error', fail)
      server.once('listening', ready)
      server.listen(port, '127.0.0.1')
    })
  try {
    for (const file of ['translate-cache/shared.sqlite', 'companion-memory/companion.sqlite']) {
      recoverDatabaseCutoverState(path.join(lockHandle.meta.dataDir, file))
    }
    sharedDb = openSharedCacheDb(path.join(lockHandle.meta.dataDir, 'translate-cache', 'shared.sqlite')).db
    await waitSharedCacheHeavyMigrate(path.join(lockHandle.meta.dataDir, 'translate-cache', 'shared.sqlite'))
    companionDb = openCompanionMemoryDb(path.join(lockHandle.meta.dataDir, 'companion-memory', 'companion.sqlite')).db
    rpc = createStorageRpc(sharedDb, companionDb, lockHandle.meta.dataDir)
    try {
      await listen(initialPort)
    } catch (error) {
      if (initialPort === 0 || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      await listen(0)
    }
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing daemon listen address')
    lockHandle.publishPort(address.port)
    leasePruner = setInterval(() => {
      const cutoff = Date.now() - 90000
      for (const [id, seen] of clientLeases) if (seen < cutoff) clientLeases.delete(id)
      scheduleIdle()
    }, 30000)
    scheduleIdle()
    return {
      port: address.port,
      authToken,
      close,
      ref() {
        unreferenced = false
        server.ref()
        leasePruner?.ref()
        idleTimer?.ref()
      },
      unref() {
        unreferenced = true
        server.unref()
        leasePruner?.unref()
        idleTimer?.unref()
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
