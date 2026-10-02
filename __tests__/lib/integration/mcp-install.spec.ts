import { claudeCodeInstallCommand, CODEX_TOKEN_ENV, codexInstallCommand, cursorInstallLink, mcpJsonConfig, shellQuote, vscodeInstallLink } from '@/lib/integration/mcp-install'

const input = { name: 'chaya', url: 'http://127.0.0.1:3927/api/mcp', token: 'tok-123' }

describe('MCP install links', () => {
  it('builds mcp.json with the bearer header', () => {
    expect(mcpJsonConfig(input)).toEqual({ mcpServers: { chaya: { url: input.url, headers: { Authorization: 'Bearer tok-123' } } } })
    expect(mcpJsonConfig({ ...input, token: null })).toEqual({ mcpServers: { chaya: { url: input.url } } })
  })

  it('encodes the Cursor deeplink config as base64 JSON', () => {
    const link = new URL(cursorInstallLink(input))
    expect(link.protocol).toBe('cursor:')
    expect(link.searchParams.get('name')).toBe('chaya')
    const config = JSON.parse(Buffer.from(link.searchParams.get('config') || '', 'base64').toString('utf8'))
    expect(config).toEqual({ url: input.url, headers: { Authorization: 'Bearer tok-123' } })
  })

  it('encodes the VS Code link as http server JSON', () => {
    const link = vscodeInstallLink(input)
    expect(link.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'chaya',
      type: 'http',
      url: input.url,
      headers: { Authorization: 'Bearer tok-123' },
    })
  })

  it('quotes the Claude Code header and keeps Codex token in an env var', () => {
    expect(claudeCodeInstallCommand(input)).toBe(`claude mcp add --transport http --scope user chaya ${input.url} --header 'Authorization: Bearer tok-123'`)
    const codex = codexInstallCommand(input)
    expect(codex).toBe(`export ${CODEX_TOKEN_ENV}=tok-123 && codex mcp add chaya --url ${input.url} --bearer-token-env-var ${CODEX_TOKEN_ENV}`)
    expect(codexInstallCommand({ ...input, token: null })).toBe(`codex mcp add chaya --url ${input.url}`)
  })

  it('shell-quotes single quotes safely', () => {
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`)
    expect(shellQuote('plain-value_1')).toBe('plain-value_1')
  })
})
