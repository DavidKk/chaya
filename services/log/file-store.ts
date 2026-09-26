/**
 * 插件日志落盘 — 精简对齐 ticket-janitor file-store：
 * logs/plugins/YYYY-MM-DD.ndjson
 */
import fs from 'node:fs'
import path from 'node:path'

import { PLUGIN_LOGS_DIR, ROOT_PATH } from '@/constants/paths'
import { type LogEntry, normalizeLogLevel } from '@/lib/log'

const DEFAULT_RETENTION_DAYS = 14
const DEFAULT_HYDRATE_LIMIT = 2000

export function resolvePluginLogDir(): string {
  const fromEnv = process.env.CHAYA_LOG_DIR
  if (fromEnv && fromEnv.trim()) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(ROOT_PATH, fromEnv)
  }
  return PLUGIN_LOGS_DIR
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function dayFile(dir: string, day: string): string {
  return path.join(dir, `${day}.ndjson`)
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

export function appendLogToFile(entry: LogEntry, logDir = resolvePluginLogDir()): void {
  try {
    ensureDir(logDir)
    const file = dayFile(logDir, dayKey(entry.ts))
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    /* 落盘失败不影响 API */
  }
}

function parseLine(line: string, file: string, lineNo: number): LogEntry | null {
  const raw = line.trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<LogEntry> & { createdAt?: string }
    const ts = typeof o.ts === 'number' ? o.ts : o.createdAt ? Date.parse(o.createdAt) : Date.now()
    if (!o.source || o.message == null) return null
    return {
      id: String(o.id || `${path.basename(file)}:${lineNo}`),
      ts: Number.isFinite(ts) ? ts : Date.now(),
      level: normalizeLogLevel(o.level),
      source: String(o.source).slice(0, 64),
      message: String(o.message).slice(0, 8000),
      meta: o.meta,
    }
  } catch {
    return null
  }
}

/** 读最近若干天 NDJSON，按 ts 升序，截断到 limit */
export function loadLogsFromFiles(opts?: { logDir?: string; retentionDays?: number; limit?: number }): LogEntry[] {
  const logDir = opts?.logDir ?? resolvePluginLogDir()
  const retentionDays = opts?.retentionDays ?? DEFAULT_RETENTION_DAYS
  const limit = opts?.limit ?? DEFAULT_HYDRATE_LIMIT

  if (!fs.existsSync(logDir)) return []

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const files = fs
    .readdirSync(logDir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(n))
    .sort()

  const out: LogEntry[] = []
  for (const name of files) {
    const day = name.slice(0, 10)
    const dayTs = Date.parse(`${day}T00:00:00.000Z`)
    if (Number.isFinite(dayTs) && dayTs < cutoff - 24 * 60 * 60 * 1000) {
      continue
    }
    const full = path.join(logDir, name)
    let text = ''
    try {
      text = fs.readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const entry = parseLine(lines[i], full, i + 1)
      if (!entry) continue
      if (entry.ts < cutoff) continue
      out.push(entry)
    }
  }

  out.sort((a, b) => a.ts - b.ts)
  return out.length > limit ? out.slice(-limit) : out
}

/** 删除日志目录内全部 .ndjson（清空 UI 时） */
export function clearLogFiles(logDir = resolvePluginLogDir()): void {
  if (!fs.existsSync(logDir)) return
  for (const name of fs.readdirSync(logDir)) {
    if (!name.endsWith('.ndjson')) continue
    try {
      fs.unlinkSync(path.join(logDir, name))
    } catch {
      /* */
    }
  }
}

export function pluginLogFileStats(logDir = resolvePluginLogDir()) {
  if (!fs.existsSync(logDir)) {
    return { dir: logDir, files: 0, sizeBytes: 0 }
  }
  let files = 0
  let sizeBytes = 0
  for (const name of fs.readdirSync(logDir)) {
    if (!name.endsWith('.ndjson')) continue
    files += 1
    try {
      sizeBytes += fs.statSync(path.join(logDir, name)).size
    } catch {
      /* */
    }
  }
  return { dir: logDir, files, sizeBytes }
}
