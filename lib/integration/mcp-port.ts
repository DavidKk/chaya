/**
 * Unified MCP gateway port: one per-user `mcp.json` shared by every game, the local server and the App.
 * Path rules are pure; file operations take an injected `fs` (Node in the server, NW.js `require('fs')` in games).
 */

export const MCP_GATEWAY_DEFAULT_PORT = 39271
export const MCP_GATEWAY_PATH = '/mcp'
export const MCP_GATEWAY_PROBE_PATH = '/.well-known/chaya-mcp'
export const MCP_PORT_MIN = 1024
export const MCP_PORT_MAX = 65535
export const MCP_PORT_FILE_NAME = 'mcp.json'
export const MCP_DOCS_URL = 'https://github.com/DavidKk/chaya/blob/main/docs/integration.md'

/** `GET MCP_GATEWAY_PROBE_PATH` body: tells another Chaya who holds the port */
export type McpGatewayIdentity = { chaya: true; role: 'server' | 'game'; gameId?: string; name?: string }

export type McpPortEnv = {
  platform: string
  home: string
  appData?: string
  xdgConfigHome?: string
}

export type McpPortFs = Pick<typeof import('fs'), 'existsSync' | 'readFileSync' | 'writeFileSync' | 'renameSync' | 'mkdirSync' | 'unlinkSync' | 'readdirSync' | 'rmdirSync'>

function joinPath(platform: string, ...parts: string[]): string {
  const sep = platform === 'win32' ? '\\' : '/'
  return parts
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep)
}

/** Same folder as the packaged App's `userData` on macOS / Windows (`productName: Chaya`); XDG on Linux. */
export function mcpPortConfigDir(env: McpPortEnv): string {
  if (env.platform === 'darwin') return joinPath(env.platform, env.home, 'Library', 'Application Support', 'Chaya')
  if (env.platform === 'win32') return joinPath(env.platform, env.appData || joinPath(env.platform, env.home, 'AppData', 'Roaming'), 'Chaya')
  return joinPath(env.platform, env.xdgConfigHome || joinPath(env.platform, env.home, '.config'), 'chaya')
}

export function mcpPortConfigFile(env: McpPortEnv): string {
  return joinPath(env.platform, mcpPortConfigDir(env), MCP_PORT_FILE_NAME)
}

export function isValidMcpPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= MCP_PORT_MIN && port <= MCP_PORT_MAX
}

/** File text → port; missing / malformed / out of range → null (caller falls back to the default). */
export function parseMcpPortConfig(text: string | null | undefined): number | null {
  if (!text) return null
  try {
    const port = (JSON.parse(text) as { port?: unknown } | null)?.port
    return isValidMcpPort(port) ? port : null
  } catch {
    return null
  }
}

export function mcpGatewayUrl(port: number): string {
  return `http://127.0.0.1:${port}${MCP_GATEWAY_PATH}`
}

export type McpPortState = { port: number; file: string; dir: string; exists: boolean }

export function readMcpPortState(fs: McpPortFs, env: McpPortEnv): McpPortState {
  const file = mcpPortConfigFile(env)
  const dir = mcpPortConfigDir(env)
  let text: string | null = null
  try {
    text = fs.existsSync(file) ? String(fs.readFileSync(file, 'utf8')) : null
  } catch {
    text = null
  }
  return { port: parseMcpPortConfig(text) ?? MCP_GATEWAY_DEFAULT_PORT, file, dir, exists: text !== null }
}

/** Remove `mcp.json`; the folder goes too when nothing else lives there (App data keeps it). */
export function deleteMcpPortConfig(fs: McpPortFs, env: McpPortEnv): { deleted: boolean; dirRemoved: boolean } {
  const file = mcpPortConfigFile(env)
  const dir = mcpPortConfigDir(env)
  let deleted = false
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    deleted = true
  }
  let dirRemoved = false
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir)
      dirRemoved = true
    }
  } catch {
    dirRemoved = false
  }
  return { deleted, dirRemoved }
}

/** Default port → no file at all; otherwise write via a temp file + rename. Caller checks the port is free first. */
export function writeMcpPortConfig(fs: McpPortFs, env: McpPortEnv, port: number): McpPortState {
  if (!isValidMcpPort(port)) throw new Error(`端口需为 ${MCP_PORT_MIN}–${MCP_PORT_MAX} 的整数`)
  if (port === MCP_GATEWAY_DEFAULT_PORT) {
    deleteMcpPortConfig(fs, env)
    return readMcpPortState(fs, env)
  }
  const file = mcpPortConfigFile(env)
  fs.mkdirSync(mcpPortConfigDir(env), { recursive: true })
  const tmp = `${file}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify({ port }, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
  return readMcpPortState(fs, env)
}

/** Env of the current Node / NW.js process. */
export function processMcpPortEnv(home: string): McpPortEnv {
  const env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}
  return {
    platform: typeof process !== 'undefined' ? process.platform : 'linux',
    home: home || env.HOME || env.USERPROFILE || '',
    appData: env.APPDATA || undefined,
    xdgConfigHome: env.XDG_CONFIG_HOME || undefined,
  }
}
