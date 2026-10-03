import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  deleteMcpPortConfig,
  MCP_GATEWAY_DEFAULT_PORT,
  mcpGatewayUrl,
  mcpPortConfigDir,
  mcpPortConfigFile,
  parseMcpPortConfig,
  readMcpPortState,
  writeMcpPortConfig,
} from '@/lib/integration/mcp-port'

describe('mcp-port paths', () => {
  it('uses the App data folder on macOS / Windows and XDG on Linux', () => {
    expect(mcpPortConfigFile({ platform: 'darwin', home: '/Users/a' })).toBe('/Users/a/Library/Application Support/Chaya/mcp.json')
    expect(mcpPortConfigFile({ platform: 'win32', home: 'C:\\Users\\a', appData: 'C:\\Users\\a\\AppData\\Roaming' })).toBe('C:\\Users\\a\\AppData\\Roaming\\Chaya\\mcp.json')
    expect(mcpPortConfigDir({ platform: 'win32', home: 'C:\\Users\\a' })).toBe('C:\\Users\\a\\AppData\\Roaming\\Chaya')
    expect(mcpPortConfigFile({ platform: 'linux', home: '/home/a' })).toBe('/home/a/.config/chaya/mcp.json')
    expect(mcpPortConfigFile({ platform: 'linux', home: '/home/a', xdgConfigHome: '/xdg/' })).toBe('/xdg/chaya/mcp.json')
  })

  it('accepts only integer ports in range', () => {
    expect(parseMcpPortConfig('{"port":40000}')).toBe(40000)
    expect(parseMcpPortConfig('{"port":80}')).toBeNull()
    expect(parseMcpPortConfig('{"port":"40000"}')).toBeNull()
    expect(parseMcpPortConfig('not json')).toBeNull()
    expect(parseMcpPortConfig(null)).toBeNull()
    expect(mcpGatewayUrl(40000)).toBe('http://127.0.0.1:40000/mcp')
  })
})

describe('mcp-port file', () => {
  let home: string
  const env = () => ({ platform: 'linux', home })

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-mcp-port-'))
  })
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  it('defaults without a file and never creates one for the default port', () => {
    expect(readMcpPortState(fs, env())).toMatchObject({ port: MCP_GATEWAY_DEFAULT_PORT, exists: false })
    writeMcpPortConfig(fs, env(), MCP_GATEWAY_DEFAULT_PORT)
    expect(fs.existsSync(mcpPortConfigDir(env()))).toBe(false)
  })

  it('writes, falls back on malformed content, and deletes back to default', () => {
    expect(writeMcpPortConfig(fs, env(), 40001)).toMatchObject({ port: 40001, exists: true })
    expect(fs.readdirSync(mcpPortConfigDir(env()))).toEqual(['mcp.json'])

    fs.writeFileSync(mcpPortConfigFile(env()), '{oops')
    expect(readMcpPortState(fs, env())).toMatchObject({ port: MCP_GATEWAY_DEFAULT_PORT, exists: true })

    writeMcpPortConfig(fs, env(), 40002)
    writeMcpPortConfig(fs, env(), MCP_GATEWAY_DEFAULT_PORT)
    expect(fs.existsSync(mcpPortConfigFile(env()))).toBe(false)
    expect(() => writeMcpPortConfig(fs, env(), 70000)).toThrow()
  })

  it('removes the folder only when it is empty', () => {
    writeMcpPortConfig(fs, env(), 40003)
    expect(deleteMcpPortConfig(fs, env())).toEqual({ deleted: true, dirRemoved: true })
    expect(fs.existsSync(mcpPortConfigDir(env()))).toBe(false)

    writeMcpPortConfig(fs, env(), 40004)
    fs.writeFileSync(path.join(mcpPortConfigDir(env()), 'app-data.json'), '{}')
    expect(deleteMcpPortConfig(fs, env())).toEqual({ deleted: true, dirRemoved: false })
    expect(fs.readdirSync(mcpPortConfigDir(env()))).toEqual(['app-data.json'])
    expect(deleteMcpPortConfig(fs, env())).toEqual({ deleted: false, dirRemoved: false })
  })
})
