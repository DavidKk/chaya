import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MCP_ENDPOINT_PATH, MCP_SERVER_NAME } from '@/lib/integration/mcp-catalog'
import { claudeCodeInstallArgs, codexInstallArgs } from '@/lib/integration/mcp-install'
import { toolkitListenPort } from '@/services/runtime/presence'

/** CLI agents the local server installs into / uninstalls from with their own `mcp add` / `mcp remove` */
export type McpCliClientId = 'claude' | 'codex'

export const MCP_CLI_CLIENTS: readonly McpCliClientId[] = ['claude', 'codex']

export type McpClientStatus = {
  /** A `chaya` entry exists in the client's user config */
  installed: boolean
  /** Binary found, so the server can run it for the user */
  cli: boolean
}

export type McpClientsStatus = Record<McpCliClientId, McpClientStatus>

/** This local server's own MCP endpoint */
export function localMcpEndpoint(): string {
  return `http://127.0.0.1:${toolkitListenPort()}${MCP_ENDPOINT_PATH}`
}

const CLI_TIMEOUT_MS = 30_000

function home(): string {
  return os.homedir()
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** `~/.claude.json` top-level `mcpServers` = `--scope user` (same path on every OS) */
function claudeInstalled(): boolean {
  const text = readText(path.join(home(), '.claude.json'))
  if (text === null) return false
  try {
    const servers = (JSON.parse(text) as { mcpServers?: Record<string, unknown> }).mcpServers
    return Boolean(servers && MCP_SERVER_NAME in servers)
  } catch {
    return false
  }
}

/** `[mcp_servers.chaya]` table present in Codex `config.toml` */
export function codexHasServer(toml: string, name = MCP_SERVER_NAME): boolean {
  const header = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:"${name}"|${name})\\s*\\]\\s*(#.*)?$`, 'm')
  return header.test(toml)
}

/** `$CODEX_HOME/config.toml`, default `~/.codex` on every OS */
function codexInstalled(): boolean {
  const toml = readText(path.join(process.env.CODEX_HOME || path.join(home(), '.codex'), 'config.toml'))
  return toml !== null && codexHasServer(toml)
}

function installed(client: McpCliClientId): boolean {
  return client === 'claude' ? claudeInstalled() : codexInstalled()
}

/** Node version managers keep one bin dir per version */
function versionBins(root: string, suffix: string[]): string[] {
  try {
    return fs.readdirSync(root).map((version) => path.join(root, version, ...suffix))
  } catch {
    return []
  }
}

/** GUI-launched App inherits a minimal PATH (macOS / Linux); add the usual per-user install dirs */
function searchDirs(): string[] {
  const fromEnv = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const h = home()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(h, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local')
    return [
      ...new Set([
        ...fromEnv,
        // Claude Code native installer
        path.join(h, '.local', 'bin'),
        // npm i -g (claude / codex)
        path.join(appData, 'npm'),
        ...(process.env.NVM_SYMLINK ? [process.env.NVM_SYMLINK] : []),
        path.join(localAppData, 'pnpm'),
        path.join(h, 'scoop', 'shims'),
      ]),
    ]
  }
  const fnmRoot = process.platform === 'darwin' ? path.join(h, 'Library', 'Application Support', 'fnm', 'node-versions') : path.join(h, '.local', 'share', 'fnm', 'node-versions')
  return [
    ...new Set([
      ...fromEnv,
      path.join(h, '.local', 'bin'),
      path.join(h, '.claude', 'local'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/snap/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      path.join(h, '.npm-global', 'bin'),
      path.join(h, '.bun', 'bin'),
      path.join(h, '.volta', 'bin'),
      path.join(h, '.local', 'share', 'pnpm'),
      path.join(h, 'Library', 'pnpm'),
      ...versionBins(path.join(process.env.NVM_DIR || path.join(h, '.nvm'), 'versions', 'node'), ['bin']),
      ...versionBins(fnmRoot, ['installation', 'bin']),
    ]),
  ]
}

export function findCli(bin: string, dirs = searchDirs()): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, bin + ext)
      try {
        if (fs.statSync(file).isFile()) return file
      } catch {
        /* not here */
      }
    }
  }
  return null
}

function runCli(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: home(),
        timeout: CLI_TIMEOUT_MS,
        windowsHide: true,
        // `.cmd` shims need a shell on Windows; args are our fixed name + loopback URL
        shell: /\.(cmd|bat)$/i.test(file),
        // npm-installed CLIs are `#!/usr/bin/env node` scripts: node must be on PATH too
        env: { ...process.env, PATH: [path.dirname(file), ...searchDirs()].join(path.delimiter) },
      },
      (error, _stdout, stderr) => {
        if (error)
          reject(
            new Error(
              String(stderr || error.message)
                .trim()
                .slice(0, 500)
            )
          )
        else resolve()
      }
    )
  })
}

export function getMcpClientsStatus(): McpClientsStatus {
  const dirs = searchDirs()
  return {
    claude: { installed: installed('claude'), cli: findCli('claude', dirs) !== null },
    codex: { installed: installed('codex'), cli: findCli('codex', dirs) !== null },
  }
}

function requireCli(client: McpCliClientId): string {
  const file = findCli(client)
  if (!file) throw new Error(`${client} CLI not found`)
  return file
}

function removeArgs(client: McpCliClientId): string[] {
  return client === 'claude' ? ['mcp', 'remove', MCP_SERVER_NAME, '--scope', 'user'] : ['mcp', 'remove', MCP_SERVER_NAME]
}

/** Replaces any existing `chaya` entry so it points at `endpoint` */
export async function installMcpClient(client: McpCliClientId, endpoint: string): Promise<void> {
  const file = requireCli(client)
  const input = { name: MCP_SERVER_NAME, url: endpoint }
  if (installed(client)) await runCli(file, removeArgs(client)).catch(() => undefined)
  await runCli(file, client === 'claude' ? claudeCodeInstallArgs(input) : codexInstallArgs(input))
}

export async function uninstallMcpClient(client: McpCliClientId): Promise<void> {
  await runCli(requireCli(client), removeArgs(client))
}
