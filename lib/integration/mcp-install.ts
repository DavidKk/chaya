/** MCP install links / commands for common agents (client-safe, no I/O). The local endpoint needs no credentials. */

export type McpInstallInput = { name: string; url: string }

function base64Utf8(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64')
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`
}

/** `mcpServers` entry for `~/.cursor/mcp.json` and similar JSON configs */
export function mcpJsonConfig({ name, url }: McpInstallInput) {
  return { mcpServers: { [name]: { url } } }
}

export function cursorInstallLink({ name, url }: McpInstallInput): string {
  const config = base64Utf8(JSON.stringify({ url }))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`
}

export function vscodeInstallLink({ name, url }: McpInstallInput): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: 'http', url }))}`
}

export function claudeCodeInstallCommand({ name, url }: McpInstallInput): string {
  return `claude mcp add --transport http --scope user ${shellQuote(name)} ${shellQuote(url)}`
}

export function codexInstallCommand({ name, url }: McpInstallInput): string {
  return `codex mcp add ${shellQuote(name)} --url ${shellQuote(url)}`
}
