import { randomUUID } from 'node:crypto'

/** 本机启动鉴权：写入 ChayaEnv，心跳携带后才允许改库 / 认本地会话 */

export type LaunchSession = {
  token: string
  gameRoot: string
  libraryId: string
  issuedAt: number
}

type TokenStore = {
  byToken: Map<string, LaunchSession>
  /** 最近一次本机启动（便于调试） */
  latest: LaunchSession | null
}

const STORE_KEY = '__chaya_launch_tokens_v1__'

function store(): TokenStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: TokenStore }
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { byToken: new Map(), latest: null }
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
  }
  const s = store()
  s.byToken.set(session.token, session)
  s.latest = session
  return session
}

export function peekLaunchToken(token: string | null | undefined): LaunchSession | null {
  const key = String(token || '').trim()
  if (!key) return null
  return store().byToken.get(key) || null
}

export function clearLaunchToken(token?: string | null): void {
  const s = store()
  if (token) {
    s.byToken.delete(String(token).trim())
    if (s.latest?.token === token) s.latest = null
    return
  }
  s.byToken.clear()
  s.latest = null
}
