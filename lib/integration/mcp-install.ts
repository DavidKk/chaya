/** MCP install links / commands for common agents (client-safe, no I/O). */

export type McpInstallInput = { name: string; url: string; token?: string | null }

export const CODEX_TOKEN_ENV = 'CHAYA_MCP_TOKEN'

function authHeaders(token?: string | null): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

function base64Utf8(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64')
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`
}

/** `mcpServers` entry for `~/.cursor/mcp.json` and similar JSON configs */
export function mcpJsonConfig({ name, url, token }: McpInstallInput) {
  const headers = authHeaders(token)
  return { mcpServers: { [name]: { url, ...(headers ? { headers } : {}) } } }
}

export function cursorInstallLink({ name, url, token }: McpInstallInput): string {
  const headers = authHeaders(token)
  const config = base64Utf8(JSON.stringify({ url, ...(headers ? { headers } : {}) }))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`
}

export function vscodeInstallLink({ name, url, token }: McpInstallInput): string {
  const headers = authHeaders(token)
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: 'http', url, ...(headers ? { headers } : {}) }))}`
}

export function claudeCodeInstallCommand({ name, url, token }: McpInstallInput): string {
  const header = token ? ` --header ${shellQuote(`Authorization: Bearer ${token}`)}` : ''
  return `claude mcp add --transport http --scope user ${shellQuote(name)} ${shellQuote(url)}${header}`
}

/** Codex reads the bearer token from an env var instead of storing it in config */
export function codexInstallCommand({ name, url, token }: McpInstallInput): string {
  const add = `codex mcp add ${shellQuote(name)} --url ${shellQuote(url)}`
  return token ? `export ${CODEX_TOKEN_ENV}=${shellQuote(token)} && ${add} --bearer-token-env-var ${CODEX_TOKEN_ENV}` : add
}
