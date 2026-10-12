import { randomBytes, timingSafeEqual } from 'node:crypto'
import http, { type IncomingMessage } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

import { SocksClient, type SocksProxy } from 'socks'

const CONNECT_TIMEOUT_MS = 10_000
const USER = 'chaya'

type Bridge = { url: string; close: () => Promise<void> }

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

async function startBridge(upstream: string): Promise<Bridge> {
  const proxy = socksProxy(upstream)
  const token = randomBytes(18).toString('base64url')
  const expected = Buffer.from(`Basic ${Buffer.from(`${USER}:${token}`).toString('base64')}`)
  const authorized = (request: IncomingMessage) => {
    const header = Buffer.from(String(request.headers['proxy-authorization'] || ''))
    return header.length === expected.length && timingSafeEqual(header, expected)
  }
  const open = async (target: { host: string; port: number }) =>
    (await SocksClient.createConnection({ proxy, command: 'connect', destination: target, timeout: CONNECT_TIMEOUT_MS })).socket

  const server = http.createServer((request, response) => {
    if (!authorized(request)) return void response.writeHead(407, { 'Proxy-Authenticate': `Basic realm="${USER}"` }).end()
    let url: URL
    try {
      url = new URL(request.url || '')
      if (url.protocol !== 'http:') throw new Error('unsupported')
    } catch {
      return void response.writeHead(400).end()
    }
    const headers = { ...request.headers }
    delete headers['proxy-authorization']
    delete headers['proxy-connection']
    const forward = http.request(
      {
        method: request.method,
        path: url.pathname + url.search,
        headers,
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
  server.on('error', () => bridges.delete(upstream))
  server.on('close', () => bridges.delete(upstream))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://${USER}:${token}@127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * Most CLIs only speak HTTP(S) proxies. A loopback HTTP proxy, guarded by a per-process password,
 * tunnels their traffic into the player's SOCKS5 proxy. One bridge per upstream, kept for the process lifetime.
 */
export async function socksBridgeUrl(upstream: string): Promise<string> {
  let bridge = bridges.get(upstream)
  if (!bridge) {
    bridge = startBridge(upstream)
    bridges.set(upstream, bridge)
    bridge.catch(() => bridges.delete(upstream))
  }
  return (await bridge).url
}

export async function closeSocksBridgesForTests() {
  const all = [...bridges.values()]
  bridges.clear()
  await Promise.all(all.map((bridge) => bridge.then((value) => value.close()).catch(() => undefined)))
}
