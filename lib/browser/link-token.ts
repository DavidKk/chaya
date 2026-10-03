/**
 * 浏览器模式信令令牌：按游戏库条目 id 存在 localStorage，写入游戏 Env 时生成，页面连接时读取。
 * 令牌只存在于本机浏览器与本机游戏目录，服务器只保存其哈希。
 */

const STORAGE_KEY = 'chaya.browserLinkTokens'

function readAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeAll(tokens: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
  } catch {
    /* 隐私模式 / 配额满：本次写入的 Env 仍有效，下次连接会重新生成 */
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function readCloudLinkToken(gameId: string): string | null {
  const id = gameId.trim()
  return (id && readAll()[id]) || null
}

/** 取已有令牌，没有则生成并保存 */
export function ensureCloudLinkToken(gameId: string): string {
  const id = gameId.trim()
  const tokens = readAll()
  if (tokens[id]) return tokens[id]
  const token = randomToken()
  writeAll({ ...tokens, [id]: token })
  return token
}

export function forgetCloudLinkToken(gameId: string): void {
  const tokens = readAll()
  if (!(gameId in tokens)) return
  delete tokens[gameId]
  writeAll(tokens)
}
