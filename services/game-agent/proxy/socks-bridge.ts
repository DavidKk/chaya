import { randomBytes, timingSafeEqual } from 'node:crypto'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import type { AddressInfo, Socket } from 'node:net'

import { SocksClient, type SocksProxy } from 'socks'

import { agentProxyHeadersKey, isSocksProxy } from '@/lib/game-agent/proxy'

const CONNECT_TIMEOUT_MS = 10_000
const USER = 'chaya'

type Bridge = { url: string; close: () => Promise<void> }
type UpstreamKind = 'socks5' | 'http' | 'https'

const bridges = new Map<string, Promise<Bridge>>()

function bare(hostname: string) {
  return hostname.replace(/^\[|\]$/g, '')
}

function socksProxy(upstream: string): SocksProxy {
  const url = new URL(upstream)
  return {
    host: bare(url.hostname),
    port: Number(url.port) || 1080,
    type: 5,
    ...(url.username ? { userId: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}),
  }
}

/** `host:port` (CONNECT) or an absolute `http://` URL; the host is sent as a name so DNS resolves at the proxy. */
function destination(target: string) {
  const url = new URL(/^[a-z]+:\/\//i.test(target) ? target : `http://${target}`)
  return { host: bare(url.hostname), port: Number(url.port) || 80 }
}

function bridgeKey(upstream: string, headers: Record<string, string>) {
  return `${upstream}\n${agentProxyHeadersKey(headers)}`
}

function upstreamAuthHeader(upstream: URL): Record<string, string> {
  if (!upstream.username) return {}
  const token = Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString('base64')
  return { 'Proxy-Authorization': `Basic ${token}` }
}

async function openViaSocks(upstream: string, target: { host: string; port: number }) {
  return (await SocksClient.createConnection({ proxy: socksProxy(upstream), command: 'connect', destination: target, timeout: CONNECT_TIMEOUT_MS })).socket
}

function openViaHttpProxy(upstream: string, headers: Record<string, string>, target: { host: string; port: number }): Promise<Socket> {
  const url = new URL(upstream)
  const secure = url.protocol === 'https:'
  const port = Number(url.port) || (secure ? 443 : 80)
  const transport = secure ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request({
      host: bare(url.hostname),
      port,
      method: 'CONNECT',
      path: `${target.host}:${target.port}`,
      headers: { ...upstreamAuthHeader(url), ...headers, Host: `${target.host}:${target.port}` },
      timeout: CONNECT_TIMEOUT_MS,
    })
    request.once('connect', (response, socket) => {
      if ((response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300) return resolve(socket)
      socket.destroy()
      reject(new Error(`上游代理 CONNECT 失败（HTTP ${response.statusCode || 0}）`))
    })
    request.once('timeout', () => {
      request.destroy()
      reject(new Error('上游代理连接超时'))
    })
    request.once('error', reject)
    request.end()
  })
}

async function startBridge(upstream: string, headers: Record<string, string>, kind: UpstreamKind): Promise<Bridge> {
  const token = randomBytes(18).toString('base64url')
  const expected = Buffer.from(`Basic ${Buffer.from(`${USER}:${token}`).toString('base64')}`)
  const authorized = (request: IncomingMessage) => {
    const header = Buffer.from(String(request.headers['proxy-authorization'] || ''))
    return header.length === expected.length && timingSafeEqual(header, expected)
  }
  const open = (target: { host: string; port: number }) => (kind === 'socks5' ? openViaSocks(upstream, target) : openViaHttpProxy(upstream, headers, target))

  const server = http.createServer((request, response) => {
    if (!authorized(request)) return void response.writeHead(407, { 'Proxy-Authenticate': `Basic realm="${USER}"` }).end()
    let url: URL
    try {
      url = new URL(request.url || '')
      if (url.protocol !== 'http:') throw new Error('unsupported')
    } catch {
      return void response.writeHead(400).end()
    }
    const forwardHeaders = { ...request.headers }
    delete forwardHeaders['proxy-authorization']
    delete forwardHeaders['proxy-connection']
    const forward = http.request(
      {
        method: request.method,
        path: url.pathname + url.search,
        headers: forwardHeaders,
        createConnection: (_options, created) => {
          open(destination(url.href)).then(
            (socket) => created(null, socket),
            (error: Error) => created(error, undefined as unknown as Socket)
          )
          return undefined
        },
      },
      (reply) => {
        response.writeHead(reply.statusCode || 502, reply.headers)
        reply.pipe(response)
      }
    )
    forward.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    request.pipe(forward)
  })

  server.on('connect', (request: IncomingMessage, client: Socket, head: Buffer) => {
    client.on('error', () => client.destroy())
    if (!authorized(request)) return void client.end(`HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="${USER}"\r\nContent-Length: 0\r\n\r\n`)
    let target: { host: string; port: number }
    try {
      target = destination(request.url || '')
    } catch {
      return void client.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n')
    }
    open(target).then(
      (socket) => {
        if (client.destroyed) return void socket.destroy()
        socket.on('error', () => client.destroy())
        socket.on('close', () => client.destroy())
        client.on('close', () => socket.destroy())
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) socket.write(head)
        socket.pipe(client)
        client.pipe(socket)
      },
      () => client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
    )
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.unref()
  const key = bridgeKey(upstream, headers)
  server.on('error', () => bridges.delete(key))
  server.on('close', () => bridges.delete(key))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://${USER}:${token}@127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * Loopback HTTP proxy for CLIs / SDKs that only speak HTTP(S) proxies.
 * - socks5 upstreams always go through the bridge.
 * - http / https upstreams go through the bridge when custom proxy headers must be injected.
 */
export async function socksBridgeUrl(upstream: string, headers: Record<string, string> = {}): Promise<string> {
  const kind: UpstreamKind = isSocksProxy(upstream) ? 'socks5' : /^https:/i.test(upstream) ? 'https' : 'http'
  const key = bridgeKey(upstream, headers)
  let bridge = bridges.get(key)
  if (!bridge) {
    bridge = startBridge(upstream, headers, kind)
    bridges.set(key, bridge)
    bridge.catch(() => bridges.delete(key))
  }
  return (await bridge).url
}

export async function closeSocksBridgesForTests() {
  const all = [...bridges.values()]
  bridges.clear()
  await Promise.all(all.map((bridge) => bridge.then((value) => value.close()).catch(() => undefined)))
}
