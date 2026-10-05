import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { writeMcpPortConfig } from '@/lib/integration/mcp-port'
import { startGameGateway } from '@/plugins/src/agent/gateway'

type Globals = Record<string, unknown>

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

function rpc(port: number, body: unknown): Promise<{ result?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/mcp', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let text = ''
      res.on('data', (c) => (text += c))
      res.on('end', () => resolve(JSON.parse(text)))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

describe('in-game MCP gateway', () => {
  const g = globalThis as unknown as Globals
  const log = { info: jest.fn(), warn: jest.fn() }
  let home: string
  let prevHome: string | undefined
  let stop: (() => Promise<void>) | null = null

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-game-gw-'))
    prevHome = process.env.HOME
    process.env.HOME = home
    jest.spyOn(os, 'homedir').mockReturnValue(home)
    process.env.XDG_CONFIG_HOME = path.join(home, '.config')
    g.window = globalThis
    g.require = require
    g.$dataSystem = { gameTitle: 'Demo' }
  })
  afterEach(async () => {
    await stop?.()
    stop = null
    process.env.HOME = prevHome
    delete process.env.XDG_CONFIG_HOME
    for (const key of ['window', 'require', '$dataSystem', 'CHAYA_MCP_GATEWAY']) delete g[key]
    fs.rmSync(home, { recursive: true, force: true })
  })

  const portEnv = () => ({ platform: process.platform, home, appData: process.env.APPDATA, xdgConfigHome: process.env.XDG_CONFIG_HOME })

  it('serves live tools for this game only, without eval', async () => {
    const port = await freePort()
    writeMcpPortConfig(fs, portEnv(), port)
    g.CHAYA_MCP_GATEWAY = true
    const started = startGameGateway({ gameId: () => 'room-1', gameInfo: () => ({ name: 'Demo' }), log })
    stop = started.stop
    await started.control.refresh()
    expect(started.control.status()).toMatchObject({ state: 'listening', port })

    const list = await rpc(port, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const names = (list.result?.tools as { name: string }[]).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['chaya_live_games', 'chaya_live_state', 'chaya_live_call', 'chaya_live_press', 'chaya_live_play']))
    expect(names.some((n) => n === 'chaya_live_eval' || n.startsWith('chaya_library_'))).toBe(false)

    const state = await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'chaya_live_state', arguments: {} } })
    expect(state.result?.isError).toBe(false)
    expect(JSON.stringify(state.result)).toContain('Demo')

    const wrong = await rpc(port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'chaya_live_state', arguments: { gameId: 'other' } } })
    expect(wrong.result?.isError).toBe(true)
  })

  it('does not bind without the Edge flag but still manages the port', async () => {
    const port = await freePort()
    writeMcpPortConfig(fs, portEnv(), port)
    const started = startGameGateway({ gameId: () => 'room-1', gameInfo: () => ({}), log })
    stop = started.stop
    expect(started.control).toMatchObject({ available: true, enabled: false })
    expect((await started.control.refresh())?.state).toBe('off')
    expect((await started.control.resetPort()).fileExists).toBe(false)
  })

  it('is unavailable without a Node context', async () => {
    delete g.require
    const started = startGameGateway({ gameId: () => 'room-1', gameInfo: () => ({}), log })
    expect(started.control.available).toBe(false)
    expect(await started.control.refresh()).toBeNull()
    await expect(started.control.setPort(40000)).rejects.toThrow()
  })
})
