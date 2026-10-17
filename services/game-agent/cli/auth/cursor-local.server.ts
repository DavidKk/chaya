import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import type { AgentAccountSummary, AgentAuthStatus } from '@/lib/game-agent/providers'
import { agentProxyEnv, type AgentProxyProfile } from '@/services/game-agent/proxy/agent-proxy'

import { accountSummary } from '../account'
import { AgentCliError } from '../errors'
import { holdFileLock } from '../file-lock.server'
import { cliEnv, killCliTree, runCliOnce, spawnCli, StderrBuffer } from '../process.server'
import { requireCli, resolveCli } from '../resolve-cli.server'
import type { AuthAttemptHandle } from './remote-adapter'

export type CursorAuthStatus = Extract<AgentAuthStatus, { mode: 'local_login' }>

const STATUS_TIMEOUT_MS = 8_000
const STATUS_CACHE_MS = 30_000
const CHALLENGE_TIMEOUT_MS = 30_000
const LOGIN_LINK_TTL_MS = 10 * 60_000
const LOGOUT_TIMEOUT_MS = 15_000

export const CURSOR_LOGIN_LOCK = path.join(DATA_DIR, 'game-agent', 'cursor-login.lock')

/** Keyed by proxy: a status read through a dead proxy must not stand in for a direct one. */
const cached = new Map<string, { at: number; value: Promise<CursorAuthStatus> }>()

/** Cursor stays on the machine's own login: never an API key, never a Chaya-owned credential directory. */
async function cursorEnv(file: string, proxy: AgentProxyProfile | string | undefined, extra: Record<string, string> = {}) {
  return cliEnv(file, { ...(await agentProxyEnv(proxy)), CURSOR_API_KEY: '', ...extra })
}

function proxyCacheKey(proxy: AgentProxyProfile | string | undefined) {
  if (typeof proxy === 'string' || proxy == null) return proxy || ''
  return `${proxy.proxy || ''}\n${JSON.stringify(proxy.proxyHeaders || {})}`
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function parseCursorStatus(stdout: string): { signedIn: boolean; email?: unknown } | null {
  const value = parseJson(stdout)
  if (!value || typeof value.isAuthenticated !== 'boolean') return null
  const user = value.userInfo as { email?: unknown } | undefined
  return { signedIn: value.isAuthenticated, email: user?.email }
}

export function parseCursorAbout(stdout: string): { email?: unknown; plan?: unknown } {
  const value = parseJson(stdout)
  return value ? { email: value.userEmail, plan: value.subscriptionTier } : {}
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

export function extractCursorLoginUrl(text: string): string | null {
  return text.replace(ANSI, '').match(/https:\/\/(?:[\w-]+\.)*cursor\.(?:com|sh)\/[^\s"'<>)\]]+/)?.[0] || null
}

async function probeStatus(proxy: AgentProxyProfile | string | undefined): Promise<CursorAuthStatus> {
  let file: string
  try {
    file = await requireCli('cursor')
  } catch {
    return { mode: 'local_login', state: 'unknown', reason: 'cli_missing' }
  }
  const env = await cursorEnv(file, proxy)
  const [status, about] = await Promise.all([
    runCliOnce(file, ['status', '--format', 'json'], { env, timeoutMs: STATUS_TIMEOUT_MS }).catch(() => null),
    runCliOnce(file, ['about', '--format', 'json'], { env, timeoutMs: STATUS_TIMEOUT_MS }).catch(() => null),
  ])
  const parsed = status && !status.timedOut ? parseCursorStatus(status.stdout) : null
  if (!parsed) return { mode: 'local_login', state: 'unknown', reason: status?.timedOut ? 'timeout' : 'unreadable' }
  if (!parsed.signedIn) return { mode: 'local_login', state: 'signed_out' }
  const details = about && !about.timedOut ? parseCursorAbout(about.stdout) : {}
  return { mode: 'local_login', state: 'signed_in', account: accountSummary(details.email || parsed.email, details.plan) }
}

export function getCursorAuthStatus(options: { force?: boolean; proxy?: string; proxyHeaders?: Record<string, string> } = {}): Promise<CursorAuthStatus> {
  const proxy: AgentProxyProfile | string | undefined = options.proxyHeaders ? { proxy: options.proxy, proxyHeaders: options.proxyHeaders } : options.proxy
  const key = proxyCacheKey(proxy)
  const hit = cached.get(key)
  if (hit && !options.force && Date.now() - hit.at < STATUS_CACHE_MS) return hit.value
  const value = probeStatus(proxy)
  cached.set(key, { at: Date.now(), value })
  value.catch(() => cached.delete(key))
  return value
}

export function clearCursorAuthCache() {
  cached.clear()
}

/** Same as `agent logout` in a terminal: signs out this machine's Cursor CLI for every profile. */
export async function logoutCursor(proxy?: AgentProxyProfile | string): Promise<void> {
  const file = await requireCli('cursor')
  const result = await runCliOnce(file, ['logout'], { env: await cursorEnv(file, proxy), timeoutMs: LOGOUT_TIMEOUT_MS })
  clearCursorAuthCache()
  if (result.timedOut) throw new AgentCliError('AGENT_CLI_TIMEOUT', 'Cursor 退出登录超时')
  if (result.code !== 0) throw new AgentCliError('AGENT_AUTH_FAILED', 'Cursor 退出登录失败')
}

/**
 * Runs `agent login` with browser opening disabled and hands its link to the player. One login per machine;
 * the CLI keeps the previous login until the new one succeeds, so cancelling leaves it untouched.
 */
export async function startCursorLogin(input: { signal: AbortSignal; lockFile?: string; proxy?: string; proxyHeaders?: Record<string, string> }): Promise<AuthAttemptHandle> {
  const releaseLock = holdFileLock(input.lockFile || CURSOR_LOGIN_LOCK)
  if (!releaseLock) throw new AgentCliError('AGENT_AUTH_IN_PROGRESS', '另一个 Chaya 正在进行 Cursor 登录')
  let file: string
  let env: NodeJS.ProcessEnv
  try {
    file = await requireCli('cursor')
    await resolveCli('cursor')
    env = await cursorEnv(file, { proxy: input.proxy, proxyHeaders: input.proxyHeaders }, { NO_OPEN_BROWSER: '1' })
  } catch (error) {
    releaseLock()
    throw error
  }
  const child = spawnCli(file, ['login'], { env })
  const stderr = new StderrBuffer()
  let output = ''
  let finished = false

  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
    child.once('error', () => resolve(null))
  })
  void exited.finally(() => {
    finished = true
    releaseLock()
  })
  const stop = () => killCliTree(child)
  input.signal.addEventListener('abort', stop, { once: true })

  const link = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AgentCliError('AGENT_AUTH_FAILED', 'Cursor CLI 未在 30 秒内给出登录链接')), CHALLENGE_TIMEOUT_MS)
    const scan = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_192)
      const url = extractCursorLoginUrl(output)
      if (url) {
        clearTimeout(timer)
        resolve(url)
      }
    }
    child.stdout?.on('data', scan)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
      scan(chunk)
    })
    void exited.then(() => {
      clearTimeout(timer)
      reject(new AgentCliError('AGENT_AUTH_FAILED', 'Cursor CLI 未给出登录链接就退出了'))
    })
  })

  let url: string
  try {
    url = await link
  } catch (error) {
    stop()
    input.signal.removeEventListener('abort', stop)
    throw error
  }

  const completed = exited.then(async (code): Promise<{ account: AgentAccountSummary }> => {
    input.signal.removeEventListener('abort', stop)
    if (code !== 0) throw new AgentCliError('AGENT_AUTH_FAILED', 'Cursor 登录未完成')
    clearCursorAuthCache()
    const status = await getCursorAuthStatus({ force: true, proxy: input.proxy, proxyHeaders: input.proxyHeaders })
    if (status.state !== 'signed_in') throw new AgentCliError('AGENT_AUTH_FAILED', 'Cursor 登录后仍未检测到登录状态')
    return { account: status.account || {} }
  })

  return {
    challenge: { kind: 'browser_link', url, expiresAt: Date.now() + LOGIN_LINK_TTL_MS },
    completed,
    async cancel() {
      if (!finished) stop()
    },
  }
}
