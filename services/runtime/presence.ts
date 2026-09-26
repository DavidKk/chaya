import os from 'node:os'

import { DEFAULT_LISTEN_PORT } from '@/constants/listen'

/** 超过该间隔未收到心跳 → 视为游戏未运行（须大于局内心跳间隔 10s） */
export const GAME_ONLINE_TTL_MS = 15_000

export type GamePresence = {
  online: boolean
  lastSeenAt: number | null
  sessionId: string | null
  contentRoot: string | null
  platform: string | null
  userAgent: string | null
  /** 控制台已请求关闭；心跳响应会带回 quit:true */
  quitRequested: boolean
}

type PresenceRecord = {
  lastSeenAt: number
  sessionId: string
  contentRoot: string | null
  platform: string | null
  userAgent: string | null
}

type PresenceStore = {
  current: PresenceRecord | null
  quitRequested: boolean
}

const STORE_KEY = '__chaya_game_presence_v1__'

function store(): PresenceStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: PresenceStore }
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { current: null, quitRequested: false }
  }
  return g[STORE_KEY]
}

export function touchGamePresence(input: { sessionId?: string; contentRoot?: string | null; platform?: string | null; userAgent?: string | null }): GamePresence {
  const s = store()
  // 已下发退出：不再因迟到的心跳把 UI 拉回「在线」
  if (s.quitRequested) {
    return getGamePresence()
  }
  const now = Date.now()
  const sessionId = String(input.sessionId || s.current?.sessionId || `s-${now.toString(36)}`)
  s.current = {
    lastSeenAt: now,
    sessionId,
    contentRoot: input.contentRoot ?? s.current?.contentRoot ?? null,
    platform: input.platform ?? s.current?.platform ?? null,
    userAgent: input.userAgent ?? s.current?.userAgent ?? null,
  }
  return getGamePresence()
}

export function getGamePresence(): GamePresence {
  const s = store()
  if (!s.current) {
    return {
      online: false,
      lastSeenAt: null,
      sessionId: null,
      contentRoot: null,
      platform: null,
      userAgent: null,
      quitRequested: s.quitRequested,
    }
  }
  const online = Date.now() - s.current.lastSeenAt <= GAME_ONLINE_TTL_MS
  if (!online && s.quitRequested) {
    s.quitRequested = false
  }
  return {
    online,
    lastSeenAt: s.current.lastSeenAt,
    sessionId: s.current.sessionId,
    contentRoot: s.current.contentRoot,
    platform: s.current.platform,
    userAgent: s.current.userAgent,
    quitRequested: s.quitRequested,
  }
}

/** 通知局内插件在下次心跳后退出，并立刻视为离线（按钮回到「开始」） */
export function requestGameQuit(): GamePresence {
  const s = store()
  s.quitRequested = true
  s.current = null
  return getGamePresence()
}

/** 心跳已下发 quit 后清掉在线痕迹，避免短暂再次 online */
export function clearGamePresenceKeepQuit(): void {
  const s = store()
  s.current = null
}

export function clearGameQuitRequest(): void {
  store().quitRequested = false
}

/** 本机可被局域网（含虚拟机）访问的 API 根列表（物理网卡优先） */
export function detectLanApiBases(port = DEFAULT_LISTEN_PORT): string[] {
  type Hit = { name: string; address: string }
  const hits: Hit[] = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === (4 as unknown as string)
      if (v4 && !a.internal) hits.push({ name, address: a.address })
    }
  }
  const score = (c: Hit) => {
    let s = 0
    if (/^en\d+$/i.test(c.name) || /^eth\d+$/i.test(c.name) || /^wlan/i.test(c.name) || /^wi-?fi/i.test(c.name)) s += 100
    if (/^192\.168\./.test(c.address)) s += 50
    else if (/^10\./.test(c.address)) s += 40
    else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(c.address)) s += 30
    if (/^(bridge|feth|veth|docker|vmnet|vbox|utun)/i.test(c.name)) s -= 80
    return s
  }
  hits.sort((a, b) => score(b) - score(a))
  return hits.map((h) => `http://${h.address}:${port}`)
}

/**
 * 写入游戏侧的优先 API 根。
 * 默认使用 loopback；`pnpm dev:lan` 显式开启局域网，供 VM / 他机访问；
 * `CHAYA_API_BASE` 显式覆盖；`CHAYA_API_LAN=0` 强制 loopback。
 */
export function preferredPluginApiBase(port = DEFAULT_LISTEN_PORT): string {
  const explicit = String(process.env.CHAYA_API_BASE || '')
    .trim()
    .replace(/\/$/, '')
  if (explicit) return explicit

  const forceLoopback = process.env.CHAYA_API_LAN !== '1' && process.env.CHAYA_API_LAN !== 'true'
  if (forceLoopback) {
    return `http://127.0.0.1:${port}`
  }

  return detectLanApiBases(port)[0] || `http://127.0.0.1:${port}`
}

export function toolkitListenPort(): number {
  const raw = Number(process.env.PORT || process.env.CHAYA_PORT || DEFAULT_LISTEN_PORT)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LISTEN_PORT
}
