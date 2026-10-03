/**
 * 浏览器模式页面内日志：只收当前连接游戏经 DataChannel 推来的 `log.batch`，不经服务器。
 * 游戏重连会补发积压，按「游戏内 id + 时间」去重。
 */

import type { GameLinkLogEntry } from '@/lib/runtime/game-link-protocol'

import { type LogEntry, normalizeLogLevel } from './types'

const MAX = 1000

let entries: readonly LogEntry[] = []
/** 用户清空的时间点：重连补发的积压不再出现 */
let clearedAt = 0
const seen = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* */
    }
  }
}

export function appendLinkLogs(batch: readonly GameLinkLogEntry[]): void {
  const fresh: LogEntry[] = []
  for (const e of batch) {
    if (!e || typeof e.message !== 'string' || Number(e.ts) <= clearedAt) continue
    const id = `${e.ts}-${e.id}`
    if (seen.has(id)) continue
    seen.add(id)
    fresh.push({
      id,
      ts: Number(e.ts) || Date.now(),
      level: normalizeLogLevel(e.level),
      source: String(e.source || 'plugin').slice(0, 64),
      message: e.message.slice(0, 8000),
      meta: e.meta,
    })
  }
  if (!fresh.length) return
  const next = [...entries, ...fresh].sort((a, b) => a.ts - b.ts)
  if (next.length > MAX) {
    for (const dropped of next.splice(0, next.length - MAX)) seen.delete(dropped.id)
  }
  entries = next
  emit()
}

/** 返回稳定引用（无变化时同一数组），可直接用于 useSyncExternalStore */
export function readLinkLogs(): readonly LogEntry[] {
  return entries
}

export function clearLinkLogs(): void {
  clearedAt = Date.now()
  entries = []
  seen.clear()
  emit()
}

/** 切换游戏（房间）时调用：丢弃上一个游戏的日志，新游戏的积压照常补发 */
export function resetLinkLogs(): void {
  clearedAt = 0
  entries = []
  seen.clear()
  emit()
}

export function subscribeLinkLogs(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
