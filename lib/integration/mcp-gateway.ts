/**
 * Fixed-port MCP gateway on 127.0.0.1, shared by the local server and the in-game ChayaAgent.
 * Node modules are injected (`node:http` on the server, NW.js `require('http')` in games), so this file bundles anywhere.
 */

import type { IncomingMessage, ServerResponse } from 'http'

import {
  deleteMcpPortConfig,
  isValidMcpPort,
  MCP_GATEWAY_PATH,
  MCP_GATEWAY_PROBE_PATH,
  MCP_PORT_MAX,
  MCP_PORT_MIN,
  type McpGatewayIdentity,
  mcpGatewayUrl,
  type McpPortEnv,
  type McpPortFs,
  readMcpPortState,
  writeMcpPortConfig,
} from './mcp-port'
import type { McpHttpResult } from './mcp-protocol'

export type McpGatewayState = 'starting' | 'listening' | 'chaya' | 'occupied' | 'off'

export type McpGatewayStatus = {
  state: McpGatewayState
  port: number
  url: string
  file: string
  dir: string
  fileExists: boolean
  /** Who holds the port when `state === 'chaya'` */
  holder?: McpGatewayIdentity
  /** Last `POST /mcp` handled by this process (ms epoch) */
  lastRequestAt?: number
}

type GatewayFs = McpPortFs & Pick<typeof import('fs'), 'watchFile' | 'unwatchFile'>

/** `window.ChayaAgent.gateway`: what the in-game panel reads and drives */
export type McpGatewayControl = {
  /** Node context present (NW.js); without it nothing below works */
  available: boolean
  /** This game may bind the port (Edge-installed plugins only) */
  enabled: boolean
  status: () => McpGatewayStatus | null
  refresh: () => Promise<McpGatewayStatus | null>
  setPort: (port: number) => Promise<McpGatewayStatus>
  resetPort: () => Promise<McpGatewayStatus>
  /** JSON-RPC straight into this game's MCP server (in-game playground); works without Node */
  rpc: (body: unknown) => Promise<McpHttpResult>
  openFolder: () => void
  openDocs: () => void
}

export type McpGatewayDeps = {
  http: Pick<typeof import('http'), 'createServer' | 'request'>
  fs: GatewayFs
  env: McpPortEnv
  identity: McpGatewayIdentity
  handle: (body: unknown) => Promise<McpHttpResult>
  /** false: never bind, only report who holds the port; a function is re-read on every check (dev target switch) */
  listen?: boolean | (() => boolean)
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
  retryMs?: number
}

export type McpGateway = {
  start: () => Promise<void>
  stop: () => Promise<void>
  refresh: () => Promise<McpGatewayStatus>
  status: () => McpGatewayStatus
  setPort: (port: number) => Promise<McpGatewayStatus>
  /** Delete `mcp.json` (and its folder when empty): back to the default port */
  resetPort: () => Promise<McpGatewayStatus>
}

type ProbeResult = { kind: 'free' } | { kind: 'chaya'; identity: McpGatewayIdentity } | { kind: 'foreign' }

const MAX_BODY_BYTES = 4 * 1024 * 1024
const PROBE_TIMEOUT_MS = 800

/** Ask whoever listens on `port` whether it is a Chaya gateway. */
export function probeMcpGateway(http: McpGatewayDeps['http'], port: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: MCP_GATEWAY_PROBE_PATH, method: 'GET', timeout: PROBE_TIMEOUT_MS }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        if (text.length < 4096) text += chunk
      })
      res.on('end', () => {
        try {
          const body = JSON.parse(text) as Partial<McpGatewayIdentity>
          resolve(body?.chaya === true && (body.role === 'server' || body.role === 'game') ? { kind: 'chaya', identity: body as McpGatewayIdentity } : { kind: 'foreign' })
        } catch {
          resolve({ kind: 'foreign' })
        }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'ECONNREFUSED' ? { kind: 'free' } : { kind: 'foreign' }))
    req.end()
  })
}

function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (body === null) {
    res.writeHead(status)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createMcpGateway(deps: McpGatewayDeps): McpGateway {
  const { http, fs, env, identity, handle, listen = true, log, retryMs = 5_000 } = deps
  let server: import('http').Server | null = null
  let boundPort = 0
  const shouldListen = () => (typeof listen === 'function' ? listen() : listen)
  let state: McpGatewayState = shouldListen() ? 'starting' : 'off'
  let holder: McpGatewayIdentity | undefined
  let lastRequestAt: number | undefined
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let watching = ''
  let running = false
  let busy: Promise<void> | null = null

  function status(): McpGatewayStatus {
    const config = readMcpPortState(fs, env)
    const port = boundPort || config.port
    return { state, port, url: mcpGatewayUrl(port), file: config.file, dir: config.dir, fileExists: config.exists, holder, lastRequestAt }
  }

  async function onRequest(req: IncomingMessage, res: ServerResponse) {
    try {
      if (req.headers.origin) return sendJson(res, 403, { error: 'cross-site requests are not allowed' })
      if (!hostAllowed(req.headers.host, boundPort)) return sendJson(res, 403, { error: 'host not allowed' })
      const path = (req.url || '/').split('?')[0]
      if (path === MCP_GATEWAY_PROBE_PATH && req.method === 'GET') return sendJson(res, 200, identity)
      if (path !== MCP_GATEWAY_PATH) return sendJson(res, 404, { error: 'not found' })
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' })
      if (!String(req.headers['content-type'] || '').includes('application/json')) return sendJson(res, 415, { error: 'Content-Type must be application/json' })
      const text = await readBody(req)
      let body: unknown = null
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
      lastRequestAt = Date.now()
      const result = await handle(body)
      sendJson(res, result.status, result.body)
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  function close(): Promise<void> {
    const current = server
    server = null
    boundPort = 0
    if (!current) return Promise.resolve()
    return new Promise((resolve) => current.close(() => resolve()))
  }

  function bind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const next = http.createServer((req, res) => void onRequest(req, res))
      next.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') log?.warn(`MCP 网关监听失败：${err.message}`)
        resolve(false)
      })
      next.listen(port, '127.0.0.1', () => {
        server = next
        boundPort = port
        resolve(true)
      })
    })
  }

  function scheduleRetry() {
    if (retryTimer || !running) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void ensure()
    }, retryMs)
    ;(retryTimer as { unref?: () => void }).unref?.()
  }

  async function settle(port: number) {
    const wanted = shouldListen()
    if (server && boundPort === port && wanted) return
    if (server) await close()
    const probe = await probeMcpGateway(http, port)
    if (probe.kind === 'chaya') {
      state = 'chaya'
      holder = probe.identity
    } else if (probe.kind === 'foreign') {
      state = 'occupied'
      holder = undefined
    } else if (!wanted) {
      state = 'off'
      holder = undefined
    } else if (await bind(port)) {
      if (state !== 'listening') log?.info(`MCP 网关已开启：${mcpGatewayUrl(port)}`)
      state = 'listening'
      holder = undefined
      return
    } else {
      // Lost a race for the port: look again on the next retry.
      state = 'occupied'
    }
    scheduleRetry()
  }

  function ensure(): Promise<void> {
    if (!busy) {
      busy = settle(readMcpPortState(fs, env).port).finally(() => {
        busy = null
      })
    }
    return busy
  }

  function watch() {
    const { file } = readMcpPortState(fs, env)
    if (watching === file) return
    if (watching) fs.unwatchFile(watching)
    watching = file
    fs.watchFile(file, { interval: 2_000, persistent: false }, () => void ensure())
  }

  async function portFree(port: number): Promise<boolean> {
    if (server && boundPort === port) return true
    const probe = await probeMcpGateway(http, port)
    if (probe.kind !== 'free') return probe.kind === 'chaya'
    const test = http.createServer()
    return new Promise((resolve) => {
      test.once('error', () => resolve(false))
      test.listen(port, '127.0.0.1', () => test.close(() => resolve(true)))
    })
  }

  return {
    status,
    async start() {
      if (running) return
      running = true
      watch()
      await ensure()
    },
    async stop() {
      running = false
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      if (watching) fs.unwatchFile(watching)
      watching = ''
      await close()
    },
    async refresh() {
      await ensure()
      return status()
    },
    async setPort(port) {
      if (!isValidMcpPort(port)) throw new Error(`端口需为 ${MCP_PORT_MIN}–${MCP_PORT_MAX} 的整数`)
      if (!(await portFree(port))) throw new Error(`端口 ${port} 已被占用`)
      writeMcpPortConfig(fs, env, port)
      await ensure()
      return status()
    },
    async resetPort() {
      deleteMcpPortConfig(fs, env)
      await ensure()
      return status()
    },
  }
}
