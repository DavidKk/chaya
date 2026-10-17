import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import { PROVIDER_META } from '@/lib/game-agent/providers'

const execFileAsync = promisify(execFile)

/** Proxy / network vars a CLI should carry when Chaya applies a profile proxy. */
export const LIVE_PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy', 'no_proxy'] as const

const TRACKED_ENV_KEYS = [
  ...LIVE_PROXY_ENV_KEYS,
  'HOME',
  'USERPROFILE',
  'PATH',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'NO_OPEN_BROWSER',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CURSOR_API_KEY',
] as const

const SECRET_ENV = /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)/i
const PROXY_SLOT_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY'] as const

/** Binary basenames Chaya (or siblings) use for agent CLIs / SDKs. */
const CLI_BASENAMES = new Set(['agy', 'antigravity', 'gemini', 'agent', 'cursor-agent', 'codex', 'claude', 'claude-agent-acp', 'claude-code'])

export type LiveAgentProcessKind = 'stdio' | 'pty' | 'orphan'
export type LiveAgentProcessSource = 'chaya' | 'system'

export type LiveAgentProxyReport = {
  vars: Record<string, string>
  slotsFilled: string[]
  slotsMissing: string[]
  /** True when HTTP / HTTPS / ALL / FTP proxy vars are all non-empty. */
  complete: boolean
}

export type LiveAgentProcessStats = {
  cpuPercent: number | null
  memoryBytes: number | null
  elapsed: string | null
}

export type LiveAgentProcess = {
  id: string
  pid: number
  ppid: number | null
  kind: LiveAgentProcessKind
  source: LiveAgentProcessSource
  label: string
  file: string
  args: string[]
  /** One-line command for search / legacy. */
  command: string
  /** Multi-line: binary then indented args (editor-friendly). */
  commandText: string
  /** Multi-line KEY=value for display / copy. */
  envText: string
  cwd: string | null
  startedAt: number | null
  env: Record<string, string>
  envSource: 'spawn' | 'unavailable'
  proxy: LiveAgentProxyReport
  stats: LiveAgentProcessStats
}

type Tracked = {
  id: string
  kind: 'stdio' | 'pty'
  pid: number | null
  file: string
  args: string[]
  cwd: string | null
  startedAt: number
  env: Record<string, string>
  label?: string
  kill?: () => void
}

const tracked = new Map<string, Tracked>()
let nextId = 1

function basenameOf(file: string) {
  return path
    .basename(file)
    .replace(/\.(cmd|bat|exe)$/i, '')
    .toLowerCase()
}

export function formatCommandText(file: string, args: string[]): string {
  if (!args.length) return file
  return [file, ...args.map((arg) => `  ${arg}`)].join('\n')
}

export function formatEnvText(env: Record<string, string>): string {
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

/** Resolve a player-facing name from binary / args (Codex、Gemini CLI、Cursor…)。 */
export function inferProcessLabel(file: string, args: string[], command = ''): string {
  const base = basenameOf(file)
  const haystack = `${file} ${args.join(' ')} ${command}`.toLowerCase()

  for (const meta of Object.values(PROVIDER_META)) {
    if (!meta.cli) continue
    const cli = meta.cli.toLowerCase()
    if (base === cli || haystack.includes(`/${cli}`) || haystack.includes(`\\${cli}`) || new RegExp(`(?:^|[\\s"'])${cli}(?:\\s|$)`).test(haystack)) {
      return meta.label
    }
  }

  if (base === 'agy' || base === 'antigravity' || /\bantigravity\b/.test(haystack)) return PROVIDER_META.gemini.label
  if (base === 'gemini' || /@google\/gemini|gemini-cli/.test(haystack)) return PROVIDER_META.gemini.label
  if (base === 'codex' || /@openai\/codex|\bcodex\b/.test(haystack)) return PROVIDER_META.codex.label
  if (base === 'claude-agent-acp' || /claude-agent-acp/.test(haystack)) return PROVIDER_META.claude.label
  if (base === 'claude-code' || /@anthropic-ai\/claude-code|\bclaude\s+code\b/.test(haystack)) return PROVIDER_META.cc.label
  if (base === 'claude' && !/claude-agent-acp/.test(haystack)) return PROVIDER_META.cc.label
  if (base === 'agent' || base === 'cursor-agent' || /cursor-agent|\/\.local\/bin\/agent\b/.test(haystack)) return PROVIDER_META.cursor.label
  return base || path.basename(file) || 'Agent CLI'
}

function redactEnvValue(key: string, value: string) {
  if (LIVE_PROXY_ENV_KEYS.includes(key as (typeof LIVE_PROXY_ENV_KEYS)[number])) return value
  if (SECRET_ENV.test(key) && value) return '***'
  if (key === 'PATH' && value.length > 240) return `${value.slice(0, 240)}…`
  return value
}

export function pickTrackedEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of TRACKED_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value) out[key] = redactEnvValue(key, value)
  }
  return out
}

export function proxyReportFromEnv(env: Record<string, string>): LiveAgentProxyReport {
  const vars: Record<string, string> = {}
  for (const key of LIVE_PROXY_ENV_KEYS) {
    if (env[key]) vars[key] = env[key]
  }
  const slotsFilled: string[] = []
  const slotsMissing: string[] = []
  for (const key of PROXY_SLOT_KEYS) {
    const value = env[key] || env[key.toLowerCase()] || ''
    if (value) slotsFilled.push(key)
    else slotsMissing.push(key)
  }
  return { vars, slotsFilled, slotsMissing, complete: slotsMissing.length === 0 && slotsFilled.length === PROXY_SLOT_KEYS.length }
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function killPidTree(pid: number, signal: NodeJS.Signals = 'SIGTERM') {
  if (!pidAlive(pid)) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      /* already gone */
    }
  }
}

function toView(entry: Tracked, stats: LiveAgentProcessStats): LiveAgentProcess | null {
  if (entry.pid == null || !pidAlive(entry.pid)) return null
  const command = [entry.file, ...entry.args].join(' ')
  const envText = formatEnvText(entry.env)
  return {
    id: entry.id,
    pid: entry.pid,
    ppid: null,
    kind: entry.kind,
    source: 'chaya',
    label: entry.label || inferProcessLabel(entry.file, entry.args, command),
    file: entry.file,
    args: entry.args,
    command,
    commandText: formatCommandText(entry.file, entry.args),
    envText,
    cwd: entry.cwd,
    startedAt: entry.startedAt,
    env: entry.env,
    envSource: 'spawn',
    proxy: proxyReportFromEnv(entry.env),
    stats,
  }
}

/** Register a Chaya-spawned CLI/PTY until the caller disposes (usually on child exit). */
export function trackLiveAgentProcess(input: {
  kind: 'stdio' | 'pty'
  pid?: number | null
  file: string
  args: string[]
  cwd?: string
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
  label?: string
  kill?: () => void
}): { id: string; setPid: (pid: number | null | undefined) => void; dispose: () => void } {
  const id = `chaya-${nextId++}`
  const entry: Tracked = {
    id,
    kind: input.kind,
    pid: input.pid ?? null,
    file: input.file,
    args: input.args,
    cwd: input.cwd || null,
    startedAt: Date.now(),
    env: pickTrackedEnv(input.env),
    label: input.label,
    kill: input.kill,
  }
  tracked.set(id, entry)
  return {
    id,
    setPid: (pid) => {
      const current = tracked.get(id)
      if (current) current.pid = pid ?? null
    },
    dispose: () => {
      tracked.delete(id)
    },
  }
}

type PsRow = { pid: number; ppid: number; cpuPercent: number | null; memoryBytes: number | null; elapsed: string | null; command: string }

async function readProcessTable(): Promise<PsRow[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,ppid=,pcpu=,rss=,etime=,command='], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5_000,
    })
    const rows: PsRow[] = []
    for (const line of stdout.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/)
      if (!match) continue
      const pid = Number(match[1])
      const ppid = Number(match[2])
      const cpu = Number(match[3])
      const rssKb = Number(match[4])
      if (!Number.isFinite(pid)) continue
      rows.push({
        pid,
        ppid: Number.isFinite(ppid) ? ppid : 0,
        cpuPercent: Number.isFinite(cpu) ? cpu : null,
        memoryBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null,
        elapsed: match[5] || null,
        command: match[6],
      })
    }
    return rows
  } catch {
    return []
  }
}

function looksLikeAgentCli(command: string): boolean {
  const tokens = command.trim().split(/\s+/)
  const file = tokens[0] || ''
  const base = basenameOf(file)
  if (!CLI_BASENAMES.has(base)) {
    if (!/(?:^|[\s/\\])(?:agy|antigravity|gemini|cursor-agent|codex|claude-agent-acp|claude-code)(?:\s|$)/i.test(command)) return false
  }
  if (/\/System\/|Cursor Helper|Code Helper|trustd|GamePolicy|iconservices|knowledge-agent|ssh-agent|cfprefsd/i.test(command)) return false
  if (base === 'agent' && !/cursor|\/\.local\/bin\/agent\b/i.test(command)) return false
  return true
}

/** Chaya-spawned children plus any matching agent CLI still alive on the machine. */
export async function listLiveAgentProcesses(): Promise<LiveAgentProcess[]> {
  const table = await readProcessTable()
  const byPid = new Map(table.map((row) => [row.pid, row]))

  const owned: LiveAgentProcess[] = []
  for (const entry of tracked.values()) {
    if (entry.pid == null || !byPid.has(entry.pid)) {
      if (entry.pid != null && !pidAlive(entry.pid)) tracked.delete(entry.id)
      continue
    }
    const row = byPid.get(entry.pid)!
    const view = toView(entry, { cpuPercent: row.cpuPercent, memoryBytes: row.memoryBytes, elapsed: row.elapsed })
    if (view) owned.push(view)
  }

  const exclude = new Set(owned.map((item) => item.pid))
  const orphans: LiveAgentProcess[] = []
  for (const row of table) {
    if (exclude.has(row.pid) || !looksLikeAgentCli(row.command)) continue
    const tokens = row.command.split(/\s+/)
    const file = tokens[0] || row.command
    const args = tokens.slice(1)
    orphans.push({
      id: `system-${row.pid}`,
      pid: row.pid,
      ppid: row.ppid,
      kind: 'orphan',
      source: 'system',
      label: inferProcessLabel(file, args, row.command),
      file,
      args,
      command: row.command,
      commandText: formatCommandText(file, args),
      envText: '',
      cwd: null,
      startedAt: null,
      env: {},
      envSource: 'unavailable',
      proxy: proxyReportFromEnv({}),
      stats: { cpuPercent: row.cpuPercent, memoryBytes: row.memoryBytes, elapsed: row.elapsed },
    })
  }

  return [...owned, ...orphans].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0) || b.pid - a.pid)
}

/** Kill a listed process by id (`chaya-*` or `system-<pid>`). */
export async function killLiveAgentProcess(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const entry = tracked.get(id)
  if (entry) {
    try {
      if (entry.kill) entry.kill()
      else if (entry.pid != null) killPidTree(entry.pid)
      tracked.delete(id)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const match = /^system-(\d+)$/.exec(id)
  if (!match) return { ok: false, error: '未知进程' }
  const pid = Number(match[1])
  const row = (await readProcessTable()).find((item) => item.pid === pid)
  if (!row || pid === process.pid || !looksLikeAgentCli(row.command)) return { ok: false, error: '目标不是可终止的 Agent 进程' }
  if (!pidAlive(pid)) return { ok: false, error: '进程已退出' }
  killPidTree(pid)
  return { ok: true }
}

/** Test helper: clear the in-memory registry. */
export function resetLiveAgentProcessesForTests() {
  tracked.clear()
  nextId = 1
}

export function listTrackedLiveAgentProcessesForTests(): Tracked[] {
  return [...tracked.values()]
}
