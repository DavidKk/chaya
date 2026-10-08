import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'

/** 本机启动鉴权：写入 ChayaEnv，心跳携带后才允许改库 / 认本地会话 */

export type LaunchSession = {
  token: string
  gameRoot: string
  libraryId: string
  issuedAt: number
  lastSeenAt: number
  persistence: 'durable' | 'memory'
}

type TokenStore = {
  byToken: Map<string, LaunchSession>
  /** 最近一次本机启动（便于调试） */
  latest: LaunchSession | null
}

const STORE_KEY = '__chaya_launch_tokens_v1__'
const TOKEN_MAX_IDLE_MS = 24 * 60 * 60_000
const TOUCH_WRITE_MS = 60_000
const TOKEN_FILE = path.join(DATA_DIR, 'runtime', 'launch-tokens.json')

function validSession(value: unknown): value is LaunchSession {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LaunchSession>
  return (
    !!item.token &&
    typeof item.gameRoot === 'string' &&
    typeof item.libraryId === 'string' &&
    Number.isFinite(item.issuedAt) &&
    Number.isFinite(item.lastSeenAt) &&
    (item.persistence === 'durable' || item.persistence === 'memory')
  )
}

function loadStore(): TokenStore {
  if (process.env.NODE_ENV === 'test') return { byToken: new Map(), latest: null }
  try {
    const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) as { version?: unknown; sessions?: unknown }
    if (raw.version !== 1 || !Array.isArray(raw.sessions)) return { byToken: new Map(), latest: null }
    const now = Date.now()
    const sessions = raw.sessions.filter(validSession).filter((session) => now - session.lastSeenAt <= TOKEN_MAX_IDLE_MS)
    return { byToken: new Map(sessions.map((session) => [session.token, session])), latest: sessions.at(-1) ?? null }
  } catch {
    return { byToken: new Map(), latest: null }
  }
}

function persistStore(value: TokenStore): boolean {
  if (process.env.NODE_ENV === 'test') return true
  const temp = `${TOKEN_FILE}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify({ version: 1, sessions: [...value.byToken.values()] }), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temp, TOKEN_FILE)
    try {
      fs.chmodSync(TOKEN_FILE, 0o600)
    } catch {
      /* Windows and read-only filesystems may not expose POSIX modes. */
    }
    return true
  } catch {
    return false
  } finally {
    try {
      fs.unlinkSync(temp)
    } catch {
      /* Renamed or never created. */
    }
  }
}

function store(): TokenStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: TokenStore }
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = loadStore()
  }
  return g[STORE_KEY]
}

/** 签发启动 token（安装 Loader / 开始游戏时） */
export function issueLaunchToken(input: { gameRoot: string; libraryId: string }): LaunchSession {
  const gameRoot = String(input.gameRoot || '').trim()
  const libraryId = String(input.libraryId || '').trim()
  const session: LaunchSession = {
    token: randomUUID(),
    gameRoot,
    libraryId,
    issuedAt: Date.now(),
    lastSeenAt: Date.now(),
    persistence: 'durable',
  }
  const s = store()
  s.byToken.set(session.token, session)
  s.latest = session
  if (!persistStore(s)) session.persistence = 'memory'
  return session
}

export function peekLaunchToken(token: string | null | undefined): LaunchSession | null {
  const key = String(token || '').trim()
  if (!key) return null
  const s = store()
  const session = s.byToken.get(key) || null
  if (!session) return null
  const now = Date.now()
  if (now - session.lastSeenAt > TOKEN_MAX_IDLE_MS) {
    s.byToken.delete(key)
    if (s.latest?.token === key) s.latest = null
    persistStore(s)
    return null
  }
  if (now - session.lastSeenAt >= TOUCH_WRITE_MS) {
    session.lastSeenAt = now
    persistStore(s)
  }
  return session
}

export function clearLaunchToken(token?: string | null): void {
  const s = store()
  if (token) {
    s.byToken.delete(String(token).trim())
    if (s.latest?.token === token) s.latest = null
    persistStore(s)
    return
  }
  s.byToken.clear()
  s.latest = null
  persistStore(s)
}
