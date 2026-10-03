import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createMcpGateway, type McpGateway } from '@/lib/integration/mcp-gateway'
import { writeMcpPortConfig } from '@/lib/integration/mcp-port'
import { dispatchMcp, type McpServerConfig } from '@/lib/integration/mcp-protocol'

const SERVER: McpServerConfig = {
  serverInfo: { name: 'chaya', version: 'test' },
  tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' }, run: async (args) => args }],
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

type Reply = { status: number; text: string }

function send(port: number, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method ?? 'POST', path: opts.path ?? '/mcp', headers: { 'Content-Type': 'application/json', ...opts.headers } },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      }
    )
    req.on('error', reject)
    req.end(opts.body)
  })
}

describe('createMcpGateway', () => {
  let home: string
  const gateways: McpGateway[] = []
  const servers: http.Server[] = []
  const env = () => ({ platform: 'linux', home })
  const make = (role: 'server' | 'game', listen = true) => {
    const gateway = createMcpGateway({ http, fs, env: env(), identity: { chaya: true, role }, handle: (body) => dispatchMcp(SERVER, body), listen, retryMs: 60_000 })
    gateways.push(gateway)
    return gateway
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-mcp-gw-'))
  })
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((g) => g.stop()))
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('binds a free port, serves MCP and answers the identity probe', async () => {
    const port = await freePort()
    writeMcpPortConfig(fs, env(), port)
    const gateway = make('game')
    await gateway.start()
    expect(gateway.status()).toMatchObject({ state: 'listening', port, url: `http://127.0.0.1:${port}/mcp` })

    expect(JSON.parse((await send(port, { method: 'GET', path: '/.well-known/chaya-mcp' })).text)).toEqual({ chaya: true, role: 'game' })
    const list = await send(port, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(JSON.parse(list.text).result.tools.map((t: { name: string }) => t.name)).toEqual(['echo'])
    expect((await send(port, { body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status).toBe(202)
    expect(gateway.status().lastRequestAt).toEqual(expect.any(Number))
  })

  it('rejects browser origins, foreign hosts, non-JSON and GET', async () => {
    const port = await freePort()
    writeMcpPortConfig(fs, env(), port)
    await make('server').start()
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect((await send(port, { body, headers: { Origin: 'https://evil.test' } })).status).toBe(403)
    expect((await send(port, { body, headers: { Host: `evil.test:${port}` } })).status).toBe(403)
    expect((await send(port, { body, headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    expect((await send(port, { method: 'GET' })).status).toBe(405)
    expect((await send(port, { body, headers: { Host: `localhost:${port}` } })).status).toBe(200)
  })

  it('yields to another Chaya and reports a foreign holder as occupied', async () => {
    const port = await freePort()
    writeMcpPortConfig(fs, env(), port)
    await make('server').start()
    const second = make('game')
    await second.start()
    expect(second.status()).toMatchObject({ state: 'chaya', holder: { role: 'server' } })

    const other = await freePort()
    const foreign = http.createServer((_req, res) => res.end('hello'))
    servers.push(foreign)
    await new Promise<void>((r) => foreign.listen(other, '127.0.0.1', () => r()))
    writeMcpPortConfig(fs, env(), other)
    expect((await second.refresh()).state).toBe('occupied')
  })

  it('only reports when it must not bind', async () => {
    const port = await freePort()
    writeMcpPortConfig(fs, env(), port)
    expect((await make('game', false).refresh()).state).toBe('off')
  })

  it('moves to a new port, refuses an occupied one and resets to the default file state', async () => {
    const first = await freePort()
    writeMcpPortConfig(fs, env(), first)
    const gateway = make('game')
    await gateway.start()

    const next = await freePort()
    expect(await gateway.setPort(next)).toMatchObject({ state: 'listening', port: next, fileExists: true })
    expect((await send(next, { method: 'GET', path: '/.well-known/chaya-mcp' })).status).toBe(200)

    const busy = http.createServer()
    servers.push(busy)
    const busyPort = await freePort()
    await new Promise<void>((r) => busy.listen(busyPort, '127.0.0.1', () => r()))
    await expect(gateway.setPort(busyPort)).rejects.toThrow('已被占用')
    await expect(gateway.setPort(80)).rejects.toThrow()

    const reset = await gateway.resetPort()
    expect(reset.fileExists).toBe(false)
    expect(fs.existsSync(path.join(home, '.config', 'chaya'))).toBe(false)
  })
})
