import { claudeCodeInstallCommand, codexInstallCommand, cursorInstallLink, mcpJsonConfig, shellQuote, vscodeInstallLink } from '@/lib/integration/mcp-install'

const input = { name: 'chaya', url: 'http://localhost:3000/api/mcp' }

describe('MCP install links (no credentials)', () => {
  it('builds mcp.json with only the url', () => {
    expect(mcpJsonConfig(input)).toEqual({ mcpServers: { chaya: { url: input.url } } })
  })

  it('encodes the Cursor deeplink config as base64 JSON', () => {
    const link = new URL(cursorInstallLink(input))
    expect(link.protocol).toBe('cursor:')
    expect(link.searchParams.get('name')).toBe('chaya')
    const config = JSON.parse(Buffer.from(link.searchParams.get('config') || '', 'base64').toString('utf8'))
    expect(config).toEqual({ url: input.url })
  })

  it('encodes the VS Code link as http server JSON', () => {
    const link = vscodeInstallLink(input)
    expect(link.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)))).toEqual({ name: 'chaya', type: 'http', url: input.url })
  })

  it('builds CLI commands without credentials', () => {
    expect(claudeCodeInstallCommand(input)).toBe(`claude mcp add --transport http --scope user chaya ${input.url}`)
    expect(codexInstallCommand(input)).toBe(`codex mcp add chaya --url ${input.url}`)
  })

  it('shell-quotes single quotes safely', () => {
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`)
    expect(shellQuote('plain-value_1')).toBe('plain-value_1')
  })
})
