import http from 'node:http'
import net, { type AddressInfo } from 'node:net'

import { fetch as undiciFetch, ProxyAgent } from 'undici'

import { agentProxyEnv, ollamaFetch } from '@/services/game-agent/proxy/agent-proxy'
import { closeSocksBridgesForTests } from '@/services/game-agent/proxy/socks-bridge'

type Closable = { close: (callback?: () => void) => unknown }

const servers: Closable[] = []
const sockets = new Set<net.Socket>()

function listen<T extends net.Server>(server: T): Promise<number> {
  servers.push(server)
  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

/** Just enough SOCKS5 (no auth, CONNECT, IPv4 or domain) to observe what the bridge asks for. */
async function socksServer() {
  const seen: string[] = []
  const server = net.createServer((client) => {
    client.once('data', () => {
      client.write(Buffer.from([5, 0]))
      client.once('data', (request: Buffer) => {
        const domain = request[3] === 3
        const host = domain ? request.subarray(5, 5 + request[4]).toString() : [...request.subarray(4, 8)].join('.')
        const port = request.readUInt16BE(domain ? 5 + request[4] : 8)
        seen.push(`${host}:${port}`)
        const upstream = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          upstream.pipe(client)
          client.pipe(upstream)
        })
        upstream.on('error', () => client.destroy())
      })
    })
  })
  return { port: await listen(server), seen }
}

async function targetServer() {
  return listen(http.createServer((request, response) => response.end(`hello ${request.url}`)))
}

afterEach(async () => {
  await closeSocksBridgesForTests()
  for (const socket of sockets) socket.destroy()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

test('no proxy leaves the environment alone', async () => {
  await expect(agentProxyEnv('')).resolves.toEqual({})
})

test('an HTTP proxy fills http https all and ftp env vars from one default', async () => {
  const env = await agentProxyEnv('127.0.0.1:7890')
  expect(env).toMatchObject({
    HTTP_PROXY: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    ALL_PROXY: 'http://127.0.0.1:7890',
    FTP_PROXY: 'http://127.0.0.1:7890',
    all_proxy: 'http://127.0.0.1:7890',
    ftp_proxy: 'http://127.0.0.1:7890',
    no_proxy: 'localhost,127.0.0.1,::1',
  })
})

test('per-protocol overrides can diverge from the default', async () => {
  const env = await agentProxyEnv({ proxy: 'http://127.0.0.1:7890', proxyProtocols: { https: 'http://127.0.0.1:7891' } })
  expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
  expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7891')
  expect(env.FTP_PROXY).toBe('http://127.0.0.1:7890')
})

test('a SOCKS5 proxy is reached through a password-protected loopback HTTP bridge', async () => {
  const socks = await socksServer()
  const target = await targetServer()
  const env = await agentProxyEnv(`socks5://127.0.0.1:${socks.port}`)
  const bridge = env.HTTPS_PROXY
  expect(bridge).toMatch(/^http:\/\/chaya:[\w-]+@127\.0\.0\.1:\d+$/)
  await expect(agentProxyEnv(`socks5://127.0.0.1:${socks.port}`)).resolves.toMatchObject({ HTTPS_PROXY: bridge })

  const tunneled = await undiciFetch(`http://localhost:${target}/via-connect`, { dispatcher: new ProxyAgent(bridge) })
  expect(await tunneled.text()).toBe('hello /via-connect')
  expect(socks.seen).toContain(`localhost:${target}`)

  const url = new URL(bridge)
  const plain = await new Promise<string>((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: `http://localhost:${target}/plain`,
        headers: { 'Proxy-Authorization': `Basic ${Buffer.from(`${url.username}:${url.password}`).toString('base64')}` },
      },
      (response) => {
        let body = ''
        response.on('data', (chunk) => (body += chunk))
        response.on('end', () => resolve(body))
      }
    )
    request.on('error', reject)
    request.end()
  })
  expect(plain).toBe('hello /plain')
})

test('the bridge refuses clients without its password', async () => {
  const socks = await socksServer()
  const { HTTPS_PROXY } = await agentProxyEnv(`socks5://127.0.0.1:${socks.port}`)
  const url = new URL(HTTPS_PROXY)
  const status = await new Promise<number>((resolve, reject) => {
    const request = http.request({ host: url.hostname, port: url.port, method: 'CONNECT', path: 'example.com:443' })
    request.on('connect', (response, socket) => {
      socket.destroy()
      resolve(response.statusCode || 0)
    })
    request.on('response', (response) => resolve(response.statusCode || 0))
    request.on('error', reject)
    request.end()
  })
  expect(status).toBe(407)
  expect(socks.seen).toEqual([])
})

test('Ollama requests go through the proxy unless the endpoint is on this machine', async () => {
  const target = await targetServer()
  expect(ollamaFetch({ endpoint: `http://127.0.0.1:${target}`, proxy: 'http://127.0.0.1:1' })).toBe(fetch)
  expect(ollamaFetch({ endpoint: 'http://ollama.lan:11434', proxy: '' })).toBe(fetch)

  const socks = await socksServer()
  const proxied = ollamaFetch({ endpoint: `http://ollama.test:${target}`, proxy: `socks5://127.0.0.1:${socks.port}` })
  expect(proxied).not.toBe(fetch)
  const response = await proxied(`http://localhost:${target}/api/tags`)
  expect(await response.text()).toBe('hello /api/tags')
  expect(socks.seen).toContain(`localhost:${target}`)
})
