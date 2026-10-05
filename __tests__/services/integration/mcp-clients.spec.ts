import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { codexHasServer, findCli, getMcpClientsStatus } from '@/services/integration/mcp-clients'

describe('codexHasServer', () => {
  test('matches the chaya table only', () => {
    expect(codexHasServer('[mcp_servers.other]\nurl = "http://x"\n\n[mcp_servers.chaya]\nurl = "http://y"\n')).toBe(true)
    expect(codexHasServer('[mcp_servers."chaya"]\ncommand = "x"\n')).toBe(true)
    expect(codexHasServer('[mcp_servers.chaya_extra]\n[mcp_servers.other]\n')).toBe(false)
  })
})

describe('findCli', () => {
  test('finds a binary in the given dirs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cli-'))
    const bin = process.platform === 'win32' ? 'fake-cli.cmd' : 'fake-cli'
    fs.writeFileSync(path.join(dir, bin), '')
    expect(findCli('fake-cli', [dir])).toBe(path.join(dir, bin))
    expect(findCli('missing-cli', [dir])).toBeNull()
  })
})

describe('getMcpClientsStatus', () => {
  const saved = { CODEX_HOME: process.env.CODEX_HOME, PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR }
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-home-'))
    jest.spyOn(os, 'homedir').mockReturnValue(home)
    process.env.CODEX_HOME = path.join(home, '.codex')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test('reads Claude user scope and Codex config', () => {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { chaya: { type: 'http', url: 'http://x' } } }))
    const status = getMcpClientsStatus()
    expect(status.claude.installed).toBe(true)
    expect(status.codex.installed).toBe(false)

    fs.mkdirSync(path.join(home, '.codex'))
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.chaya]\nurl = "http://x"\n')
    expect(getMcpClientsStatus().codex.installed).toBe(true)
  })

  if (process.platform !== 'win32') {
    test('finds CLIs under nvm when PATH is minimal (GUI-launched App)', () => {
      process.env.PATH = '/nonexistent'
      process.env.NVM_DIR = path.join(home, '.nvm')
      const bin = path.join(home, '.nvm', 'versions', 'node', 'v22.0.0', 'bin')
      fs.mkdirSync(bin, { recursive: true })
      fs.writeFileSync(path.join(bin, 'codex'), '')
      expect(getMcpClientsStatus().codex.cli).toBe(true)
    })
  }
})
