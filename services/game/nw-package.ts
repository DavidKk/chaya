import fs from 'node:fs'
import path from 'node:path'

/** NW.js package.json → window 常用字段 */
export type NwWindowConfig = {
  title: string
  position: string
  show: boolean
  toolbar: boolean
  icon: string
  width: number
  height: number
  min_width: number | null
  min_height: number | null
  max_width: number | null
  max_height: number | null
  resizable: boolean
  fullscreen: boolean
  frame: boolean
  'always-on-top': boolean
  devtools: boolean
}

export type NwPackageInfo = {
  file: string
  name: string
  main: string
  window: NwWindowConfig
}

const DEFAULT_WINDOW: NwWindowConfig = {
  title: '',
  position: 'center',
  show: true,
  toolbar: false,
  icon: '',
  width: 816,
  height: 624,
  min_width: 408,
  min_height: 312,
  max_width: null,
  max_height: null,
  resizable: true,
  fullscreen: false,
  frame: true,
  'always-on-top': false,
  devtools: false,
}

function asNum(v: unknown, fallback: number | null): number | null {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  return fallback
}

export function normalizeWindow(raw: unknown): NwWindowConfig {
  const w = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    title: String(w.title ?? DEFAULT_WINDOW.title),
    position: String(w.position ?? DEFAULT_WINDOW.position),
    show: asBool(w.show, DEFAULT_WINDOW.show),
    toolbar: asBool(w.toolbar, DEFAULT_WINDOW.toolbar),
    icon: String(w.icon ?? DEFAULT_WINDOW.icon),
    width: asNum(w.width, DEFAULT_WINDOW.width) ?? DEFAULT_WINDOW.width,
    height: asNum(w.height, DEFAULT_WINDOW.height) ?? DEFAULT_WINDOW.height,
    min_width: asNum(w.min_width, DEFAULT_WINDOW.min_width),
    min_height: asNum(w.min_height, DEFAULT_WINDOW.min_height),
    max_width: asNum(w.max_width, DEFAULT_WINDOW.max_width),
    max_height: asNum(w.max_height, DEFAULT_WINDOW.max_height),
    resizable: asBool(w.resizable, DEFAULT_WINDOW.resizable),
    fullscreen: asBool(w.fullscreen, DEFAULT_WINDOW.fullscreen),
    frame: asBool(w.frame, DEFAULT_WINDOW.frame),
    'always-on-top': asBool(w['always-on-top'], DEFAULT_WINDOW['always-on-top']),
    devtools: asBool(w.devtools, DEFAULT_WINDOW.devtools),
  }
}

function packageJsonPath(contentRoot: string): string {
  return path.join(contentRoot, 'package.json')
}

/** NW.js / Chromium 要求 name 非空；部分游戏发布时写成 "" */
export function sanitizeNwPackageName(raw: string, fallback = 'game'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return cleaned || fallback
}

function suggestNwPackageName(contentRoot: string, raw?: Record<string, unknown>): string {
  const win = raw?.window && typeof raw.window === 'object' ? (raw.window as Record<string, unknown>) : null
  const title = String(win?.title || '').trim()
  if (title) return sanitizeNwPackageName(title)

  const base = path.basename(path.resolve(contentRoot))
  if (base.toLowerCase() === 'www' || base.toLowerCase() === 'app.nw' || base.toLowerCase() === 'package.nw') {
    return sanitizeNwPackageName(path.basename(path.dirname(path.resolve(contentRoot))), 'game')
  }
  return sanitizeNwPackageName(base, 'game')
}

/**
 * 启动前保证 package.json 的 name 合法（空字符串会导致 NW 报 Required value 'name' is missing or invalid）。
 * 已合法则不写盘。
 */
export function ensureNwPackageName(contentRoot: string): { file: string; name: string; updated: boolean } {
  const root = path.resolve(contentRoot)
  const file = packageJsonPath(root)
  if (!fs.existsSync(file)) {
    const name = suggestNwPackageName(root)
    const raw = { name, main: 'index.html', window: { title: name } }
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
    fs.renameSync(tmp, file)
    return { file, name, updated: true }
  }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    throw new Error(`无法解析 package.json: ${file}`)
  }

  const current = String(raw.name ?? '').trim()
  if (current && sanitizeNwPackageName(current) === current) {
    return { file, name: current, updated: false }
  }

  const name = current ? sanitizeNwPackageName(current, suggestNwPackageName(root, raw)) : suggestNwPackageName(root, raw)
  raw.name = name
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
  fs.renameSync(tmp, file)
  return { file, name, updated: true }
}

export function readNwPackage(contentRoot: string): NwPackageInfo | null {
  const file = packageJsonPath(contentRoot)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    return {
      file,
      name: String(raw.name || ''),
      main: String(raw.main || 'index.html'),
      window: normalizeWindow(raw.window),
    }
  } catch {
    return null
  }
}

/** 合并写入 window；保留 package.json 其它字段 */
export function writeNwWindow(contentRoot: string, partial: Partial<NwWindowConfig>): NwPackageInfo {
  const file = packageJsonPath(contentRoot)
  let raw: Record<string, unknown> = {}
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  } else {
    raw = { name: suggestNwPackageName(contentRoot), main: 'index.html' }
  }

  if (!String(raw.name || '').trim()) {
    raw.name = suggestNwPackageName(contentRoot, raw)
  } else {
    raw.name = sanitizeNwPackageName(String(raw.name), suggestNwPackageName(contentRoot, raw))
  }

  const nextWindow = normalizeWindow({
    ...normalizeWindow(raw.window),
    ...partial,
  })
  raw.window = nextWindow

  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
  fs.renameSync(tmp, file)

  return {
    file,
    name: String(raw.name || ''),
    main: String(raw.main || 'index.html'),
    window: nextWindow,
  }
}

export { DEFAULT_WINDOW }
